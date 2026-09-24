import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
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
 * All within a single D1 batch for atomicity.
 *
 * If not ready: 400 with `{ ready: false, issues }`.
 */
export const POST = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const db = getDB();

    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { id } = await ctx.params;

    const campaign = await db.prepare(
      `SELECT id, status, titleAr FROM Campaign WHERE id = ?`
    ).bind(id).first() as Record<string, unknown> | null;
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
    // D1 batch — each element is a prepared statement; runs in a single tx.
    const now = new Date().toISOString();

    // --- Fetch campaign with executives and question config ---

    const cRow = await db.prepare(
      `SELECT id, status FROM Campaign WHERE id = ?`
    ).bind(id).first() as Record<string, unknown> | null;
    if (!cRow) throw new Error("campaign_not_found");
    if (cRow.status !== "draft" && cRow.status !== "scheduled") {
      throw new Error("invalid_status");
    }

    const executives = await db.prepare(
      `SELECT ce.isEnabled, e.isActive AS execIsActive, e.deletedAt AS execDeletedAt
       FROM CampaignExecutive ce
       JOIN Executive e ON e.id = ce.executiveId
       WHERE ce.campaignId = ?`
    ).bind(id).all();

    const questionConfigRows = await db.prepare(
      `SELECT cqc.isRequired, cqc.displayOrder,
              q.id AS qId, q.code AS qCode, q.questionAr AS qQuestionAr,
              q.questionType AS qQuestionType, q.section AS qSection,
              q.dimension AS qDimension, q.isActive AS qIsActive,
              q.deletedAt AS qDeletedAt, q.maxSelections AS qMaxSelections
       FROM CampaignQuestionConfig cqc
       JOIN Question q ON q.id = cqc.questionId
       WHERE cqc.campaignId = ?`
    ).bind(id).all();

    // Fetch options for all questions in one query.
    const questionIds = questionConfigRows.results.map(
      (qc: Record<string, unknown>) => qc.qId as string
    );
    let optionRows: Record<string, unknown>[] = [];
    if (questionIds.length > 0) {
      const placeholders = questionIds.map(() => "?").join(",");
      optionRows = (await db.prepare(
        `SELECT * FROM QuestionOption WHERE questionId IN (${placeholders}) ORDER BY displayOrder`
      ).bind(...questionIds).all()).results as Record<string, unknown>[];
    }

    // --- Defensive: clear any pre-existing snapshots (idempotency on retry) ---
    const deleteOptionSnapshots = db.prepare(
      `DELETE FROM CampaignQuestionOptionSnapshot
       WHERE campaignQuestionSnapshotId IN (
         SELECT id FROM CampaignQuestionSnapshot WHERE campaignId = ?
       )`
    ).bind(id);

    const deleteSnapshots = db.prepare(
      `DELETE FROM CampaignQuestionSnapshot WHERE campaignId = ?`
    ).bind(id);

    // --- Assemble question data in JS and build snapshot INSERT statements ---

    const activeConfigs = questionConfigRows.results
      .filter(
        (qc: Record<string, unknown>) =>
          qc.qIsActive && qc.qDeletedAt === null
      )
      .sort(
        (a: Record<string, unknown>, b: Record<string, unknown>) =>
          (a.displayOrder as number) - (b.displayOrder as number)
      );

    // Build snapshot INSERT statements.
    const snapshotStatements: ReturnType<typeof db.prepare>[] = [];
    let snapshotCount = 0;
    let optionSnapshotCount = 0;

    for (const qc of activeConfigs) {
      const qId = qc.qId as string;
      const snapshotId = crypto.randomUUID();

      snapshotStatements.push(
        db.prepare(
          `INSERT INTO CampaignQuestionSnapshot
             (id, campaignId, originalQuestionId, questionCode, questionAr,
              questionType, section, dimension, isRequired, displayOrder,
              maxSelections, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        ).bind(
          snapshotId,
          id,
          qId,
          qc.qCode,
          qc.qQuestionAr,
          qc.qQuestionType,
          qc.qSection,
          qc.qDimension,
          qc.isRequired ? 1 : 0,
          qc.displayOrder,
          qc.qMaxSelections ?? null
        )
      );
      snapshotCount++;

      const activeOptions = optionRows
        .filter(
          (o) =>
            o.questionId === qId && o.isActive
        )
        .sort(
          (a, b) => (a.displayOrder as number) - (b.displayOrder as number)
        );

      for (const opt of activeOptions) {
        snapshotStatements.push(
          db.prepare(
            `INSERT INTO CampaignQuestionOptionSnapshot
               (id, campaignQuestionSnapshotId, value, labelAr, score,
                displayOrder, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
          ).bind(
            crypto.randomUUID(),
            snapshotId,
            opt.value,
            opt.labelAr,
            opt.score ?? null,
            opt.displayOrder
          )
        );
        optionSnapshotCount++;
      }
    }

    // --- Flip the campaign to active ---
    const updateCampaign = db.prepare(
      `UPDATE Campaign
       SET status = 'active', activatedAt = ?, updatedAt = datetime('now')
       WHERE id = ?`
    ).bind(now, id);

    // --- Execute the batch ---
    const batchResults = await db.batch([
      deleteOptionSnapshots,
      deleteSnapshots,
      ...snapshotStatements,
      updateCampaign,
    ]);

    // The last result is the campaign update; read back the updated row.
    const updatedRow = await db.prepare(
      `SELECT id, status, activatedAt FROM Campaign WHERE id = ?`
    ).bind(id).first() as Record<string, unknown>;

    // Count active enabled executives from the fetched data.
    const executiveCount = executives.results.filter(
      (ce: Record<string, unknown>) =>
        ce.isEnabled && ce.execIsActive && !ce.execDeletedAt
    ).length;

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
        newStatus: updatedRow.status,
        questionSnapshots: snapshotCount,
        optionSnapshots: optionSnapshotCount,
        activeExecutives: executiveCount,
      },
    });

    return ok({
      id: updatedRow.id,
      status: updatedRow.status,
      activatedAt: updatedRow.activatedAt,
      snapshotCount,
      optionSnapshotCount,
    });
  }
);
