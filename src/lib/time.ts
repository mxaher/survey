/**
 * Time utilities. Store all timestamps as UTC (Prisma DateTime).
 * Display in Riyadh time (Asia/Riyadh, UTC+3, no DST).
 */
const RIYADH_TZ = "Asia/Riyadh";

export function toRiyadhDisplay(iso: Date | string | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("ar-SA", {
      timeZone: RIYADH_TZ,
      calendar: "gregory",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

export function toRiyadhDate(iso: Date | string | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("ar-SA", {
      timeZone: RIYADH_TZ,
      calendar: "gregory",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function nowUtc(): Date {
  return new Date();
}

/** Returns true if "now" is strictly within [startsAt, endsAt] (inclusive). */
export function isWithinActiveWindow(
  now: Date,
  startsAt: Date | null | undefined,
  endsAt: Date | null | undefined
): { active: boolean; reason?: "before_start" | "after_end" } {
  if (startsAt && now < startsAt) return { active: false, reason: "before_start" };
  if (endsAt && now > endsAt) return { active: false, reason: "after_end" };
  return { active: true };
}
