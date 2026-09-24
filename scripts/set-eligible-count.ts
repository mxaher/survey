import { db } from "../src/lib/db";
async function main() {
  // Default eligible count = 50 (typical mid-size org)
  const existing = await db.systemSetting.findUnique({ where: { key: "eligible_employees_count" } });
  if (existing) {
    console.log("already set:", existing.valueAr);
    return;
  }
  await db.systemSetting.create({
    data: {
      key: "eligible_employees_count",
      valueAr: "50",
    },
  });
  console.log("created eligible_employees_count = 50");
}
main().finally(() => db.$disconnect());
