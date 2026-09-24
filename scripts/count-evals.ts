import { db } from "../src/lib/db";
async function main() {
  const c = await db.campaign.findFirst({ where: { status: "active" } });
  if (!c) return console.log("no active campaign");
  const counts = await db.response.groupBy({
    by: ["executiveId"],
    where: { campaignId: c.id, responseType: "executive" },
    _count: { _all: true },
  });
  // For each executive, count distinct responseGroupId (= unique employees)
  const execs = await db.executive.findMany();
  console.log("Distinct evaluations per executive:");
  for (const e of execs) {
    const groups = await db.response.findMany({
      where: { campaignId: c.id, executiveId: e.id, responseType: "executive" },
      distinct: ["responseGroupId"], select: { responseGroupId: true },
    });
    console.log(`  ${e.nameAr}: ${groups.length} unique evaluations`);
  }
}
main().finally(() => db.$disconnect());
