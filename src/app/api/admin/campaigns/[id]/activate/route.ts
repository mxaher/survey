import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";
import { checkReadiness } from "@/lib/readiness";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/campaigns/[id]/activate
 *
 * Pre-flight readiness check (spec §11.7). If ready:
 *   - Freeze immutable question + option snapshots for every active assigned
 *     question+option.
 *   - Set status='active', activatedAt=now.
 *   - Audit `campaign.activate`.
 * All within a single `db.$transaction` for atomicity.
 *
 * If not ready: 400 with `{ ready: false, issues }`.
 */
export const POST = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { id } = await ctx.params;

    const campaign = await db.campaign.findUnique({
      where: { id },
      select: { id: true, status: true, titleAr: true },
    });
    if (!campaign) return fail("الحملة غير موجودة.", 404);

    // Only drafts can be activated.
    if (campaign.status !== "draft" && campaign.status !== "scheduled") {
      return fail(
        "لا يمكن تفعيل حملة ليست في حالة المسودة أو المجدولة.",
        400
      );
    }

    // Pre-flight readiness check.
    const readiness = await checkReadiness(id);
    if (!readiness.ready) {
      return fail(MESSAGES.configIncomplete, 400, {
        ready: false,
        issues: readiness.issues,
      });
    }

    // Atomic activation: re-read inside tx, freeze snapshots, set status.
    const result = await db.$transaction(async (tx) => {
      // Re-fetch with all related rows inside the transaction so we operate
      // on the latest committed state.
      const c = await tx.campaign.findUnique({
        where: { id },
        include: {
          executives: { include: { executive: true } },
          questionConfig: {
            include: {
              question: { include: { options: true } },
            },
          },
        },
      });
      if (!c) throw new Error("campaign_not_found");
      if (c.status !== "draft" && c.status !== "scheduled") {
        throw new Error("invalid_status");
      }

      // Defensive: clear any pre-existing snapshots (shouldn't exist in
      // draft/scheduled state, but guarantees idempotency on retry).
      await tx.campaignQuestionOptionSnapshot.deleteMany({
        where: { snapshot: { campaignId: id } },
      });
      await tx.campaignQuestionSnapshot.deleteMany({
        where: { campaignId: id },
      });

      // Freeze every active assigned question + its active options, ordered
      // by their displayOrder so the employee UI renders in spec order.
      const activeConfigs = c.questionConfig
        .filter(
          (qc) =>
            qc.question?.isActive && qc.question?.deletedAt === null
        )
        .sort((a, b) => a.displayOrder - b.displayOrder);

      let snapshotCount = 0;
      let optionSnapshotCount = 0;

      for (const qc of activeConfigs) {
        const q = qc.question;
        const snapshot = await tx.campaignQuestionSnapshot.create({
          data: {
            campaignId: id,
            originalQuestionId: q.id,
            questionCode: q.code,
            questionAr: q.questionAr,
            questionType: q.questionType,
            section: q.section,
            dimension: q.dimension,
            isRequired: qc.isRequired,
            displayOrder: qc.displayOrder,
            maxSelections: q.maxSelections,
          },
        });
        snapshotCount++;

        const activeOptions = (q.options || [])
          .filter((o) => o.isActive)
          .sort((a, b) => a.displayOrder - b.displayOrder);

        for (const opt of activeOptions) {
          await tx.campaignQuestionOptionSnapshot.create({
            data: {
              campaignQuestionSnapshotId: snapshot.id,
              value: opt.value,
              labelAr: opt.labelAr,
              score: opt.score,
              displayOrder: opt.displayOrder,
            },
          });
          optionSnapshotCount++;
        }
      }

      // Flip the campaign to active.
      const updated = await tx.campaign.update({
        where: { id },
        data: {
          status: "active",
          activatedAt: new Date(),
        },
      });

      return {
        updated,
        snapshotCount,
        optionSnapshotCount,
        executiveCount: c.executives.filter(
          (ce) => ce.isEnabled && ce.executive?.isActive && !ce.executive?.deletedAt
        ).length,
      };
    });

    // Audit (outside the tx so a failure here doesn't roll back the
    // activation — audit logging is best-effort and the spec does not
    // require audit + mutation to share atomicity).
    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign.activate",
      entityType: "campaign",
      entityId: id,
      campaignId: id,
      metadata: {
        previousStatus: campaign.status,
        newStatus: result.updated.status,
        questionSnapshots: result.snapshotCount,
        optionSnapshots: result.optionSnapshotCount,
        activeExecutives: result.executiveCount,
      },
    });

    return ok({
      id: result.updated.id,
      status: result.updated.status,
      activatedAt: result.updated.activatedAt,
      snapshotCount: result.snapshotCount,
      optionSnapshotCount: result.optionSnapshotCount,
    });
  }
);
