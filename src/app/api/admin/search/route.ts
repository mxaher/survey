import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
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

    const db = getDB();

    const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) {
      return ok({ campaigns: [], questions: [], executives: [] });
    }

    const pattern = `%${q}%`;

    const [campaigns, questions, executives] = await Promise.all([
      db
        .prepare(
          "SELECT id, titleAr, status, descriptionAr FROM Campaign WHERE titleAr LIKE ? OR descriptionAr LIKE ? ORDER BY updatedAt DESC LIMIT 5"
        )
        .bind(pattern, pattern)
        .all()
        .catch(() => ({ results: [] })),
      db
        .prepare(
          "SELECT id, code, questionAr, section, questionType, isActive FROM Question WHERE (questionAr LIKE ? OR code LIKE ?) AND deletedAt IS NULL ORDER BY displayOrder ASC LIMIT 5"
        )
        .bind(pattern, pattern)
        .all()
        .catch(() => ({ results: [] })),
      db
        .prepare(
          "SELECT id, nameAr, titleAr, category, departmentAr, isActive FROM Executive WHERE (nameAr LIKE ? OR titleAr LIKE ? OR departmentAr LIKE ?) AND deletedAt IS NULL ORDER BY displayOrder ASC LIMIT 5"
        )
        .bind(pattern, pattern, pattern)
        .all()
        .catch(() => ({ results: [] })),
    ]);

    return ok({
      campaigns: (campaigns.results ?? []).map((c) => ({
        id: c.id,
        titleAr: c.titleAr,
        status: c.status,
        descriptionAr: c.descriptionAr,
      })),
      questions: (questions.results ?? []).map((q2) => ({
        id: q2.id,
        code: q2.code,
        questionAr: q2.questionAr,
        section: q2.section,
        questionType: q2.questionType,
        isActive: q2.isActive,
      })),
      executives: (executives.results ?? []).map((e) => ({
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
