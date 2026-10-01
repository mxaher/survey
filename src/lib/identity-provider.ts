/**
 * Corporate identity providers (spec §"IDENTITY PROVIDER ABSTRACTION").
 *
 * Resolved server-side from, in order:
 *
 *   1. a Cloudflare Access JWT on the request (when Access is configured, so
 *      the visitor never needs the sign-in form),
 *   2. an existing first-party session — the default path: the survey shell
 *      renders the email + password card (`AuthCard`) on a 401, and employee
 *      addresses are restricted to the corporate domain,
 *   3. the admin Employee Picker preview cookie — admin-gated, and refused on
 *      every submit endpoint.
 *
 * The value returned as `stableSubject` may only ever live in server memory
 * for the duration of a request: it is never sent to the browser, never
 * written to the database (only its HMAC is), and never logged.
 */
import { readWorkerEnv } from "@/lib/env";

/**
 * Where a participant identity came from.
 *
 *   - `cloudflare-access` / `session` — verified by the corporate identity
 *     layer or a first-party sign-in.
 *   - `dev` — the admin Employee Picker preview cookie (write-blocked on
 *     every submit endpoint).
 *   - `anonymous` — no sign-in at all: a random per-browser id minted by the
 *     app itself. It exists only to key the participation HMAC (one
 *     evaluation per executive per browser) and is never a credential.
 */
export type ParticipantSource =
  | "cloudflare-access"
  | "session"
  | "dev"
  | "anonymous";

/**
 * Result of a background identity check.
 *
 * `stableSubject` is the raw subject used to key the participation HMAC. It
 * must not leave the server — callers are responsible for never serialising
 * it into a response, a log line, or a database row.
 */
export interface VerifiedSurveyParticipant {
  authenticated: boolean;
  eligible: boolean;
  stableSubject: string | null;
  source: ParticipantSource;
}

export interface AccessConfig {
  /** Team domain, e.g. `https://acme.cloudflareaccess.com`. */
  teamDomain: string;
  /** The Access application's audience (AUD) tag. */
  audience: string;
}

/** Header Cloudflare Access attaches once it has authenticated the request. */
export const ACCESS_JWT_HEADER = "Cf-Access-JWT-Assertion";

/** Cloudflare publishes signing keys here for every team. */
const JWKS_PATH = "/cdn-cgi/access/certs";

const JWKS_TTL_MS = 5 * 60_000;

interface RsaJwk {
  kty: string;
  kid?: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
}

interface CachedJwks {
  keys: RsaJwk[];
  fetchedAt: number;
}

/** Per-isolate cache; Workers reuse module state across requests. */
const jwksCache = new Map<string, CachedJwks>();

/**
 * Read the Access configuration from the worker env.
 * Returns null unless BOTH values are configured, so a half-configured
 * deployment never silently accepts a token it cannot verify.
 */
export function getAccessConfig(): AccessConfig | null {
  const teamDomain = readWorkerEnv("CF_ACCESS_TEAM_DOMAIN");
  const audience = readWorkerEnv("CF_ACCESS_AUD");
  if (!teamDomain || !audience) return null;
  return { teamDomain: teamDomain.replace(/\/+$/, ""), audience };
}

function b64urlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeJsonPart<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part))) as T;
}

async function fetchJwks(
  url: string,
  fetchImpl: typeof fetch
): Promise<RsaJwk[]> {
  const cached = jwksCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.keys;
  }

  const res = await fetchImpl(url, { method: "GET" });
  if (!res.ok) return cached?.keys ?? [];
  const body = (await res.json()) as { keys?: RsaJwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache.set(url, { keys, fetchedAt: Date.now() });
  return keys;
}

/** Test seam — lets a test point at an in-memory key set. */
export interface VerifyOptions {
  fetchImpl?: typeof fetch;
  /** Bypass the isolate cache (tests sign fresh keys per case). */
  nowMs?: number;
}

/**
 * Verify a Cloudflare Access JWT and return its `sub` claim.
 *
 * Validates signature (RS256 against the team's JWKS), issuer, audience and
 * expiry. Returns null on any failure — callers treat null as
 * "not authenticated" and must not distinguish the reasons to the client.
 *
 * The returned subject is server-memory only.
 */
export async function verifyCloudflareAccessJwt(
  token: string,
  config: AccessConfig,
  options: VerifyOptions = {}
): Promise<string | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { kid?: string; alg?: string };
  let payload: {
    sub?: unknown;
    iss?: unknown;
    aud?: unknown;
    exp?: unknown;
  };
  try {
    header = decodeJsonPart(headerB64);
    payload = decodeJsonPart(payloadB64);
  } catch {
    return null;
  }

  // RS256 only — reject anything else (incl. `alg: none`).
  if (header.alg !== "RS256") return null;
  if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
  if (payload.iss !== config.teamDomain) return null;

  const nowSec = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) return null;

  const audiences = Array.isArray(payload.aud)
    ? payload.aud
    : [payload.aud];
  if (!audiences.includes(config.audience)) return null;

  const jwksUrl = `${config.teamDomain}${JWKS_PATH}`;
  let keys: RsaJwk[];
  try {
    keys = await fetchJwks(jwksUrl, fetchImpl);
  } catch {
    return null;
  }

  const jwk = header.kid
    ? keys.find((k) => k.kid === header.kid)
    : keys.find((k) => k.kty === "RSA");
  if (!jwk || jwk.kty !== "RSA" || !jwk.n || !jwk.e) return null;

  let valid = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk as unknown as JsonWebKey,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    valid = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      b64urlToBytes(signatureB64) as unknown as BufferSource,
      new TextEncoder().encode(`${headerB64}.${payloadB64}`) as unknown as BufferSource
    );
  } catch {
    return null;
  }

  return valid ? payload.sub : null;
}

/**
 * Resolve a subject from the Cloudflare Access header on an incoming request.
 * Returns null when Access is unconfigured, the header is absent, or the
 * token fails validation.
 */
export async function subjectFromAccessHeader(
  token: string | null,
  options: VerifyOptions = {}
): Promise<string | null> {
  if (!token) return null;
  const config = getAccessConfig();
  if (!config) return null;
  try {
    return await verifyCloudflareAccessJwt(token, config, options);
  } catch {
    return null;
  }
}
