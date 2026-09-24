import { db } from "../src/lib/db";
async function main() {
  // Delete the test draft campaign created during DnD testing
  const result = await db.campaign.deleteMany({
    where: { titleAr: "حملة اختبار DnD", status: "draft" },
  });
  console.log("deleted test campaigns:", result.count);
}
main().finally(() => db.$disconnect());
