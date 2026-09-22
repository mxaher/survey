import { db } from "../src/lib/db";
import { computeEmployeeHmac, newResponseGroupId } from "../src/lib/employee-hmac";

async function submitSection(opts: {
  campaignId: string;
  employeeId: string;
  section: "environment" | "future";
  snapshots: Array<{ id: string; options: Array<{ value: string; score: number | null }> }>;
}) {
  const hmac = computeEmployeeHmac(opts.employeeId);
  const scopeKey = opts.section;
  // Idempotent: skip if already submitted
  const existing = await db.participationLedger.findUnique({
    where: {
      campaignId_employeeHmac_participationType_scopeKey: {
        campaignId: opts.campaignId,
        employeeHmac: hmac,
        participationType: opts.section,
        scopeKey,
      },
    },
  });
  if (existing) return false;

  await db.participationLedger.create({
    data: {
      campaignId: opts.campaignId,
      employeeHmac: hmac,
      participationType: opts.section,
      scopeKey,
      status: "submitted",
      submittedAt: new Date(),
    },
  });

  const rg = newResponseGroupId();
  const responses = opts.snapshots.map((s) => {
    // Pick a semi-random option for variety
    const r = Math.random();
    let opt;
    if (opts.section === "environment") {
      // Agreement scale: mostly agree/strongly-agree
      if (r < 0.5) opt = s.options.find((o) => o.value === "agree_strongly");
      else if (r < 0.8) opt = s.options.find((o) => o.value === "agree");
      else if (r < 0.95) opt = s.options.find((o) => o.value === "neutral");
      else opt = s.options.find((o) => o.value === "disagree");
    } else {
      // Future: pick 1-3 random options
      const shuffled = [...s.options].sort(() => Math.random() - 0.5);
      opt = shuffled[0];
    }
    const finalOpt = opt ?? s.options[0];
    return db.response.create({
      data: {
        campaignId: opts.campaignId,
        responseGroupId: rg,
        questionSnapshotId: s.id,
        selectedValue: finalOpt.value,
        selectedScore: finalOpt.score,
        responseType: opts.section,
        submittedAt: new Date(),
      },
    });
  });
  // For future multi-choice, add 1-2 more options
  if (opts.section === "future") {
    opts.snapshots.forEach((s, i) => {
      const max = 3;
      const extra = Math.floor(Math.random() * 2) + 0; // 0-1 extra
      for (let j = 1; j <= extra && j < s.options.length && j < max; j++) {
        const opt = s.options[j];
        if (opt) {
          responses.push(
            db.response.create({
              data: {
                campaignId: opts.campaignId,
                responseGroupId: rg,
                questionSnapshotId: s.id,
                selectedValue: opt.value,
                selectedScore: opt.score,
                responseType: opts.section,
                submittedAt: new Date(),
              },
            })
          );
        }
      }
    });
  }
  await db.$transaction(responses);
  return true;
}

async function main() {
  const c = await db.campaign.findFirst({ where: { status: "active" } });
  if (!c) throw new Error("no active campaign");

  const [envSnaps, futureSnaps] = await Promise.all([
    db.campaignQuestionSnapshot.findMany({
      where: { campaignId: c.id, section: "environment" },
      include: { options: true },
    }),
    db.campaignQuestionSnapshot.findMany({
      where: { campaignId: c.id, section: "future" },
      include: { options: true },
    }),
  ]);

  const employees = Array.from({ length: 6 }, (_, i) => `dev-emp-00${i + 1}@almrshd.local`);
  let envCount = 0;
  let futureCount = 0;
  for (const emp of employees) {
    if (await submitSection({ campaignId: c.id, employeeId: emp, section: "environment", snapshots: envSnaps })) envCount++;
    if (await submitSection({ campaignId: c.id, employeeId: emp, section: "future", snapshots: futureSnaps })) futureCount++;
  }
  console.log(`seeded ${envCount} environment + ${futureCount} future submissions`);
}

main().finally(() => db.$disconnect());
