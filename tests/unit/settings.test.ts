import { describe, it, expect } from "bun:test";
import {
  auditValueFor,
  isSecretSettingKey,
  toPublicSetting,
  validateSettingValue,
} from "@/lib/settings";
import { resolveEmailConfig } from "@/lib/email";

const row = (key: string, valueAr: string) => ({
  id: `id-${key}`,
  key,
  valueAr,
  updatedAt: "2026-01-01 00:00:00",
});

const settings = (...entries: Array<[string, string]>) => new Map(entries);

describe("secret settings redaction", () => {
  it("marks only the Resend key as a secret", () => {
    expect(isSecretSettingKey("resend_api_key")).toBe(true);
    expect(isSecretSettingKey("email_from")).toBe(false);
    expect(isSecretSettingKey("privacy_notice")).toBe(false);
  });

  it("withholds the stored key and reports whether one exists", () => {
    const out = toPublicSetting(row("resend_api_key", "re_abc123def456"));
    expect(out.valueAr).toBe("");
    expect(out.secret).toBe(true);
    expect(out.configured).toBe(true);
    // The row itself is still addressable by id/key for PATCH/DELETE.
    expect(out.id).toBe("id-resend_api_key");
    expect(out.key).toBe("resend_api_key");
  });

  it("reports an empty secret as not configured", () => {
    const out = toPublicSetting(row("resend_api_key", "   "));
    expect(out.valueAr).toBe("");
    expect(out.configured).toBe(false);
  });

  it("leaves ordinary settings untouched", () => {
    const out = toPublicSetting(row("privacy_notice", "نص"));
    expect(out.valueAr).toBe("نص");
    expect(out.secret).toBeUndefined();
    expect(out.configured).toBeUndefined();
  });

  it("redacts the previous value in audit metadata", () => {
    expect(auditValueFor("resend_api_key", "re_secret")).toBe("[redacted]");
    expect(auditValueFor("privacy_notice", "نص")).toBe("نص");
  });
});

describe("reserved setting value validation", () => {
  it("accepts and rejects sender addresses", () => {
    expect(validateSettingValue("email_from", "no-reply@almarshad.com")).toBeNull();
    expect(validateSettingValue("email_from", "not-an-email")).not.toBeNull();
    expect(validateSettingValue("email_from", "a@b")).not.toBeNull();
  });

  it("only accepts Resend-shaped keys", () => {
    expect(validateSettingValue("resend_api_key", "re_abc123def456")).toBeNull();
    expect(validateSettingValue("resend_api_key", "re_a1b2c3")).toBeNull();
    expect(validateSettingValue("resend_api_key", "sg.live.abc")).not.toBeNull();
    expect(validateSettingValue("resend_api_key", "re_short!")).not.toBeNull();
    expect(validateSettingValue("resend_api_key", "re_has space")).not.toBeNull();
  });

  it("leaves unknown keys unrestricted", () => {
    expect(validateSettingValue("anything_else", "whatever")).toBeNull();
  });
});

describe("email configuration resolution", () => {
  const env = (over: Partial<Record<string, string>> = {}) => over;

  it("is unconfigured when nothing is set anywhere", () => {
    const { config, status } = resolveEmailConfig({
      env: env(),
      settings: settings(),
    });
    expect(config).toBeNull();
    expect(status.configured).toBe(false);
    expect(status.provider).toBeNull();
    expect(status.providerSource).toBeNull();
    expect(status.senderSource).toBeNull();
    expect(status.fromEmail).toBeNull();
  });

  it("reads the worker env when present", () => {
    const { config, status } = resolveEmailConfig({
      env: env({ EMAIL_FROM: "a@b.com", RESEND_API_KEY: "re_env_key_001" }),
      settings: settings(),
    });
    expect(config?.fromEmail).toBe("a@b.com");
    expect(config?.resendApiKey).toBe("re_env_key_001");
    expect(status.configured).toBe(true);
    expect(status.provider).toBe("resend");
    expect(status.providerSource).toBe("worker_env");
    expect(status.senderSource).toBe("worker_env");
  });

  it("falls back to the admin settings rows when the env is empty", () => {
    const { config, status } = resolveEmailConfig({
      env: env(),
      settings: settings(
        ["email_from", "no-reply@almarshad.com"],
        ["resend_api_key", "re_db_key_001"]
      ),
    });
    expect(config?.fromEmail).toBe("no-reply@almarshad.com");
    expect(config?.resendApiKey).toBe("re_db_key_001");
    expect(config?.fromName).toBe("استبيان بيئة العمل");
    expect(status.configured).toBe(true);
    expect(status.providerSource).toBe("system_setting");
    expect(status.senderSource).toBe("system_setting");
  });

  it("lets the worker secret win over a stored setting", () => {
    const { config, status } = resolveEmailConfig({
      env: env({ RESEND_API_KEY: "re_env_wins" }),
      settings: settings(
        ["email_from", "no-reply@almarshad.com"],
        ["resend_api_key", "re_db_ignored"]
      ),
    });
    expect(config?.resendApiKey).toBe("re_env_wins");
    expect(status.providerSource).toBe("worker_env");
    // The sender still comes from settings — only the key is overridden.
    expect(status.senderSource).toBe("system_setting");
    expect(status.fromEmail).toBe("no-reply@almarshad.com");
  });

  it("stays unconfigured without a sender, even with a key", () => {
    const { config, status } = resolveEmailConfig({
      env: env(),
      settings: settings(["resend_api_key", "re_key_no_sender"]),
    });
    expect(config).toBeNull();
    expect(status.configured).toBe(false);
    // Reported so the UI can point at the missing half.
    expect(status.providerSource).toBe("system_setting");
    expect(status.senderSource).toBeNull();
  });

  it("stays unconfigured with a sender but no provider key", () => {
    const { config, status } = resolveEmailConfig({
      env: env({ EMAIL_FROM: "a@b.com" }),
      settings: settings(),
    });
    expect(config).not.toBeNull();
    expect(status.configured).toBe(false);
    expect(status.provider).toBeNull();
    expect(status.fromEmail).toBe("a@b.com");
  });

  it("uses Mailjet only when both Mailjet keys are present", () => {
    const both = resolveEmailConfig({
      env: env({
        EMAIL_FROM: "a@b.com",
        MAILJET_API_KEY: "mj-key",
        MAILJET_SECRET_KEY: "mj-secret",
      }),
      settings: settings(),
    });
    expect(both.status.configured).toBe(true);
    expect(both.status.provider).toBe("mailjet");
    expect(both.status.providerSource).toBe("worker_env");

    const half = resolveEmailConfig({
      env: env({ EMAIL_FROM: "a@b.com", MAILJET_API_KEY: "mj-key" }),
      settings: settings(),
    });
    expect(half.status.configured).toBe(false);
    expect(half.status.provider).toBeNull();
  });

  it("prefers Resend over Mailjet when both are configured", () => {
    const { status } = resolveEmailConfig({
      env: env({
        EMAIL_FROM: "a@b.com",
        RESEND_API_KEY: "re_key",
        MAILJET_API_KEY: "mj-key",
        MAILJET_SECRET_KEY: "mj-secret",
      }),
      settings: settings(),
    });
    expect(status.provider).toBe("resend");
  });
});
