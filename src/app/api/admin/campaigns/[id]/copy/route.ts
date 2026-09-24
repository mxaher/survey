import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

const COPY_SUFFIX = " (نسخة)";

/**
 * POST /api/admin/campaigns/[id]/copy
 * Creates a new DRAFT campaign copying fields + executive + question assignments.
 * Wrapped in D1 batch for atomicity.
 */
export const POST = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const db = getDB();
    const { id } = await ctx.params;

    const source = await db.prepare(
      `SELECT * FROM Campaign WHERE id = ?`
    ).bind(id).first() as Record<string, unknown> | null;
    if (!source) return fail("الحملة غير موجودة.", 404);

    // Fetch executives and question configs
    const execRows = await db.prepare(
      `SELECT * FROM CampaignExecutive WHERE campaignId = ?`
    ).bind(id).all();

    const qcRows = await db.prepare(
      `SELECT * FROM CampaignQuestionConfig WHERE campaignId = ?`
    ).bind(id).all();

    const newId = crypto.randomUUID();
    const now = new Date().toISOString();
    const newTitle = `${source.titleAr}${COPY_SUFFIX}`;

    const statements: ReturnType<typeof db.prepare>[] = [];

    // 1. Insert new campaign
    statements.push(
      db.prepare(
        `INSERT INTO Campaign
          (id, titleAr, descriptionAr, instructionsAr, status, startsAt, endsAt,
           timezone, minimumReportingThreshold, enableEnvironmentSurvey, enableFutureSurvey,
           allowMultipleExecutiveEvaluations, minExecutives, maxExecutives, allowResume,
           privacyNoticeAr, activatedAt, closedAt, createdBy, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, 'draft', null, null, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, null, ?, ?, ?)`
      ).bind(
        newId,
        newTitle,
        source.descriptionAr,
        source.instructionsAr,
        source.timezone,
        source.minimumReportingThreshold,
        source.enableEnvironmentSurvey ? 1 : 0,
        source.enableFutureSurvey ? 1 : 0,
        source.allowMultipleExecutiveEvaluations ? 1 : 0,
        source.minExecutives ?? null,
        source.maxExecutives ?? null,
        source.allowResume ? 1 : 0,
        source.privacyNoticeAr ?? null,
        admin.adminId,
        now,
        now
      )
    );

    // 2. Copy executive assignments
    for (const ce of execRows.results) {
      statements.push(
        db.prepare(
          `INSERT INTO CampaignExecutive
            (campaignId, executiveId, displayOrder, isEnabled, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          newId,
          ce.executiveId,
          ce.displayOrder,
          ce.isEnabled ? 1 : 0,
          now,
          now
        )
      );
    }

    // 3. Copy question configs
    for (const qc of qcRows.results) {
      statements.push(
        db.prepare(
          `INSERT INTO CampaignQuestionConfig
            (campaignId, questionId, scope, isRequired, displayOrder, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          newId,
          qc.questionId,
          qc.scope,
          qc.isRequired ? 1 : 0,
          qc.displayOrder,
          now,
          now
        )
      );
    }

    await db.batch(statements);

    await writeAudit({
      adminUserId: admin.adminId,
      action: "campaign.copy",
      entityType: "campaign",
      entityId: newId,
      campaignId: newId,
      metadata: {
        sourceCampaignId: id,
        newTitle,
        copiedExecutives: execRows.results.length,
        copiedQuestions: qcRows.results.length,
      },
    });

    return ok(
      {
        id: newId,
        titleAr: newTitle,
        status: "draft",
        createdAt: now,
        copiedExecutives: execRows.results.length,
        copiedQuestions: qcRows.results.length,
      },
      { status: 201 }
    );
  }
);
