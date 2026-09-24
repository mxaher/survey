import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

function isEditable(status: string): boolean {
  return status === "draft" || status === "scheduled";
}

/**
 * GET /api/admin/campaigns/[campaignId]/executives
 * Lists all executive assignments for a campaign, joined with the executive.
 */
export const GET = apiHandler(
  async (
    _request: NextRequest,
    ctx: { params: Promise<{ id: string }> }
  ) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const db = getDB();
    const { id: campaignId } = await ctx.params;

    const campaign = await db.prepare(
      `SELECT id, status, titleAr FROM Campaign WHERE id = ?`
    ).bind(campaignId).first() as Record<string, unknown> | null;
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    const assignments = await db.prepare(
      `SELECT ce.campaignId, ce.executiveId, ce.displayOrder, ce.isEnabled,
              ce.createdAt, ce.updatedAt,
              e.nameAr, e.titleAr, e.category, e.departmentAr,
              e.displayOrder AS execDisplayOrder, e.isActive, e.deletedAt
       FROM CampaignExecutive ce
       JOIN Executive e ON e.id = ce.executiveId
       WHERE ce.campaignId = ?
       ORDER BY ce.displayOrder ASC`
    ).bind(campaignId).all();

    return ok({
      campaign: {
        id: campaign.id,
        titleAr: campaign.titleAr,
        status: campaign.status,
        editable: isEditable(campaign.status as string),
      },
      assignments: assignments.results.map((a: Record<string, unknown>) => ({
        campaignId: a.campaignId,
        executiveId: a.executiveId,
        displayOrder: a.displayOrder,
        isEnabled: a.isEnabled,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        executive: {
          id: a.executiveId,
          nameAr: a.nameAr,
          titleAr: a.titleAr,
          category: a.category,
          departmentAr: a.departmentAr,
          displayOrder: a.execDisplayOrder,
          isActive: a.isActive,
          deletedAt: a.deletedAt,
        },
      })),
    });
  }
);

/**
 * POST /api/admin/campaigns/[campaignId]/executives
 * Assigns one or more executives to a DRAFT or SCHEDULED campaign.
 */
const assignSchema = z.object({
  executiveIds: z
    .array(z.string().min(1, "معرّف المسؤول مطلوب."))
    .min(1, "يجب تحديد مسؤول واحد على الأقل."),
  displayOrder: z.coerce.number().int().min(0).optional(),
  isEnabled: z.coerce.boolean().optional(),
});

export const POST = apiHandler(
  async (
    request: NextRequest,
    ctx: { params: Promise<{ id: string }> }
  ) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const db = getDB();
    const { id: campaignId } = await ctx.params;
    const json = await request.json().catch(() => null);
    if (!json) return fail("صيغة الطلب غير صالحة.", 400);

    const parsed = assignSchema.safeParse(json);
    if (!parsed.success) {
      return fail(
        parsed.error.issues?.[0]?.message ?? MESSAGES.configIncomplete,
        422
      );
    }
    const input = parsed.data;

    const campaign = await db.prepare(
      `SELECT id, status, titleAr FROM Campaign WHERE id = ?`
    ).bind(campaignId).first() as Record<string, unknown> | null;
    if (!campaign) return fail("الحملة غير موجودة.", 404);
    if (!isEditable(campaign.status as string)) {
      return fail(MESSAGES.cannotEditActiveCampaign, 400, {
        status: campaign.status,
      });
    }

    const uniqueIds = Array.from(new Set(input.executiveIds));

    // Validate every executive exists and is not soft-deleted
    const placeholders = uniqueIds.map(() => "?").join(",");
    const validExecs = await db.prepare(
      `SELECT id FROM Executive WHERE id IN (${placeholders}) AND deletedAt IS NULL`
    ).bind(...uniqueIds).all();
    const validIds = new Set(validExecs.results.map((e: Record<string, unknown>) => e.id));
    const invalid = uniqueIds.filter((eid) => !validIds.has(eid));
    if (invalid.length > 0) {
      return fail(
        "بعض المسؤولين المحددين غير موجودين أو محذوفين.",
        400,
        { invalidIds: invalid }
      );
    }

    // Find which are already assigned
    const existing = await db.prepare(
      `SELECT executiveId FROM CampaignExecutive WHERE campaignId = ? AND executiveId IN (${placeholders})`
    ).bind(campaignId, ...uniqueIds).all();
    const existingIds = new Set(existing.results.map((e: Record<string, unknown>) => e.executiveId));
    const toCreate = uniqueIds.filter((eid) => !existingIds.has(eid));

    if (toCreate.length === 0) {
      await writeAudit({
        adminUserId: admin.adminId,
        action: "campaign_executive.assign",
        entityType: "campaign_executive",
        campaignId,
        metadata: {
          requested: uniqueIds,
          created: [],
          skipped: uniqueIds,
          idempotent: true,
        },
      });
      return ok({
        campaignId,
        assigned: [],
        skipped: uniqueIds,
        created: 0,
      });
    }

    // Resolve displayOrder
    let baseOrder = input.displayOrder;
    if (baseOrder === undefined) {
      const maxRow = await db.prepare(
        `SELECT displayOrder FROM CampaignExecutive WHERE campaignId = ? ORDER BY displayOrder DESC LIMIT 1`
      ).bind(campaignId).first() as Record<string, unknown> | null;
      baseOrder = ((maxRow?.displayOrder as number) ?? -1) + 1;
    }

    // Build batch insert
    const now = new Date().toISOString();
    const statements: ReturnType<typeof db.prepare>[] = [];
    const rows: { executiveId: string; displayOrder: number; isEnabled: boolean }[] = [];

    let i = 0;
    for (const eId of toCreate) {
      const rowEnabled = input.isEnabled ?? true;
      rows.push({ executiveId: eId, displayOrder: baseOrder + i, isEnabled: rowEnabled });
      statements.push(
        db.prepare(
          `INSERT INTO CampaignExecutive (campaignId, executiveId, displayOrder, isEnabled, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(campaignId, eId, baseOrder + i, rowEnabled ? 1 : 0, now, now)
      );
      i++;
    }

    await db.batch(statements);

    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign_executive.assign",
      entityType: "campaign_executive",
      campaignId,
      metadata: {
        requested: uniqueIds,
        created: rows.map((r) => r.executiveId),
        skipped: Array.from(existingIds),
      },
    });

    return ok(
      {
        campaignId,
        assigned: rows,
        skipped: Array.from(existingIds),
        created: rows.length,
      },
      { status: 201 }
    );
  }
);
