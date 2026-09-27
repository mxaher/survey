"use client";

import { useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowLeft,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Image as ImageIcon,
  Lock,
  Printer,
  Users,
  BarChart3,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
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
import { MESSAGES } from "@/lib/messages";
import { toRiyadhDate } from "@/lib/time";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

type Envelope<T> = { ok: boolean; data: T };

type OverviewData = {
  campaign: {
    id: string;
    titleAr: string;
    descriptionAr: string | null;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
    timezone: string;
    minimumReportingThreshold: number;
    enableEnvironmentSurvey: boolean;
    enableFutureSurvey: boolean;
    allowMultipleExecutiveEvaluations: boolean;
    activatedAt: string | null;
    closedAt: string | null;
  };
  sectionTotals: {
    environment: { count: number; suppressed: boolean };
    future: { count: number; suppressed: boolean };
    executive: { count: number; suppressed: boolean };
  };
  executives: Array<{
    executiveId: string;
    nameAr: string;
    titleAr: string | null;
    category: string | null;
    departmentAr: string | null;
    evaluationCount: number;
    suppressed: boolean;
  }>;
};

type DistributionEntry = {
  value: string;
  labelAr: string;
  count: number;
  percentage?: number;
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

type SectionReport =
  | {
      suppressed: true;
      message: string;
      threshold: number;
      totalResponses: number;
      questions: never[];
    }
  | {
      suppressed: false;
      campaign?: { id: string; titleAr: string; status: string };
      totalResponses: number;
      questions: QuestionAggregate[];
    };

function formatPct(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function formatAvg(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return n.toFixed(2);
}

export function CampaignReportView({ campaignId }: { campaignId: string }) {
  const router = useRouter();

  const overview = useQuery<Envelope<OverviewData>>({
    queryKey: ["admin-report-overview", campaignId],
    queryFn: () =>
      fetchJson<Envelope<OverviewData>>(
        `/api/admin/reports/${campaignId}`
      ),
    enabled: !!campaignId,
  });

  const env = useQuery<Envelope<SectionReport>>({
    queryKey: ["admin-report-env", campaignId],
    queryFn: () =>
      fetchJson<Envelope<SectionReport>>(
        `/api/admin/reports/${campaignId}/environment`
      ),
    enabled: !!campaignId && (overview.data?.data.campaign.enableEnvironmentSurvey ?? true),
  });

  const future = useQuery<Envelope<SectionReport>>({
    queryKey: ["admin-report-future", campaignId],
    queryFn: () =>
      fetchJson<Envelope<SectionReport>>(
        `/api/admin/reports/${campaignId}/future`
      ),
    enabled: !!campaignId && (overview.data?.data.campaign.enableFutureSurvey ?? true),
  });

  const ov = overview.data?.data;
  const isLoadingOverview = overview.isLoading && !ov;
  const isError = overview.isError;

  const exportCsvUrl = `/api/admin/reports/${campaignId}/export?format=csv`;
  const exportXlsxUrl = `/api/admin/reports/${campaignId}/export?format=xlsx`;

  return (
    <div className="flex flex-col gap-6">
      {isLoadingOverview ? (
        <HeaderSkeleton />
      ) : isError || !ov ? (
        <EmptyState
          icon={<BarChart3 className="h-8 w-8" />}
          title="تعذّر تحميل التقرير"
          description="ربما لا توجد حملة بهذا المعرّف أو حدث خطأ أثناء التحميل."
          action={
            <Button
              variant="outline"
              onClick={() => router.push("/?view=admin&tab=reports")}
            >
              <ArrowRight className="h-4 w-4" />
              العودة لقائمة التقارير
            </Button>
          }
        />
      ) : (
        <>
          <PageHeader
            title={ov.campaign.titleAr}
            description={ov.campaign.descriptionAr ?? undefined}
            actions={
              <div className="flex flex-wrap gap-2 no-print">
                <Button
                  variant="outline"
                  onClick={() => {
                    window.location.href = exportCsvUrl;
                  }}
                  className="min-h-11"
                >
                  <Download className="h-4 w-4" />
                  تصدير CSV
                </Button>
                <Button
                  variant="default"
                  onClick={() => {
                    window.location.href = exportXlsxUrl;
                  }}
                  className="min-h-11"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  تصدير Excel
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => window.print()}
                  className="min-h-11"
                >
                  <Printer className="h-4 w-4" />
                  طباعة
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    router.push("/?view=admin&tab=reports")
                  }
                  className="min-h-11"
                >
                  <ArrowRight className="h-4 w-4" />
                  قائمة التقارير
                </Button>
              </div>
            }
          />

          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge status={ov.campaign.status} />
            <span>
              الفترة: {toRiyadhDate(ov.campaign.startsAt)} —{" "}
              {toRiyadhDate(ov.campaign.endsAt)}
            </span>
            <span className="text-border">|</span>
            <span>
              حد الإخفاء: {ov.campaign.minimumReportingThreshold} مشاركات
            </span>
            {ov.campaign.activatedAt && (
              <>
                <span className="text-border">|</span>
                <span>التشغيل: {toRiyadhDate(ov.campaign.activatedAt)}</span>
              </>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              title="مشاركات بيئة العمل"
              value={
                ov.sectionTotals.environment.suppressed
                  ? "أقل من الحد"
                  : ov.sectionTotals.environment.count
              }
              icon={<BarChart3 className="h-4 w-4" />}
              hint={
                ov.sectionTotals.environment.suppressed
                  ? "تم إخفاء العدد لقلة المشاركات"
                  : "إجمالي إجابات بيئة العمل"
              }
            />
            <StatCard
              title="مشاركات البيئة المستقبلية"
              value={
                ov.sectionTotals.future.suppressed
                  ? "أقل من الحد"
                  : ov.sectionTotals.future.count
              }
              icon={<TrendingUp className="h-4 w-4" />}
              hint={
                ov.sectionTotals.future.suppressed
                  ? "تم إخفاء العدد لقلة المشاركات"
                  : "إجمالي إجابات البيئة المستقبلية"
              }
            />
            <StatCard
              title="تقييمات المسؤولين"
              value={
                ov.sectionTotals.executive.suppressed
                  ? "أقل من الحد"
                  : ov.sectionTotals.executive.count
              }
              icon={<Users className="h-4 w-4" />}
              hint={
                ov.sectionTotals.executive.suppressed
                  ? "تم إخفاء العدد لقلة المشاركات"
                  : "إجمالي تقييمات القيادات"
              }
            />
          </div>

          {ov.campaign.enableEnvironmentSurvey && (
            <SectionCard
              title="تقرير بيئة العمل"
              icon={<BarChart3 className="h-5 w-5" />}
              query={env}
            />
          )}

          {ov.campaign.enableFutureSurvey && (
            <SectionCard
              title="تقرير البيئة المستقبلية"
              icon={<Sparkles className="h-5 w-5" />}
              query={future}
              isFuture
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5" />
                تقييمات المسؤولين
              </CardTitle>
            </CardHeader>
            <CardContent>
              {ov.sectionTotals.executive.suppressed ? (
                <SuppressedAlert />
              ) : ov.executives.length === 0 ? (
                <EmptyState
                  title="لا يوجد مسؤولون مشمولون"
                  description="لم يتم تعيين أي مسؤولين في هذه الحملة أو لا توجد نتائج بعد."
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {ov.executives.map((ex) => (
                    <div
                      key={ex.executiveId}
                      className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-foreground">
                            {ex.nameAr}
                          </p>
                          {ex.titleAr && (
                            <p className="text-xs text-muted-foreground">
                              {ex.titleAr}
                            </p>
                          )}
                          {ex.departmentAr && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {ex.departmentAr}
                            </p>
                          )}
                        </div>
                        <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
                          {ex.suppressed ? (
                            <>
                              <Lock className="h-3 w-3" />
                              مخفي
                            </>
                          ) : (
                            `${ex.evaluationCount} تقييم`
                          )}
                        </span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-1 min-h-11 w-full no-print"
                        onClick={() =>
                          router.push(
                            `/?view=admin&tab=reports&sub=executive&id=${campaignId}&execId=${ex.executiveId}`
                          )
                        }
                      >
                        عرض التقرير التفصيلي
                        <ArrowLeft className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function SectionCard({
  title,
  icon,
  query,
  isFuture = false,
}: {
  title: string;
  icon: React.ReactNode;
  query: { isLoading: boolean; isError: boolean; data?: Envelope<SectionReport> };
  isFuture?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <EmptyState
            title="تعذّر تحميل هذا القسم"
            description="حدث خطأ غير متوقع. يرجى تحديث الصفحة."
          />
        ) : !query.data ? null : query.data.data.suppressed ? (
          <SuppressedAlert message={query.data.data.message} />
        ) : query.data.data.questions.length === 0 ? (
          <EmptyState
            title="لا توجد أسئلة في هذا القسم"
            description="لم تُفعَّل أي أسئلة لهذا القسم في هذه الحملة."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {query.data.data.questions.map((q) => (
              <QuestionCard
                key={q.snapshotId}
                question={q}
                isFuture={isFuture}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SuppressedAlert({ message }: { message?: string }) {
  return (
    <Alert>
      <Lock className="h-4 w-4" />
      <AlertTitle>النتائج غير متاحة</AlertTitle>
      <AlertDescription>
        {message ?? MESSAGES.belowThreshold}
      </AlertDescription>
    </Alert>
  );
}

function QuestionCard({
  question,
  isFuture = false,
}: {
  question: QuestionAggregate;
  isFuture?: boolean;
}) {
  const dist = question.distribution.filter((d) => d.count > 0);
  const hasData = dist.length > 0;
  const chartRef = useRef<HTMLDivElement>(null);
  const chartData = useMemo(
    () =>
      question.distribution.map((d) => ({
        label: d.labelAr,
        count: d.count,
        percentage: d.percentage ?? (question.count > 0 ? (d.count / question.count) * 100 : 0),
      })),
    [question]
  );

  // Download the per-question distribution chart as a PNG. Same approach
  // as the executive report's dimension chart: serialize SVG → Image →
  // canvas → PNG download.
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
      const scale = 2;
      const w = svg.clientWidth || svg.parentElement?.clientWidth || 600;
      const h = svg.clientHeight || svg.parentElement?.clientHeight || 224;
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
        a.download = `question-${question.questionCode ?? question.snapshotId.slice(0, 8)}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(dlUrl);
      }, "image/png");
    };
    img.src = url;
  };

  return (
    <Collapsible className="rounded-lg border border-border bg-background p-3">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 text-start outline-none">
        <div className="flex flex-col">
          <span className="font-medium text-foreground">
            {question.questionAr}
          </span>
          <span className="mt-0.5 text-xs text-muted-foreground">
            {question.perQuestionSuppressed
              ? `عدد الإجابات: ${question.count} — أقل من حد الإخفاء، تم إخفاء التفاصيل`
              : isFuture
              ? `عدد الإجابات: ${question.count}`
              : `المتوسط: ${formatAvg(question.averageScore)} • نسبة الإجابات الإيجابية: ${formatPct(question.favorableRate)}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {question.perQuestionSuppressed ? (
            <Lock className="h-4 w-4 text-muted-foreground" />
          ) : hasData ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform [[data-state=open]_&]:rotate-180" />
          ) : (
            <span className="text-xs text-muted-foreground">لا توجد إجابات</span>
          )}
        </div>
      </CollapsibleTrigger>
      {hasData && !question.perQuestionSuppressed && (
        <CollapsibleContent>
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <Stat label="عدد الإجابات" value={String(question.count)} />
                {isFuture ? null : (
                  <>
                    <Stat
                      label="إجابات صالحة"
                      value={String(question.validCount)}
                    />
                    <Stat
                      label="المتوسط"
                      value={formatAvg(question.averageScore)}
                    />
                    <Stat
                      label="لا ينطبق"
                      value={String(question.notApplicableCount)}
                    />
                  </>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={downloadChartPng}
                className="min-h-9 text-xs"
                title="تنزيل مخطط التوزيع كصورة PNG"
              >
                <ImageIcon className="h-3.5 w-3.5" />
                تنزيل
              </Button>
            </div>

            <div ref={chartRef} className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 8, insetInlineEnd: 24, bottom: 8, insetInlineStart: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={140}
                    tick={{ fontSize: 12 }}
                    interval={0}
                  />
                  <Tooltip
                    formatter={(value: number, _name, item) => {
                      const pct =
                        ((item.payload as { percentage?: number })
                          ?.percentage ?? 0);
                      return [
                        `${value} (${pct.toFixed(1)}%)`,
                        "العدد",
                      ];
                    }}
                  />
                  <Bar
                    dataKey="count"
                    fill="var(--chart-1)"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="flex flex-wrap gap-2">
              {question.distribution.map((d) => (
                <span
                  key={d.value}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
                >
                  {d.labelAr}: <span className="font-semibold text-foreground">{d.count}</span>
                </span>
              ))}
            </div>
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card/50 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-semibold text-foreground">{value}</p>
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-10 w-2/3" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
