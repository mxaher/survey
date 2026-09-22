import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
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
 * Lists all executive assignments for a campaign, joined with the
 * executive. Ordered by displayOrder.
 */
export const GET = apiHandler(
  async (
    _request: NextRequest,
    ctx: { params: Promise<{ id: string }> }
  ) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { id: campaignId } = await ctx.params;
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, status: true, titleAr: true },
    });
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    const assignments = await db.campaignExecutive.findMany({
      where: { campaignId },
      orderBy: { displayOrder: "asc" },
      include: { executive: true },
    });

    return ok({
      campaign: {
        id: campaign.id,
        titleAr: campaign.titleAr,
        status: campaign.status,
        editable: isEditable(campaign.status),
      },
      assignments: assignments.map((a) => ({
        campaignId: a.campaignId,
        executiveId: a.executiveId,
        displayOrder: a.displayOrder,
        isEnabled: a.isEnabled,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        executive: a.executive
          ? {
              id: a.executive.id,
              nameAr: a.executive.nameAr,
              titleAr: a.executive.titleAr,
              category: a.executive.category,
              departmentAr: a.executive.departmentAr,
              displayOrder: a.executive.displayOrder,
              isActive: a.executive.isActive,
              deletedAt: a.executive.deletedAt,
            }
          : null,
      })),
    });
  }
);

/**
 * POST /api/admin/campaigns/[campaignId]/executives
 * Assigns one or more executives to a DRAFT or SCHEDULED campaign.
 *
 * Body:
 *   { executiveIds: string[], displayOrder?, isEnabled? }
 *
 * - Rejects for active/closed/archived with MESSAGES.cannotEditActiveCampaign.
 * - Idempotent: existing assignments are skipped.
 * - Wrapped in db.$transaction.
 * - Audits `campaign_executive.assign` with the list of newly-assigned ids.
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

    // Re-validate campaign status from the DB.
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, status: true, titleAr: true },
    });
    if (!campaign) return fail("الحملة غير موجودة.", 404);
    if (!isEditable(campaign.status)) {
      return fail(MESSAGES.cannotEditActiveCampaign, 400, {
        status: campaign.status,
      });
    }

    // De-duplicate defensively.
    const uniqueIds = Array.from(new Set(input.executiveIds));

    // Validate every executive exists and is not soft-deleted globally.
    const validExecs = await db.executive.findMany({
      where: { id: { in: uniqueIds }, deletedAt: null },
      select: { id: true, nameAr: true, isActive: true },
    });
    const validIds = new Set(validExecs.map((e) => e.id));
    const invalid = uniqueIds.filter((id) => !validIds.has(id));
    if (invalid.length > 0) {
      return fail(
        "بعض المسؤولين المحددين غير موجودين أو محذوفين.",
        400,
        { invalidIds: invalid }
      );
    }

    // Find which are already assigned (skip those — idempotent).
    const existing = await db.campaignExecutive.findMany({
      where: { campaignId, executiveId: { in: uniqueIds } },
      select: { executiveId: true },
    });
    const existingIds = new Set(existing.map((e) => e.executiveId));
    const toCreate = uniqueIds.filter((id) => !existingIds.has(id));

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

    // Resolve a sensible displayOrder: if the body supplied one, use it for
    // every new row; otherwise append after the current max.
    let baseOrder = input.displayOrder;
    if (baseOrder === undefined) {
      const maxRow = await db.campaignExecutive.findFirst({
        where: { campaignId },
        orderBy: { displayOrder: "desc" },
        select: { displayOrder: true },
      });
      baseOrder = (maxRow?.displayOrder ?? -1) + 1;
    }

    const created = await db.$transaction(async (tx) => {
      const c = await tx.campaign.findUnique({
        where: { id: campaignId },
        select: { status: true },
      });
      if (!c) throw new Error("campaign_not_found");
      if (!isEditable(c.status)) throw new Error("invalid_status");

      const rows: { executiveId: string; displayOrder: number; isEnabled: boolean }[] = [];
      let i = 0;
      for (const eId of toCreate) {
        const row = await tx.campaignExecutive.create({
          data: {
            campaignId,
            executiveId: eId,
            displayOrder: baseOrder + i,
            isEnabled: input.isEnabled ?? true,
          },
        });
        rows.push({
          executiveId: row.executiveId,
          displayOrder: row.displayOrder,
          isEnabled: row.isEnabled,
        });
        i++;
      }
      return rows;
    });

    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign_executive.assign",
      entityType: "campaign_executive",
      campaignId,
      metadata: {
        requested: uniqueIds,
        created: created.map((c) => c.executiveId),
        skipped: Array.from(existingIds),
      },
    });

    return ok(
      {
        campaignId,
        assigned: created,
        skipped: Array.from(existingIds),
        created: created.length,
      },
      { status: 201 }
    );
  }
);
