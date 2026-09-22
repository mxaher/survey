import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
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

  const campaigns = await db.campaign.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          executives: true,
          questionConfig: true,
          responses: true,
          participationLedger: true,
          questionSnapshots: true,
        },
      },
    },
  });

  return ok(
    campaigns.map((c) => ({
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
        executives: c._count.executives,
        questions: c._count.questionConfig,
        responses: c._count.responses,
        participationLedger: c._count.participationLedger,
        questionSnapshots: c._count.questionSnapshots,
      },
    }))
  );
});

/**
 * POST /api/admin/campaigns
 * Create a new draft campaign. Required: titleAr (non-empty).
 * Optional: startsAt/endsAt (endsAt must be after startsAt if both set),
 * minimumReportingThreshold ≥ 1 (default 5), all toggles default per schema.
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

  const created = await db.campaign.create({
    data: {
      titleAr: input.titleAr,
      descriptionAr: input.descriptionAr ?? null,
      instructionsAr: input.instructionsAr ?? null,
      status: "draft",
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      timezone: input.timezone,
      minimumReportingThreshold: input.minimumReportingThreshold,
      enableEnvironmentSurvey: input.enableEnvironmentSurvey,
      enableFutureSurvey: input.enableFutureSurvey,
      allowMultipleExecutiveEvaluations:
        input.allowMultipleExecutiveEvaluations,
      minExecutives: input.minExecutives ?? null,
      maxExecutives: input.maxExecutives ?? null,
      allowResume: input.allowResume,
      privacyNoticeAr: input.privacyNoticeAr ?? null,
      createdBy: admin.adminId,
    },
  });

  await writeAudit({
    adminUserId: admin.adminId,
    action: "campaign.create",
    entityType: "campaign",
    entityId: created.id,
    campaignId: created.id,
    metadata: {
      titleAr: created.titleAr,
      status: created.status,
    },
  });

  return ok(
    {
      id: created.id,
      titleAr: created.titleAr,
      status: created.status,
      createdAt: created.createdAt,
    },
    { status: 201 }
  );
});
