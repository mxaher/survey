"use client";

/**
 * Cross-campaign trend / comparison view (spec §16: "Trend vs. prior
 * campaigns, once more than one exists").
 *
 * Renders:
 *  - A comparison table: one row per active/closed campaign, columns for
 *    participation counts (env / future / exec evals / distinct evaluators)
 *    + total responses + activated date.
 *  - A radar / line chart comparing per-dimension averages across campaigns
 *    (so you can see if "Respect" went up or down year-over-year).
 *  - Per-dimension trend cards: one per dimension, showing each campaign's
 *    average + a tiny sparkline.
 *
 * Privacy: all numbers are aggregates respecting each campaign's per-exec
 * threshold. No raw responses, no employee identifiers.
 *
 * Empty state: when fewer than 1 active/closed campaign exists, shows a
 * helpful "no comparable campaigns yet" message.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Minus,
  GitCompareArrows,
  Users,
  MessageSquareText,
  CalendarClock,
  ArrowRight,
  Download,
  FileSpreadsheet,
} from "lucide-react";
import {
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
  ReferenceLine,
} from "recharts";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toRiyadhDate } from "@/lib/time";
import { useRouter } from "next/navigation";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

type Envelope<T> = { ok: boolean; data: T };

type DimensionAvg = {
  dimension: string;
  labelAr: string;
  averageScore: number;
  executiveCount: number;
  responseCount: number;
};

type TrendCampaign = {
  campaign: {
    id: string;
    titleAr: string;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
    activatedAt: string | null;
    timezone: string;
    threshold: number;
  };
  totalResponses: number;
  environmentSubmittedCount: number;
  futureSubmittedCount: number;
  executiveEvaluationCount: number;
  distinctEvaluators: number;
  participationRate?: number | null;
  dimensionAverages: DimensionAvg[];
};

type TrendData = {
  campaigns: TrendCampaign[];
  eligibleCount?: number;
};

// Chart palette — distinct colors per campaign so the line chart is readable.
const CAMPAIGN_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "#0ea5e9",
  "#a855f7",
  "#ec4899",
];

export function TrendReportView() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data, isLoading, isError } = useQuery<Envelope<TrendData>>({
    queryKey: ["admin-report-trend", statusFilter],
    queryFn: () =>
      fetchJson<Envelope<TrendData>>(
        `/api/admin/reports/trend?status=${encodeURIComponent(statusFilter)}`
      ),
  });

  const campaigns = data?.data?.campaigns ?? [];

  if (isLoading) return <LoadingSkeleton />;
  if (isError) {
    return (
      <EmptyState
        icon={<BarChart3 className="h-8 w-8" />}
        title="تعذّر تحميل بيانات المقارنة"
        description="يرجى تحديث الصفحة أو المحاولة مرة أخرى لاحقًا."
      />
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="مقارنة الحملات والاتجاهات"
          description="تحليل مقارن لأبعاد القيادة عبر الحملات النشطة والمغلقة."
          actions={
            <Button
              variant="ghost"
              onClick={() => router.push("/?view=admin&tab=reports")}
              className="min-h-11 no-print"
            >
              <ArrowRight className="h-4 w-4" />
              قائمة التقارير
            </Button>
          }
        />
        <div className="flex items-center gap-3 no-print">
          <span className="text-sm text-muted-foreground">تصفية حسب الحالة:</span>
          <Select value={statusFilter} onValueChange={setStatusFilter} dir="rtl">
            <SelectTrigger className="w-48" aria-label="تصفية حسب حالة الحملة">
              <SelectValue placeholder="كل الحالات" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل (نشطة + مغلقة)</SelectItem>
              <SelectItem value="active">النشطة فقط</SelectItem>
              <SelectItem value="closed">المغلقة فقط</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <EmptyState
          icon={<GitCompareArrows className="h-8 w-8" />}
          title={
            statusFilter === "all"
              ? "لا توجد حملات قابلة للمقارنة بعد"
              : statusFilter === "active"
              ? "لا توجد حملات نشطة"
              : "لا توجد حملات مغلقة"
          }
          description={
            statusFilter === "all"
              ? "تظهر هذه الصفحة تلقائيًا بمجرد وجود حملة نشطة أو مغلقة واحدة على الأقل ببيانات تقييم."
              : `جرّب تغيير عامل التصفية لعرض حملات بحالة أخرى.`
          }
        />
      </div>
    );
  }

  // Build chart data: one entry per dimension, with a key per campaign.
  // Only dimensions that appear in at least one campaign are shown.
  const allDimensions = new Map<string, string>();
  for (const c of campaigns) {
    for (const d of c.dimensionAverages) {
      if (!allDimensions.has(d.dimension)) {
        allDimensions.set(d.dimension, d.labelAr);
      }
    }
  }
  const dimensions = Array.from(allDimensions.entries()).map(
    ([dimension, labelAr]) => {
      const row: Record<string, string | number> = { dimension, labelAr };
      for (const c of campaigns) {
        const found = c.dimensionAverages.find(
          (d) => d.dimension === dimension
        );
        row[c.campaign.id] = found ? Number(found.averageScore.toFixed(2)) : 0;
      }
      return row;
    }
  );

  // Aggregate stats across all comparable campaigns.
  const totalResponses = campaigns.reduce(
    (s, c) => s + c.totalResponses,
    0
  );
  const totalEvaluators = campaigns.reduce(
    (s, c) => s + c.distinctEvaluators,
    0
  );
  const totalExecEvals = campaigns.reduce(
    (s, c) => s + c.executiveEvaluationCount,
    0
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="مقارنة الحملات والاتجاهات"
        description="تحليل مقارن لأبعاد القيادة عبر الحملات النشطة والمغلقة، مع احترام حد الإخفاء لكل حملة."
        eyebrow="تحليل عبر الحملات"
        actions={
          <div className="flex flex-wrap gap-2 no-print">
            <Button
              variant="outline"
              onClick={() => {
                window.location.href = `/api/admin/reports/trend/export?format=csv&status=${encodeURIComponent(statusFilter)}`;
              }}
              className="min-h-11"
              disabled={campaigns.length === 0}
            >
              <Download className="h-4 w-4" />
              تصدير CSV
            </Button>
            <Button
              variant="default"
              onClick={() => {
                window.location.href = `/api/admin/reports/trend/export?format=xlsx&status=${encodeURIComponent(statusFilter)}`;
              }}
              className="min-h-11"
              disabled={campaigns.length === 0}
            >
              <FileSpreadsheet className="h-4 w-4" />
              تصدير Excel
            </Button>
            <Button
              variant="ghost"
              onClick={() => router.push("/?view=admin&tab=reports")}
              className="min-h-11"
            >
              <ArrowRight className="h-4 w-4" />
              قائمة التقارير
            </Button>
          </div>
        }
      />

      {/* Status filter */}
      <div className="flex items-center gap-3 no-print">
        <span className="text-sm text-muted-foreground">تصفية حسب الحالة:</span>
        <Select value={statusFilter} onValueChange={setStatusFilter} dir="rtl">
          <SelectTrigger className="w-48" aria-label="تصفية حسب حالة الحملة">
            <SelectValue placeholder="كل الحالات" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">الكل (نشطة + مغلقة)</SelectItem>
            <SelectItem value="active">النشطة فقط</SelectItem>
            <SelectItem value="closed">المغلقة فقط</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Aggregate stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="عدد الحملات القابلة للمقارنة"
          value={campaigns.length}
          hint="نشطة أو مغلقة"
          icon={<GitCompareArrows className="h-5 w-5" />}
          tone="navy"
        />
        <StatCard
          title="إجمالي الإجابات"
          value={totalResponses}
          hint="عبر جميع الحملات"
          icon={<MessageSquareText className="h-5 w-5" />}
          tone="emerald"
        />
        <StatCard
          title="إجمالي المُقيِّمين"
          value={totalEvaluators}
          hint="موظفون قيَّموا مسؤولًا واحدًا على الأقل"
          icon={<Users className="h-5 w-5" />}
          tone="gold"
        />
        <StatCard
          title="إجمالي تقييمات المسؤولين"
          value={totalExecEvals}
          hint="زوج (موظف، مسؤول)"
          icon={<TrendingUp className="h-5 w-5" />}
          tone="sky"
        />
      </div>

      {/* Comparison table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">جدول المقارنة</CardTitle>
          <CardDescription>
            مقارنة سريعة لمؤشرات المشاركة عبر الحملات.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto scroll-rtl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الحملة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>تاريخ التفعيل</TableHead>
                  <TableHead>مشاركات بيئة العمل</TableHead>
                  <TableHead>مشاركات البيئة المستقبلية</TableHead>
                  <TableHead>تقييمات المسؤولين</TableHead>
                  <TableHead>المُقيِّمون</TableHead>
                  <TableHead>معدل المشاركة</TableHead>
                  <TableHead>إجمالي الإجابات</TableHead>
                  <TableHead className="text-center">التقرير</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <TableRow key={c.campaign.id}>
                    <TableCell className="font-medium">
                      {c.campaign.titleAr}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.campaign.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.campaign.activatedAt
                        ? toRiyadhDate(c.campaign.activatedAt)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <span
                        className="font-semibold tabular-nums"
                        style={{ fontFeatureSettings: '"tnum" 1' }}
                      >
                        {c.environmentSubmittedCount}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className="font-semibold tabular-nums"
                        style={{ fontFeatureSettings: '"tnum" 1' }}
                      >
                        {c.futureSubmittedCount}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className="font-semibold tabular-nums"
                        style={{ fontFeatureSettings: '"tnum" 1' }}
                      >
                        {c.executiveEvaluationCount}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className="font-semibold tabular-nums"
                        style={{ fontFeatureSettings: '"tnum" 1' }}
                      >
                        {c.distinctEvaluators}
                      </span>
                    </TableCell>
                    <TableCell>
                      {c.participationRate !== null &&
                      c.participationRate !== undefined ? (
                        <div className="flex items-center gap-2">
                          <span
                            className="font-semibold tabular-nums"
                            style={{ fontFeatureSettings: '"tnum" 1' }}
                          >
                            {c.participationRate}%
                          </span>
                          <div className="relative h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                            <div
                              className="absolute inset-y-0 end-0 rounded-full bg-primary/70"
                              style={{
                                inlineSize: `${Math.min(100, c.participationRate)}%`,
                              }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          غير محدد
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className="font-semibold tabular-nums"
                        style={{ fontFeatureSettings: '"tnum" 1' }}
                      >
                        {c.totalResponses}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          router.push(
                            `/?view=admin&tab=reports&sub=campaign&id=${c.campaign.id}`
                          )
                        }
                        className="min-h-9"
                      >
                        عرض
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Dimension trend line chart */}
      {campaigns.length >= 1 && dimensions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              اتجاه أبعاد القيادة عبر الحملات
            </CardTitle>
            <CardDescription>
              متوسط درجة كل بُعد قيادي في كل حملة. الأسطر المائلة تشير إلى
              تحسّن، والأفقية إلى ثبات، والهابطة إلى تراجع.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-96 w-full" dir="rtl">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={dimensions}
                  margin={{ top: 16, insetInlineEnd: 24, bottom: 60, insetInlineStart: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="labelAr"
                    tick={{ fontSize: 11 }}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis
                    domain={[0, 5]}
                    tick={{ fontSize: 12 }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      fontSize: 12,
                    }}
                    formatter={(v: number, name: string) => {
                      const c = campaigns.find(
                        (cc) => cc.campaign.id === name
                      );
                      return [
                        Number(v).toFixed(2),
                        c?.campaign.titleAr ?? name,
                      ];
                    }}
                    labelFormatter={(label) => `البُعد: ${label}`}
                  />
                  <Legend
                    formatter={(value: string) => {
                      const c = campaigns.find(
                        (cc) => cc.campaign.id === value
                      );
                      return c?.campaign.titleAr ?? value;
                    }}
                    wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                  />
                  <ReferenceLine y={3} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
                  {campaigns.map((c, i) => (
                    <Line
                      key={c.campaign.id}
                      type="monotone"
                      dataKey={c.campaign.id}
                      stroke={CAMPAIGN_COLORS[i % CAMPAIGN_COLORS.length]}
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              الخط المتقطع عند الدرجة 3 يمثل الحد الأوسط (محايد). النقاط فوق
              الخط تشير إلى تقييمات إيجابية، وأسفله إلى تقييمات سلبية.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Participation rate over time chart */}
      {campaigns.length >= 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              معدل المشاركة عبر الحملات
            </CardTitle>
            <CardDescription>
              نسبة المُقيِّمين إلى إجمالي الموظفين المؤهلين في كل حملة.
              {data?.data?.eligibleCount
                ? ` (إجمالي المؤهلين: ${data.data.eligibleCount})`
                : " (لم يتم تحديد عدد الموظفين المؤهلين — يمكن ضبطه من إعدادات النظام)"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80 w-full" dir="rtl">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={campaigns.map((c) => ({
                    name: c.campaign.titleAr,
                    rate:
                      c.participationRate !== null &&
                      c.participationRate !== undefined
                        ? Number(c.participationRate)
                        : 0,
                    evaluators: c.distinctEvaluators,
                  }))}
                  margin={{ top: 16, insetInlineEnd: 24, bottom: 60, insetInlineStart: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11 }}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 12 }}
                    allowDecimals={false}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      fontSize: 12,
                    }}
                    formatter={(v: number, name: string) => {
                      if (name === "rate")
                        return [`${Number(v).toFixed(2)}%`, "معدل المشاركة"];
                      return [v, "عدد المُقيِّمين"];
                    }}
                  />
                  <ReferenceLine
                    y={50}
                    stroke="var(--chart-2)"
                    strokeDasharray="4 4"
                    label={{
                      value: "هدف 50%",
                      position: "top",
                      fill: "var(--chart-2)",
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="rate"
                    stroke="var(--chart-1)"
                    strokeWidth={3}
                    dot={{ r: 5 }}
                    activeDot={{ r: 7 }}
                    label={{
                      position: "top",
                      fill: "var(--foreground)",
                      fontSize: 11,
                      fontWeight: 600,
                      formatter: (v: number) => `${Number(v).toFixed(1)}%`,
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              الخط المتقطع عند 50% يمثل الهدف المرجعي. تشير القيم المنخفضة إلى
              ضرورة تعزيز التواصل الداخلي قبل إطلاق الحملة التالية.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Per-dimension trend cards */}
      {dimensions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">تفصيل الأبعاد</CardTitle>
            <CardDescription>
              متوسط كل بُعد في كل حملة مع اتجاه المقارنة.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {dimensions.map((dim) => {
                const values = campaigns.map((c) => {
                  const found = c.dimensionAverages.find(
                    (d) => d.dimension === dim.dimension
                  );
                  return found ? found.averageScore : null;
                });
                const validValues = values.filter(
                  (v): v is number => v !== null
                );
                const first = validValues[0] ?? null;
                const last = validValues[validValues.length - 1] ?? null;
                const trend =
                  first !== null && last !== null
                    ? last > first
                      ? "up"
                      : last < first
                      ? "down"
                      : "flat"
                    : "flat";
                const delta =
                  first !== null && last !== null
                    ? Math.round((last - first) * 100) / 100
                    : null;

                return (
                  <DimensionTrendCard
                    key={dim.dimension}
                    labelAr={dim.labelAr as string}
                    campaigns={campaigns.map((c) => ({
                      id: c.campaign.id,
                      titleAr: c.campaign.titleAr,
                      value:
                        c.dimensionAverages.find(
                          (d) => d.dimension === dim.dimension
                        )?.averageScore ?? null,
                    }))}
                    trend={trend}
                    delta={delta}
                  />
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Alert className="no-print">
        <AlertTitle>ملاحظة المنهجية</AlertTitle>
        <AlertDescription>
          لا يتم ترتيب المسؤولين أو الحملات ضد بعضهم البعض — هذا التحليل لأغراض
          التحسين المؤسسي فقط. تُحترم حدود الإخفاء الفردية لكل حملة، ولا تظهر
          أبعاد الحملات التي تقل عن الحد الأدنى للعرض.
        </AlertDescription>
      </Alert>
    </div>
  );
}

function DimensionTrendCard({
  labelAr,
  campaigns,
  trend,
  delta,
}: {
  labelAr: string;
  campaigns: Array<{ id: string; titleAr: string; value: number | null }>;
  trend: "up" | "down" | "flat";
  delta: number | null;
}) {
  const TrendIcon =
    trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor =
    trend === "up"
      ? "text-emerald-600 dark:text-emerald-400"
      : trend === "down"
      ? "text-rose-600 dark:text-rose-400"
      : "text-muted-foreground";
  const deltaLabel =
    delta === null
      ? "—"
      : delta > 0
      ? `+${delta.toFixed(2)}`
      : delta < 0
      ? `${delta.toFixed(2)}`
      : "0.00";

  return (
    <div className="rounded-lg border border-border bg-card/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">{labelAr}</h4>
        <span
          className={`flex items-center gap-1 text-xs font-medium ${trendColor}`}
        >
          <TrendIcon className="h-3.5 w-3.5" />
          {deltaLabel}
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        {campaigns.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between gap-2 text-xs"
          >
            <span className="text-muted-foreground truncate">{c.titleAr}</span>
            <span
              className="font-mono font-semibold text-foreground tabular-nums"
              style={{ fontFeatureSettings: '"tnum" 1' }}
            >
              {c.value !== null ? c.value.toFixed(2) : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-10 w-1/2" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
