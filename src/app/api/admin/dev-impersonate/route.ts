import { NextResponse, NextRequest } from "next/server";
import {
  setDevEmployee,
  clearDevEmployee,
  listDevEmployees,
  setDevEmployeesList,
  getVerifiedEmployee,
} from "@/lib/identity";
import { getAdminUser } from "@/lib/admin-auth";
import { ok, fail, apiHandler } from "@/lib/api";
import { z } from "zod";

/** GET /api/admin/dev-impersonate
 *  - returns the currently impersonated employee + the known dev roster.
 *  Admin-only. Used by the Employee Picker widget in the admin shell. */
export const GET = apiHandler(async () => {
  const admin = await getAdminUser();
  if (!admin) return fail("غير مصرّح", 401);

  const current = await getVerifiedEmployee();
  const roster = await listDevEmployees();
  return ok({ current, roster });
});

const setSchema = z.object({
  action: z.enum(["set", "clear", "setRoster"]),
  employee: z
    .object({
      externalId: z.string(),
      displayName: z.string().optional(),
      role: z.string().optional(),
      department: z.string().optional(),
      isActive: z.boolean().optional(),
    })
    .optional(),
  roster: z
    .array(
      z.object({
        externalId: z.string(),
        displayName: z.string().optional(),
        role: z.string().optional(),
        department: z.string().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .optional(),
});

/** POST /api/admin/dev-impersonate  { action: "set"|"clear"|"setRoster", ... } */
export const POST = apiHandler(async (req: NextRequest) => {
  const admin = await getAdminUser();
  if (!admin) return fail("غير مصرّح", 401);
  // Note: this deployment runs the dev-mode identity provider in every
  // environment (there is no SSO), so the picker must work in production too.

  const body = await req.json().catch(() => null);
  const parsed = setSchema.safeParse(body);
  if (!parsed.success) return fail("بيانات غير صالحة", 400);
  const { action } = parsed.data;

  if (action === "set") {
    if (!parsed.data.employee) return fail("بيانات الموظف ناقصة", 400);
    await setDevEmployee({
      externalId: parsed.data.employee.externalId,
      displayName: parsed.data.employee.displayName,
      role: parsed.data.employee.role,
      department: parsed.data.employee.department,
      isActive: parsed.data.employee.isActive ?? true,
    });
    return ok({ set: true });
  }
  if (action === "clear") {
    await clearDevEmployee();
    return ok({ cleared: true });
  }
  if (action === "setRoster") {
    if (!parsed.data.roster) return fail("قائمة الموظفين ناقصة", 400);
    await setDevEmployeesList(
      parsed.data.roster.map((e) => ({
        externalId: e.externalId,
        displayName: e.displayName,
        role: e.role,
        department: e.department,
        isActive: e.isActive ?? true,
      }))
    );
    return ok({ set: true });
  }
  return fail("إجراء غير معروف", 400);
});
