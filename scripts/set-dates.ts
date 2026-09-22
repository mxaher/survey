import { db } from "../src/lib/db";
async function main() {
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 days
  await db.campaign.updateMany({
    where: { status: "draft", startsAt: null },
    data: { startsAt: now, endsAt: end },
  });
  const c = await db.campaign.findFirst({ where: { status: "draft" } });
  console.log("updated:", c?.id, c?.startsAt?.toISOString(), c?.endsAt?.toISOString());
}
main().finally(() => db.$disconnect());
