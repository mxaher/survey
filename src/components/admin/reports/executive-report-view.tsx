"use client";

import { useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ChevronDown,
  Download,
  Image as ImageIcon,
  Lock,
  Printer,
  TrendingUp,
  TrendingDown,
  Star,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MESSAGES } from "@/lib/messages";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

type Envelope<T> = { ok: boolean; data: T };

type DistributionEntry = {
  value: string;
  labelAr: string;
  count: number;
};

type QuestionAggregate = {
  snapshotId: string;
  questionCode: string | null;
  questionAr: string;
  dimension: string | null;
  count: number;
  validCount: number;
  averageScore: number | null;
  distribution: DistributionEntry[];
  favorableRate: number | null;
  notApplicableCount: number;
  perQuestionSuppressed?: boolean;
};

type DimensionAggregate = {
  dimension: string;
  dimensionLabelAr: string;
  averageScore: number;
  questionCount?: number;
};

type OrgWideComparison = {
  totalResponses: number;
  suppressed: boolean;
  dimensions: DimensionAggregate[];
};

type ExecutiveReport =
  | {
      suppressed: true;
      message: string;
      threshold: number;
      evaluationCount: number;
      campaign: { id: string; titleAr: string; status: string };
      executive: { id: string; nameAr: string; titleAr: string | null };
      questions: never[];
      dimensions: never[];
      strength: null;
      improvement: null;
      orgWideComparison: null;
    }
  | {
      suppressed: false;
      threshold: number;
      evaluationCount: number;
      campaign: { id: string; titleAr: string; status: string };
      executive: {
        id: string;
        nameAr: string;
        titleAr: string | null;
        category: string | null;
        departmentAr: string | null;
      };
      questions: QuestionAggregate[];
      dimensions: DimensionAggregate[];
      strength: DimensionAggregate | null;
      improvement: DimensionAggregate | null;
      orgWideComparison: OrgWideComparison | null;
    };

function formatPct(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function formatAvg(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return n.toFixed(2);
}

export function ExecutiveReportView({
  campaignId,
  executiveId,
}: {
  campaignId: string;
  executiveId: string;
}) {
  const router = useRouter();
  const chartRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError } = useQuery<Envelope<ExecutiveReport>>({
    queryKey: ["admin-exec-report", campaignId, executiveId],
    queryFn: () =>
      fetchJson<Envelope<ExecutiveReport>>(
        `/api/admin/reports/${campaignId}/executive/${executiveId}`
      ),
    enabled: !!campaignId && !!executiveId,
  });

  // === All hooks must run unconditionally on every render ===
  // We compute safe fallbacks from `data?.data` so the hooks below can run
  // even before the query has loaded. Only after the hooks may we early-return.
  const r0 = data?.data;
  const execDims = r0 && !r0.suppressed ? r0.dimensions : [];
  const execOrg = r0 && !r0.suppressed ? r0.orgWideComparison : null;
  const execQuestions = r0 && !r0.suppressed ? r0.questions : [];

  // Top 3 strengths (highest) and bottom 3 improvements (lowest).
  const sortedDims = useMemo(
    () =>
      [...execDims].sort((a, b) => b.averageScore - a.averageScore),
    [execDims]
  );
  const strengths = sortedDims.slice(0, 3);
  const improvements = sortedDims
    .slice(Math.max(0, sortedDims.length - 3))
    .reverse();

  // Org-wide comparison map for reference line (avg of org dimension averages
  // for which this exec has a matching dimension).
  const orgDimMap = useMemo(() => {
    const m = new Map<string, number>();
    if (execOrg && !execOrg.suppressed) {
      for (const d of execOrg.dimensions) {
        m.set(d.dimension, d.averageScore);
      }
    }
    return m;
  }, [execOrg]);

  // Overall org average (mean of org dimension averages — used as a single
  // reference line in the dimension chart).
  const orgAvgLine = useMemo(() => {
    if (!execOrg || execOrg.suppressed) return null;
    const arr = execOrg.dimensions;
    if (arr.length === 0) return null;
    return arr.reduce((s, d) => s + d.averageScore, 0) / arr.length;
  }, [execOrg]);

  if (isLoading) return <LoadingSkeleton />;
  if (isError || !data) {
    return (
      <EmptyState
        icon={<Star className="h-8 w-8" />}
        title="تعذّر تحميل تقرير المسؤول"
        description="ربما لا يوجد مسؤول بهذا المعرّف أو حدث خطأ غير متوقع."
        action={
          <Button
            variant="outline"
            onClick={() =>
              router.push(
                `/?view=admin&tab=reports&sub=campaign&id=${campaignId}`
              )
            }
          >
            <ArrowRight className="h-4 w-4" />
            العودة لتفاصيل الحملة
          </Button>
        }
      />
    );
  }

  const r = data.data;
  // `isSuppressed`, `execDims`, `execOrg`, `execQuestions` already computed above.

  if (r.suppressed) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={`${r.executive.nameAr} — ${r.executive.titleAr ?? "بدون مسمى"}`}
          actions={
            <Button
              variant="ghost"
              onClick={() =>
                router.push(
                  `/?view=admin&tab=reports&sub=campaign&id=${campaignId}`
                )
              }
              className="min-h-11 no-print"
            >
              <ArrowRight className="h-4 w-4" />
              العودة لتفاصيل الحملة
            </Button>
          }
        />
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertTitle>النتائج غير متاحة</AlertTitle>
          <AlertDescription>{r.message ?? MESSAGES.belowThreshold}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const overallAvg =
    execDims.length > 0
      ? execDims.reduce((s, d) => s + d.averageScore, 0) /
        execDims.length
      : null;
  const overallFavorable =
    execQuestions.length > 0
      ? (() => {
          let sum = 0;
          let n = 0;
          for (const q of r.questions) {
            if (q.favorableRate != null) {
              sum += q.favorableRate;
              n += 1;
            }
          }
          return n > 0 ? sum / n : null;
        })()
      : null;

  const chartData = r.dimensions.map((d) => ({
    dimension: d.dimensionLabelAr,
    score: Number(d.averageScore.toFixed(2)),
    orgScore: orgDimMap.get(d.dimension) ?? null,
  }));

  // Download the dimension chart as a PNG. Renders the SVG to a canvas,
  // then triggers a download. The chart keeps its CSS colors because we
  // inline them via `fill` attributes on each Cell.
  const downloadChartPng = () => {
    const container = chartRef.current;
    if (!container) return;
    const svg = container.querySelector("svg");
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = 2; // 2x for crisp output
      const w = svg.clientWidth || svg.parentElement?.clientWidth || 800;
      const h = svg.clientHeight || svg.parentElement?.clientHeight || 450;
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);

      canvas.toBlob((blob) => {
        if (!blob) return;
        const dlUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = dlUrl;
        a.download = `dimension-chart-${r.executive.nameAr}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(dlUrl);
      }, "image/png");
    };
    img.src = url;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${r.executive.nameAr}`}
        description={
          [r.executive.titleAr, r.executive.departmentAr]
            .filter(Boolean)
            .join(" — ") ?? undefined
        }
        eyebrow="تقرير تقييم المسؤول"
        actions={
          <div className="flex flex-wrap gap-2 no-print">
            <Button
              variant="secondary"
              onClick={() => window.print()}
              className="min-h-11"
            >
              <Printer className="h-4 w-4" />
              طباعة
            </Button>
            <Button
              variant="outline"
              onClick={downloadChartPng}
              className="min-h-11"
              disabled={r.dimensions.length === 0}
              title="تنزيل مخطط الأبعاد كصورة PNG"
            >
              <ImageIcon className="h-4 w-4" />
              تنزيل المخطط
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                router.push(
                  `/?view=admin&tab=reports&sub=campaign&id=${campaignId}`
                )
              }
              className="min-h-11"
            >
              <ArrowRight className="h-4 w-4" />
              العودة لتفاصيل الحملة
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Badge variant="outline">الحملة: {r.campaign.titleAr}</Badge>
        <span>عدد التقييمات: {r.evaluationCount}</span>
        <span className="text-border">|</span>
        <span>حد الإخفاء: {r.threshold}</span>
        {overallAvg != null && orgAvgLine != null && (
          <Badge
            variant="outline"
            className={
              overallAvg >= orgAvgLine
                ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                : "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            }
          >
            {overallAvg >= orgAvgLine
              ? "أداء يتجاوز متوسط المؤسسة"
              : "أداء ضمن متوسط المؤسسة"}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          title="عدد التقييمات"
          value={r.evaluationCount}
          icon={<Star className="h-4 w-4" />}
          hint="تقييمات مستقلة لهذا المسؤول"
          tone="navy"
        />
        <StatCard
          title="متوسط الدرجة العام"
          value={formatAvg(overallAvg)}
          icon={<TrendingUp className="h-4 w-4" />}
          hint="مقياس 1–5 (متوسط الأبعاد)"
          tone="gold"
        />
        <StatCard
          title="نسبة الإجابات الإيجابية"
          value={formatPct(overallFavorable)}
          icon={<TrendingUp className="h-4 w-4" />}
          hint="متوسط نسبة (دائماً/غالباً أوافق بشدة/أوافق)"
          tone="emerald"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">متوسطات الأبعاد</CardTitle>
        </CardHeader>
        <CardContent>
          {r.dimensions.length === 0 ? (
            <EmptyState
              title="لا توجد أبعاد قابلة للعرض"
              description="لم تُسجَّل إجابات مؤهَّلة لهذا المسؤول بعد."
            />
          ) : (
            <>
              <div ref={chartRef} className="h-[28rem] w-full" dir="rtl">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    layout="vertical"
                    margin={{ top: 8, right: 24, bottom: 8, left: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      domain={[0, 5]}
                      tick={{ fontSize: 12 }}
                      allowDecimals={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="dimension"
                      width={140}
                      tick={{ fontSize: 12 }}
                      interval={0}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--muted)", opacity: 0.3 }}
                      formatter={(v: number, name) =>
                        name === "score"
                          ? [Number(v).toFixed(2), "متوسط هذا المسؤول"]
                          : [v == null ? "—" : Number(v).toFixed(2), "متوسط المؤسسة"]
                      }
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        fontSize: 12,
                      }}
                    />
                    {orgAvgLine != null && (
                      <ReferenceLine
                        x={orgAvgLine}
                        stroke="var(--chart-2)"
                        strokeDasharray="0"
                        strokeWidth={2}
                        label={{
                          value: `متوسط المؤسسة ${orgAvgLine.toFixed(2)}`,
                          position: "top",
                          fill: "var(--chart-2)",
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      />
                    )}
                    <Bar
                      dataKey="score"
                      fill="var(--chart-1)"
                      radius={[0, 6, 6, 0]}
                      maxBarSize={28}
                    >
                      {chartData.map((entry, i) => {
                        const below =
                          entry.orgScore != null && entry.score < entry.orgScore;
                        return (
                          <Cell
                            key={i}
                            fill={below ? "var(--chart-5)" : "var(--chart-1)"}
                          />
                        );
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-3 w-3 rounded-sm"
                    style={{ background: "var(--chart-1)" }}
                  />
                  أعلى من متوسط المؤسسة
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-3 w-3 rounded-sm"
                    style={{ background: "var(--chart-5)" }}
                  />
                  أدنى من متوسط المؤسسة
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-0.5 w-4"
                    style={{ background: "var(--chart-2)" }}
                  />
                  خط متوسط المؤسسة
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <TrendingUp className="h-5 w-5 text-emerald-600" />
              نقاط القوة
            </CardTitle>
          </CardHeader>
          <CardContent>
            {strengths.length === 0 ? (
              <EmptyState title="لا توجد نقاط قوة" description="لا توجد أبعاد مؤهَّلة." />
            ) : (
              <ol className="flex flex-col gap-2">
                {strengths.map((d, i) => (
                  <li
                    key={d.dimension}
                    className="flex items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900/40 dark:bg-emerald-900/10"
                  >
                    <div className="flex items-center gap-2">
                      <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-600 text-xs font-bold text-white">
                        {i + 1}
                      </span>
                      <span className="font-medium text-foreground">
                        {d.dimensionLabelAr}
                      </span>
                    </div>
                    <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                      {d.averageScore.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <TrendingDown className="h-5 w-5 text-rose-600" />
              مجالات التحسين
            </CardTitle>
          </CardHeader>
          <CardContent>
            {improvements.length === 0 ? (
              <EmptyState title="لا توجد مجالات تحسين" description="لا توجد أبعاد مؤهَّلة." />
            ) : (
              <ol className="flex flex-col gap-2">
                {improvements.map((d, i) => (
                  <li
                    key={d.dimension}
                    className="flex items-center justify-between gap-3 rounded-md border border-rose-200 bg-rose-50/50 p-3 dark:border-rose-900/40 dark:bg-rose-900/10"
                  >
                    <div className="flex items-center gap-2">
                      <span className="grid h-7 w-7 place-items-center rounded-full bg-rose-600 text-xs font-bold text-white">
                        {i + 1}
                      </span>
                      <span className="font-medium text-foreground">
                        {d.dimensionLabelAr}
                      </span>
                    </div>
                    <span className="font-semibold text-rose-700 dark:text-rose-300">
                      {d.averageScore.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">تفصيل الأسئلة</CardTitle>
        </CardHeader>
        <CardContent>
          {r.questions.length === 0 ? (
            <EmptyState title="لا توجد أسئلة مؤهَّلة" />
          ) : (
            <div className="flex flex-col gap-2">
              {r.questions.map((q) => (
                <QuestionRow key={q.snapshotId} question={q} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function QuestionRow({ question }: { question: QuestionAggregate }) {
  const dist = question.distribution.filter((d) => d.count > 0);
  const hasData = dist.length > 0;
  const suppressed = question.perQuestionSuppressed === true;

  const chartData = question.distribution.map((d) => ({
    label: d.labelAr,
    count: d.count,
  }));

  return (
    <Collapsible className="rounded-lg border border-border bg-background p-3">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 text-start outline-none">
        <div className="flex flex-col">
          <span className="font-medium text-foreground">
            {question.questionAr}
          </span>
          <span className="mt-0.5 text-xs text-muted-foreground">
            {suppressed
              ? `عدد الإجابات: ${question.count} — أقل من حد الإخفاء، تم إخفاء التفاصيل`
              : `المتوسط: ${formatAvg(question.averageScore)} • نسبة الإيجابية: ${formatPct(question.favorableRate)} • عدد الإجابات: ${question.count}`}
          </span>
        </div>
        {suppressed ? (
          <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform [[data-state=open]_&]:rotate-180" />
        )}
      </CollapsibleTrigger>
      {hasData && !suppressed && (
        <CollapsibleContent>
          <div className="mt-4 flex flex-col gap-4">
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={120}
                    tick={{ fontSize: 11 }}
                    interval={0}
                  />
                  <Tooltip formatter={(v: number) => [v, "العدد"]} />
                  <Bar
                    dataKey="count"
                    fill="var(--chart-1)"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الإجابة</TableHead>
                  <TableHead>العدد</TableHead>
                  <TableHead>النسبة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {question.distribution.map((d) => {
                  const pct =
                    question.count > 0
                      ? Math.round((d.count / question.count) * 1000) / 10
                      : 0;
                  return (
                    <TableRow key={d.value}>
                      <TableCell className="font-medium">
                        {d.labelAr}
                      </TableCell>
                      <TableCell>{d.count}</TableCell>
                      <TableCell>{pct}%</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-10 w-1/2" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-80 w-full" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}
