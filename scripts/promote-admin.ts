import { db } from "../src/lib/db";
async function main() {
  await db.adminUser.updateMany({
    where: { externalId: "dev-survey-admin@almrshad.local" },
    data: { role: "SUPER_ADMIN" },
  });
  const a = await db.adminUser.findFirst({ where: { externalId: "dev-survey-admin@almrshad.local" } });
  console.log("promoted to:", a?.role);
}
main().finally(() => db.$disconnect());
