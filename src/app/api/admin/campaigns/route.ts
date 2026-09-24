import { NextRequest } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/campaigns
 * Returns all campaigns, newest first, with assignment / response counts
 * for the admin list view.
 */
export const GET = apiHandler(async () => {
  const admin = await getAdminUser();
  if (!admin) return fail(MESSAGES.unauthorized, 401);

  const db = getDB();

  const campaigns = await db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM CampaignExecutive WHERE campaignId = c.id) AS execCount,
      (SELECT COUNT(*) FROM CampaignQuestionConfig WHERE campaignId = c.id) AS qConfigCount,
      (SELECT COUNT(*) FROM Response WHERE campaignId = c.id) AS responseCount,
      (SELECT COUNT(*) FROM ParticipationLedger WHERE campaignId = c.id) AS ledgerCount,
      (SELECT COUNT(*) FROM CampaignQuestionSnapshot WHERE campaignId = c.id) AS snapshotCount
    FROM Campaign c ORDER BY c.createdAt DESC
  `).all();

  return ok(
    campaigns.results.map((c: Record<string, unknown>) => ({
      id: c.id,
      titleAr: c.titleAr,
      descriptionAr: c.descriptionAr,
      status: c.status,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      timezone: c.timezone,
      minimumReportingThreshold: c.minimumReportingThreshold,
      enableEnvironmentSurvey: c.enableEnvironmentSurvey,
      enableFutureSurvey: c.enableFutureSurvey,
      allowMultipleExecutiveEvaluations: c.allowMultipleExecutiveEvaluations,
      minExecutives: c.minExecutives,
      maxExecutives: c.maxExecutives,
      allowResume: c.allowResume,
      activatedAt: c.activatedAt,
      closedAt: c.closedAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      counts: {
        executives: c.execCount,
        questions: c.qConfigCount,
        responses: c.responseCount,
        participationLedger: c.ledgerCount,
        questionSnapshots: c.snapshotCount,
      },
    }))
  );
});

/**
 * POST /api/admin/campaigns
 * Create a new draft campaign. Required: titleAr (non-empty).
 */
const createSchema = z
  .object({
    titleAr: z.string().trim().min(1, "title required"),
    descriptionAr: z.string().trim().optional().nullable(),
    instructionsAr: z.string().trim().optional().nullable(),
    startsAt: z.coerce.date().optional().nullable(),
    endsAt: z.coerce.date().optional().nullable(),
    timezone: z.string().trim().default("Asia/Riyadh"),
    minimumReportingThreshold: z.coerce.number().int().min(1).default(5),
    enableEnvironmentSurvey: z.coerce.boolean().default(true),
    enableFutureSurvey: z.coerce.boolean().default(true),
    allowMultipleExecutiveEvaluations: z.coerce.boolean().default(true),
    minExecutives: z.coerce.number().int().min(1).optional().nullable(),
    maxExecutives: z.coerce.number().int().min(1).optional().nullable(),
    allowResume: z.coerce.boolean().default(true),
    privacyNoticeAr: z.string().trim().optional().nullable(),
  })
  .refine(
    (data) => {
      if (data.startsAt && data.endsAt) {
        return data.endsAt > data.startsAt;
      }
      return true;
    },
    { message: "يجب أن يكون تاريخ انتهاء الحملة بعد تاريخ بدئها.", path: ["endsAt"] }
  )
  .refine(
    (data) => {
      if (
        data.minExecutives !== null &&
        data.minExecutives !== undefined &&
        data.maxExecutives !== null &&
        data.maxExecutives !== undefined
      ) {
        return data.minExecutives <= data.maxExecutives;
      }
      return true;
    },
    {
      message: "الحد الأدنى لعدد المسؤولين أكبر من الحد الأقصى.",
      path: ["maxExecutives"],
    }
  );

export const POST = apiHandler(async (request: NextRequest) => {
  const admin = await getAdminUser();
  if (!admin) return fail(MESSAGES.unauthorized, 401);

  const json = await request.json().catch(() => null);
  if (!json) return fail("صيغة الطلب غير صالحة.", 400);

  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return fail(
      parsed.error.issues?.[0]?.message ?? MESSAGES.configIncomplete,
      422
    );
  }
  const input = parsed.data;

  const db = getDB();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO Campaign
      (id, titleAr, descriptionAr, instructionsAr, status, startsAt, endsAt,
       timezone, minimumReportingThreshold, enableEnvironmentSurvey, enableFutureSurvey,
       allowMultipleExecutiveEvaluations, minExecutives, maxExecutives, allowResume,
       privacyNoticeAr, createdBy, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    input.titleAr,
    input.descriptionAr ?? null,
    input.instructionsAr ?? null,
    input.startsAt ? input.startsAt.toISOString() : null,
    input.endsAt ? input.endsAt.toISOString() : null,
    input.timezone,
    input.minimumReportingThreshold,
    input.enableEnvironmentSurvey ? 1 : 0,
    input.enableFutureSurvey ? 1 : 0,
    input.allowMultipleExecutiveEvaluations ? 1 : 0,
    input.minExecutives ?? null,
    input.maxExecutives ?? null,
    input.allowResume ? 1 : 0,
    input.privacyNoticeAr ?? null,
    admin.adminId,
    now,
    now
  ).run();

  await writeAudit({
    adminUserId: admin.adminId,
    action: "campaign.create",
    entityType: "campaign",
    entityId: id,
    campaignId: id,
    metadata: {
      titleAr: input.titleAr,
      status: "draft",
    },
  });

  return ok(
    {
      id,
      titleAr: input.titleAr,
      status: "draft",
      createdAt: now,
    },
    { status: 201 }
  );
});
