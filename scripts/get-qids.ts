import { db } from "../src/lib/db";
async function main() {
  const qs = await db.question.findMany({ where: { isActive: true, deletedAt: null }, take: 5, orderBy: { displayOrder: "asc" }, select: { id: true } });
  console.log(qs.map(q => q.id).join(" "));
}
main().finally(() => db.$disconnect());
