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
 * POST /api/admin/campaigns/[campaignId]/questions/reorder
 * Body: { order: [{ questionId, displayOrder }] }
 */
const reorderSchema = z.object({
  order: z
    .array(
      z.object({
        questionId: z.string().min(1, "معرّف السؤال مطلوب."),
        displayOrder: z.coerce.number().int().min(0),
      })
    )
    .min(1, "يجب تحديد ترتيب سؤال واحد على الأقل."),
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

    const parsed = reorderSchema.safeParse(json);
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

    // Verify all referenced assignments exist
    const ids = input.order.map((o) => o.questionId);
    const placeholders = ids.map(() => "?").join(",");
    const existing = await db.prepare(
      `SELECT questionId FROM CampaignQuestionConfig WHERE campaignId = ? AND questionId IN (${placeholders})`
    ).bind(campaignId, ...ids).all();
    const existingIds = new Set(existing.results.map((e: Record<string, unknown>) => e.questionId));
    const missing = ids.filter((qid) => !existingIds.has(qid));
    if (missing.length > 0) {
      return fail("بعض الأسئلة المحددة غير مُسندة لهذه الحملة.", 400, {
        missingIds: missing,
      });
    }

    // Build batch updates
    const statements: ReturnType<typeof db.prepare>[] = [];
    for (const item of input.order) {
      statements.push(
        db.prepare(
          `UPDATE CampaignQuestionConfig SET displayOrder = ?, updatedAt = datetime('now') WHERE campaignId = ? AND questionId = ?`
        ).bind(item.displayOrder, campaignId, item.questionId)
      );
    }
    await db.batch(statements);

    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign_question.reorder",
      entityType: "campaign_question",
      campaignId,
      metadata: {
        count: input.order.length,
        order: input.order,
      },
    });

    return ok({ campaignId, reordered: input.order.length });
  }
);
