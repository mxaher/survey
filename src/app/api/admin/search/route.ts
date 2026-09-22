import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { MESSAGES } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/search?q=<query>
 *
 * Global search across campaigns, questions, and executives.
 * Auth required (both roles). Returns up to 5 results per category
 * (max 15 total) — enough for the Cmd+K command palette without
 * overwhelming the dropdown.
 *
 * NO employee identifiers — searches only admin-visible entities.
 */
export const GET = apiHandler(
  async (request: NextRequest) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) {
      return ok({ campaigns: [], questions: [], executives: [] });
    }

    // Use contains for case-insensitive substring match.
    // SQLite's default collation is case-insensitive for ASCII, but
    // Arabic text benefits from the explicit `contains` mode.
    const [campaigns, questions, executives] = await Promise.all([
      db.campaign
        .findMany({
          where: {
            OR: [
              { titleAr: { contains: q } },
              { descriptionAr: { contains: q } },
            ],
          },
          select: {
            id: true,
            titleAr: true,
            status: true,
            descriptionAr: true,
          },
          take: 5,
          orderBy: { updatedAt: "desc" },
        })
        .catch(() => []),
      db.question
        .findMany({
          where: {
            OR: [
              { questionAr: { contains: q } },
              { code: { contains: q } },
            ],
            deletedAt: null,
          },
          select: {
            id: true,
            code: true,
            questionAr: true,
            section: true,
            questionType: true,
            isActive: true,
          },
          take: 5,
          orderBy: { displayOrder: "asc" },
        })
        .catch(() => []),
      db.executive
        .findMany({
          where: {
            OR: [
              { nameAr: { contains: q } },
              { titleAr: { contains: q } },
              { departmentAr: { contains: q } },
            ],
            deletedAt: null,
          },
          select: {
            id: true,
            nameAr: true,
            titleAr: true,
            category: true,
            departmentAr: true,
            isActive: true,
          },
          take: 5,
          orderBy: { displayOrder: "asc" },
        })
        .catch(() => []),
    ]);

    return ok({
      campaigns: campaigns.map((c) => ({
        id: c.id,
        titleAr: c.titleAr,
        status: c.status,
        descriptionAr: c.descriptionAr,
      })),
      questions: questions.map((q2) => ({
        id: q2.id,
        code: q2.code,
        questionAr: q2.questionAr,
        section: q2.section,
        questionType: q2.questionType,
        isActive: q2.isActive,
      })),
      executives: executives.map((e) => ({
        id: e.id,
        nameAr: e.nameAr,
        titleAr: e.titleAr,
        category: e.category,
        departmentAr: e.departmentAr,
        isActive: e.isActive,
      })),
    });
  }
);
