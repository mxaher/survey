import { db } from "../src/lib/db";
import { computeEmployeeHmac, newResponseGroupId } from "../src/lib/employee-hmac";

async function submitExecutiveEval(campaignId: string, employeeId: string, executiveId: string) {
  const hmac = computeEmployeeHmac(employeeId);
  try {
    await db.participationLedger.create({
      data: {
        campaignId, executiveId, employeeHmac: hmac,
        participationType: "executive", scopeKey: executiveId,
        status: "submitted", submittedAt: new Date(),
      },
    });
  } catch (e: any) {
    if (e?.code === "P2002") return false;
    throw e;
  }
  const snaps = await db.campaignQuestionSnapshot.findMany({
    where: { campaignId, section: "leadership" }, include: { options: true },
  });
  const rg = newResponseGroupId();
  const responses = snaps.map((s) => {
    const r = Math.random();
    let v = "always";
    if (r > 0.4 && r < 0.65) v = "often";
    else if (r >= 0.65 && r < 0.85) v = "sometimes";
    else if (r >= 0.85) v = "rarely";
    const opt = s.options.find((o) => o.value === v) ?? s.options[0];
    return db.response.create({
      data: {
        campaignId, executiveId, responseGroupId: rg,
        questionSnapshotId: s.id, selectedValue: opt.value,
        selectedScore: opt.score, responseType: "executive",
        submittedAt: new Date(),
      },
    });
  });
  await db.$transaction(responses);
  return true;
}

async function main() {
  const c = await db.campaign.findFirst({ where: { status: "active" } });
  if (!c) throw new Error("no active campaign");
  const execs = await db.campaignExecutive.findMany({
    where: { campaignId: c.id, isEnabled: true }, orderBy: { displayOrder: "asc" }, take: 5,
  });
  // 6 employees each evaluating all 5 execs → 6 per exec (≥5 threshold)
  const employees = Array.from({ length: 6 }, (_, i) => `dev-emp-00${i + 1}@almrshd.local`);
  let count = 0;
  for (const emp of employees) {
    for (const ex of execs) {
      if (await submitExecutiveEval(c.id, emp, ex.executiveId)) count++;
    }
  }
  console.log(`seeded ${count} executive evaluations across 6 employees × 5 execs`);
}

main().finally(() => db.$disconnect());
