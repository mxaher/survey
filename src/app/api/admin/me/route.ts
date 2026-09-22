import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin-auth";
import { ok, fail, apiHandler } from "@/lib/api";

export const GET = apiHandler(async () => {
  const admin = await getAdminUser();
  if (!admin) return fail("غير مصرّح", 401);
  return ok({
    adminId: admin.adminId,
    externalId: admin.externalId,
    displayName: admin.displayName,
    email: admin.email,
    role: admin.role,
  });
});
