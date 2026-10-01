import { describe, it, expect } from "bun:test";
import { openMemoryDb, applyMigrations } from "../helpers/d1";
import {
  ASSIGNED_EXECUTIVES_SQL,
  EXECUTIVE_ASSIGNMENT_SQL,
} from "@/lib/employee-queries";

/**
 * Regression: both queries used to start with `SELECT ce.id`, but
 * `CampaignExecutive` has no `id` column (PK = campaignId + executiveId), so
 * SQLite rejected them and `/api/employee/executives` (and the per-executive
 * questions endpoint) returned 500. The wizard then rendered an empty roster
 * and the survey showed no questions at all.
 */
describe("employee executive queries", () => {
  it("CampaignExecutive has no id column", () => {
    const db = openMemoryDb();
    applyMigrations(db);
    const columns = db
      .prepare("PRAGMA table_info(CampaignExecutive)")
      .all() as { name: string }[];
    expect(columns.map((c) => c.name)).toEqual([
      "campaignId",
      "executiveId",
      "displayOrder",
      "isEnabled",
      "createdAt",
      "updatedAt",
    ]);
    db.close();
  });

  it("lists the campaign's active executives", () => {
    const db = openMemoryDb();
    applyMigrations(db);

    const rows = db
      .prepare(ASSIGNED_EXECUTIVES_SQL)
      .all("camp-001") as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0])).toContain("executiveId");
    expect(Object.keys(rows[0])).not.toContain("id");
    db.close();
  });

  it("resolves one assignment for the questions endpoint", () => {
    const db = openMemoryDb();
    applyMigrations(db);

    const assigned = db
      .prepare(ASSIGNED_EXECUTIVES_SQL)
      .all("camp-001") as { executiveId: string }[];
    const first = assigned[0].executiveId;

    const row = db
      .prepare(EXECUTIVE_ASSIGNMENT_SQL)
      .get("camp-001", first) as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row?.executiveId).toBe(first);
    const keys = Object.keys(row ?? {});
    expect(keys).toContain("displayOrder");
    expect(keys).toContain("isEnabled");
    expect(keys).toContain("isActive");
    expect(keys).toContain("deletedAt");
    db.close();
  });

  it("returns nothing for an executive that is not on the roster", () => {
    const db = openMemoryDb();
    applyMigrations(db);

    const row = db
      .prepare(EXECUTIVE_ASSIGNMENT_SQL)
      .get("camp-001", "exec-does-not-exist");
    expect(row).toBeNull();
    db.close();
  });
});
