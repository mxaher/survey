import { NextRequest } from "next/server";
import { fail, noStore, apiHandler } from "@/lib/api";
import { getVerifiedEmployee } from "@/lib/identity";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * Draft / resume — POST + GET /api/employee/draft
 *
 * The architecture supports a `allowResume` toggle on Campaign (spec §7,
 * §13.4). The intended design was to persist in-progress answers so an
 * employee could close the tab and resume later.
 *
 * v1 DOES NOT persist in-progress answers. The reason: any "draft" store
 * would have to associate employee answers with the employee's HMAC to
 * support retrieval — which re-couples identity to answers (the very thing
 * the spec's identity-separation architecture exists to prevent). The
 * ParticipationLedger's `status='started'` row can mark "employee opened
 * this section" without storing answer content, but that gives no real
 * resume value and risks privacy drift if a future engineer mis-uses the
 * row to stash JSON.
 *
 * Decision: return 501 Not Implemented with the Arabic message
 * "الميزة قيد التطوير" for both verbs. The campaign's `allowResume` flag
 * is still surfaced by `GET /api/employee/campaign` so the frontend can
 * decide whether to show the resume CTA — but the CTA will hit this 501
 * until a privacy-preserving resume design lands.
 *
 * NEVER returns `employeeHmac`. `Cache-Control: no-store` on all paths
 * (draft state is highly dynamic).
 */

const NOT_IMPLEMENTED_AR = "الميزة قيد التطوير";

export const POST = apiHandler(async (_request: NextRequest) => {
  const employee = await getVerifiedEmployee();
  if (!employee) return fail(MESSAGES.unauthorized, 401);

  // 501 — feature not wired in v1. See file-level comment.
  return noStore(
    { message: NOT_IMPLEMENTED_AR, allowResume: true /* when campaign toggled */ },
    501
  );
});

export const GET = apiHandler(async (_request: NextRequest) => {
  const employee = await getVerifiedEmployee();
  if (!employee) return fail(MESSAGES.unauthorized, 401);

  // 501 — no draft persisted in v1.
  return noStore({ message: NOT_IMPLEMENTED_AR, draft: null }, 501);
});
