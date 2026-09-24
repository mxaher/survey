import { NextRequest } from "next/server";
import { ok, fail, apiHandler } from "@/lib/api";
import { getAdminUser } from "@/lib/admin-auth";
import { MESSAGES } from "@/lib/messages";
import { checkReadiness } from "@/lib/readiness";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/campaigns/[id]/readiness
 * Returns the readiness check result for the campaign.
 */
export const GET = apiHandler(
  async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const admin = await getAdminUser();
    if (!admin) return fail(MESSAGES.unauthorized, 401);

    const { id } = await ctx.params;
    const result = await checkReadiness(id);
    if (!result.campaign) {
      return fail("الحملة غير موجودة.", 404);
    }
    return ok(result);
  }
);
