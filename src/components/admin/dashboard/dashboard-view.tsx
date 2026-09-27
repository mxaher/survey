"use client";

/**
 * Admin dashboard leaf view (Task 3-b).
 *
 * Surfaces the four headline KPIs returned by `GET /api/admin/dashboard`,
 * a per-status breakdown of campaigns, the latest campaign card with a
 * shortcut to open its detail page, a quick-actions panel, and (in dev
 * only) the Employee Picker that drives the impersonation-based identity
 * provider in `src/lib/identity.ts`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FolderKanban,
  Users,
  Library,
  MessageSquareText,
  Plus,
  UserCog,
  ClipboardList,
  UserCircle2,
  X,
  FlaskConical,
  ArrowLeft,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Percent,
  ScrollText,
  Database,
  Clock,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActionButton } from "@/components/shared/action-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CAMPAIGN_STATUSES } from "@/lib/constants";
import { toRiyadhDisplay } from "@/lib/time";
import { MESSAGES } from "@/lib/messages";
import { ENTITY_LABELS_AR, actionTone } from "@/lib/audit-display";

interface OrgDimension {
  dimension: string;
  labelAr: string;
  averageScore: number | null;
  executiveCount: number;
  responseCount: number;
}

interface DashboardData {
  campaignsByStatus: { status: string; count: number }[];
  totals: {
    activeExecutives: number;
    activeQuestions: number;
    responses: number;
    campaigns: number;
  };
  latestCampaign: {
    id: string;
    titleAr: string;
    status: string;
    responseCount: number;
  } | null;
  orgDimensions?: OrgDimension[];
  participation?: {
    eligibleCount: number;
    distinctEvaluators: number;
    rate: number | null;
  };
  recentActivity?: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    campaignId: string | null;
    createdAt: string;
    adminDisplayName: string;
    adminRole: string | null;
  }>;
}

interface ImpersonationData {
  current: {
    externalId: string;
    displayName?: string;
    role?: string;
    department?: string;
    isActive: boolean;
  } | null;
  roster: {
    externalId: string;
    displayName?: string;
    role?: string;
    department?: string;
    isActive: boolean;
  }[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function DashboardView() {
  const router = useRouter();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery<{
    ok: boolean;
    data: DashboardData;
  }>({
    queryKey: ["admin-dashboard"],
    queryFn: () => fetchJson("/api/admin/dashboard"),
  });

  // System health stats — separate query so the dashboard's main data
  // loading isn't blocked by the (potentially slow) DB-size stat call.
  const { data: statsData } = useQuery<{
    ok: boolean;
    data: {
      dbSizeBytes: number;
      dbSizeLabel: string;
      tableCounts: Record<string, number>;
      lastAuditAt: string | null;
      serverTime: string;
    };
  }>({
    queryKey: ["admin-system-stats"],
    queryFn: () => fetchJson("/api/admin/system-stats"),
    staleTime: 60_000, // cache for 1 min — DB size doesn't change fast
  });

  const totals = data?.data?.totals;
  const byStatus = data?.data?.campaignsByStatus ?? [];
  const latest = data?.data?.latestCampaign ?? null;
  const orgDims = data?.data?.orgDimensions ?? [];
  const participation = data?.data?.participation ?? null;
  const recentActivity = data?.data?.recentActivity ?? [];
  // Top 3 + bottom 3 dimensions (already sorted desc by the backend).
  const orgStrengths = orgDims.slice(0, 3);
  const orgImprovements = orgDims
    .slice(Math.max(0, orgDims.length - 3))
    .reverse();
  const orgAvg =
    orgDims.length > 0
      ? orgDims.reduce((s, d) => s + (d.averageScore ?? 0), 0) / orgDims.length
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="لوحة التحكم"
        description="نظرة عامة على الحملات والمسؤولين والأسئلة والمشاركات."
        actions={
          <Button
            onClick={() =>
              router.push(
                "/?view=admin&tab=campaigns&sub=editor&id=new"
              )
            }
          >
            <Plus className="h-4 w-4" />
            حملة جديدة
          </Button>
        }
      />

      {/* KPI cards */}
      {isError ? (
        <Alert variant="destructive">
          <AlertTitle>تعذّر تحميل البيانات</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : "خطأ غير متوقع."}
          </AlertDescription>
        </Alert>
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard
            title="عدد الحملات"
            value={totals?.campaigns ?? 0}
            hint="كل الحالات"
            icon={<FolderKanban className="h-5 w-5" />}
            tone="navy"
          />
          <StatCard
            title="المسؤولون النشطون"
            value={totals?.activeExecutives ?? 0}
            hint="جاهزون للإسناد"
            icon={<Users className="h-5 w-5" />}
            tone="gold"
          />
          <StatCard
            title="الأسئلة النشطة"
            value={totals?.activeQuestions ?? 0}
            hint="مكتبة الأسئلة"
            icon={<Library className="h-5 w-5" />}
            tone="sky"
          />
          <StatCard
            title="إجمالي المشاركات"
            value={totals?.responses ?? 0}
            hint="عدد إجمالي مجهّد الهوية"
            icon={<MessageSquareText className="h-5 w-5" />}
            tone="emerald"
          />
          {participation && (
            <StatCard
              title="معدل المشاركة"
              value={
                participation.rate !== null
                  ? `${participation.rate}%`
                  : "—"
              }
              hint={`${participation.distinctEvaluators} من ${participation.eligibleCount} موظف`}
              icon={<Percent className="h-5 w-5" />}
              tone="amber"
            />
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Status distribution */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>توزيع الحملات حسب الحالة</CardTitle>
            <CardDescription>
              عدد الحملات في كل مرحلة من مراحل دورة الحياة.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))
            ) : byStatus.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                لا توجد حملات بعد.
              </p>
            ) : (
              CAMPAIGN_STATUSES.map((meta) => {
                const row = byStatus.find((r) => r.status === meta.key);
                const count = row?.count ?? 0;
                const total = byStatus.reduce(
                  (sum, r) => sum + r.count,
                  0
                );
                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                return (
                  <div
                    key={meta.key}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card/50 px-3 py-2"
                  >
                    <StatusBadge status={meta.key} />
                    <div className="relative flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="absolute inset-y-0 right-0 bg-primary/70"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="min-w-8 text-sm font-semibold tabular-nums text-foreground">
                      {count}
                    </span>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Latest campaign card */}
        <Card>
          <CardHeader>
            <CardTitle>آخر حملة</CardTitle>
            <CardDescription>أحدث حملة تم إنشاؤها.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : latest ? (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">
                      {latest.titleAr}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      عدد المشاركات: {latest.responseCount}
                    </p>
                  </div>
                  <StatusBadge status={latest.status} />
                </div>
                <Button
                  className="w-full"
                  onClick={() =>
                    router.push(
                      `/?view=admin&tab=campaigns&sub=detail&id=${encodeURIComponent(latest.id)}`
                    )
                  }
                >
                  فتح الحملة
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <div className="space-y-2 text-center">
                <p className="text-sm text-muted-foreground">
                  لا توجد حملات بعد.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    router.push(
                      "/?view=admin&tab=campaigns&sub=editor&id=new"
                    )
                  }
                >
                  <Plus className="h-4 w-4" />
                  إنشاء حملة
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Org-wide leadership dimensions widget */}
      {!isLoading && orgDims.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              ملخص الأبعاد على مستوى المؤسسة
            </CardTitle>
            <CardDescription>
              متوسط أبعاد القيادة عبر جميع المسؤولين المُقيَّمين في الحملات
              النشطة والمغلقة، مع احترام حد الإخفاء لكل حملة.
              {orgAvg != null && (
                <Badge
                  variant="outline"
                  className="ms-2 font-mono"
                >
                  المتوسط العام: {orgAvg.toFixed(2)}
                </Badge>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Strengths */}
              <div className="space-y-2">
                <h4 className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  <TrendingUp className="h-4 w-4" />
                  أعلى الأبعاد
                </h4>
                {orgStrengths.map((d, i) => (
                  <DimensionBar
                    key={d.dimension}
                    label={d.labelAr}
                    score={d.averageScore}
                    rank={i + 1}
                    tone="emerald"
                    responseCount={d.responseCount}
                  />
                ))}
              </div>
              {/* Improvements */}
              <div className="space-y-2">
                <h4 className="flex items-center gap-1.5 text-sm font-semibold text-rose-700 dark:text-rose-300">
                  <TrendingDown className="h-4 w-4" />
                  مجالات التحسين
                </h4>
                {orgImprovements.map((d, i) => (
                  <DimensionBar
                    key={d.dimension}
                    label={d.labelAr}
                    score={d.averageScore}
                    rank={i + 1}
                    tone="rose"
                    responseCount={d.responseCount}
                  />
                ))}
              </div>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              لا يتم ترتيب المسؤولين مقابل بعضهم — هذا الملخص يعكس متوسط
              الأبعاد على مستوى المؤسسة لأغراض التحسين only.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Quick actions */}
      <Card>
        <CardHeader>
          <CardTitle>إجراءات سريعة</CardTitle>
          <CardDescription>اختصارات لإدارة الحملات والمكتبات.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                router.push("/?view=admin&tab=campaigns&sub=editor&id=new")
              }
            >
              <Plus className="h-4 w-4" />
              حملة جديدة
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push("/?view=admin&tab=questions")}
            >
              <Library className="h-4 w-4" />
              إدارة الأسئلة
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push("/?view=admin&tab=executives")}
            >
              <UserCog className="h-4 w-4" />
              إدارة المسؤولين
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* System health widget */}
      {statsData?.data && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              صحة النظام
            </CardTitle>
            <CardDescription>
              حجم قاعدة البيانات وعدد السجلات في كل جدول رئيسي.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SystemStat
                label="حجم قاعدة البيانات"
                value={statsData.data.dbSizeLabel}
                icon={<Database className="h-4 w-4" />}
              />
              <SystemStat
                label="إجمالي الحملات"
                value={statsData.data.tableCounts.campaigns ?? 0}
                icon={<FolderKanban className="h-4 w-4" />}
              />
              <SystemStat
                label="إجمالي المسؤولين"
                value={statsData.data.tableCounts.executives ?? 0}
                icon={<Users className="h-4 w-4" />}
              />
              <SystemStat
                label="إجمالي الأسئلة"
                value={statsData.data.tableCounts.questions ?? 0}
                icon={<Library className="h-4 w-4" />}
              />
              <SystemStat
                label="سجلات الإجابات"
                value={statsData.data.tableCounts.responses ?? 0}
                icon={<MessageSquareText className="h-4 w-4" />}
              />
              <SystemStat
                label="سجلات المشاركة"
                value={statsData.data.tableCounts.participationLedger ?? 0}
                icon={<ClipboardList className="h-4 w-4" />}
              />
              <SystemStat
                label="مستخدمو الإدارة"
                value={statsData.data.tableCounts.adminUsers ?? 0}
                icon={<UserCog className="h-4 w-4" />}
              />
              <SystemStat
                label="سجلات التدقيق"
                value={statsData.data.tableCounts.auditLogs ?? 0}
                icon={<ScrollText className="h-4 w-4" />}
              />
            </div>
            {statsData.data.lastAuditAt && (
              <p className="mt-4 text-xs text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                آخر نشاط مسجَّل: {toRiyadhDisplay(statsData.data.lastAuditAt)}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Recent activity widget */}
      {!isLoading && recentActivity.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScrollText className="h-5 w-5 text-primary" />
              آخر النشاطات
            </CardTitle>
            <CardDescription>
              أحدث 5 عمليات إدارية مسجَّلة في النظام.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3">
              {recentActivity.map((a) => {
                const tone = actionTone(a.action);
                return (
                  <li
                    key={a.id}
                    className="flex items-start gap-3 rounded-lg border border-border bg-card/40 px-3 py-2.5"
                  >
                    <span
                      className={`mt-0.5 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${tone.cls}`}
                    >
                      {a.action}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">
                        <span className="font-medium">{a.adminDisplayName}</span>
                        {a.adminRole && (
                          <span className="ms-1 text-xs text-muted-foreground">
                            ({a.adminRole === "SUPER_ADMIN" ? "مدير عام" : "مدير استبيان"})
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {ENTITY_LABELS_AR[a.entityType] ?? a.entityType}
                        {a.campaignId && (
                          <span className="font-mono ms-1">
                            · حملة {a.campaignId.slice(0, 8)}
                          </span>
                        )}
                      </p>
                    </div>
                    <span
                      className="shrink-0 text-xs text-muted-foreground tabular-nums whitespace-nowrap"
                      style={{ fontFeatureSettings: '"tnum" 1' }}
                    >
                      {toRiyadhDisplay(a.createdAt)}
                    </span>
                  </li>
                );
              })}
            </ol>
            <Button
              variant="ghost"
              size="sm"
              className="mt-3 w-full"
              onClick={() => router.push("/?view=admin&tab=audit")}
            >
              عرض السجل الكامل
              <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Dev impersonation */}
      <DevImpersonationPanel />
    </div>
  );
}

/** Dev-only panel for switching the impersonated employee identity.
 * Wraps `GET/POST /api/admin/dev-impersonate`. Hidden in production. */
function DevImpersonationPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string>("");

  const { data, isLoading } = useQuery<{
    ok: boolean;
    data: ImpersonationData;
  }>({
    queryKey: ["admin-dev-impersonate"],
    queryFn: () => fetchJson("/api/admin/dev-impersonate"),
  });

  const current = data?.data?.current ?? null;
  const roster = data?.data?.roster ?? [];

  const setMutation = useMutation({
    mutationFn: async (emp: {
      externalId: string;
      displayName?: string;
      role?: string;
      department?: string;
      isActive?: boolean;
    }) => {
      const res = await fetch("/api/admin/dev-impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set", employee: emp }),
      });
      return (await res.json()) as { ok: boolean; error?: string };
    },
    onSuccess: async (res) => {
      if (!res.ok) {
        toast({
          title: "تعذّر تحديد الهوية",
          description: res.error ?? "خطأ غير متوقع.",
          variant: "destructive",
        });
        return;
      }
      await qc.invalidateQueries({ queryKey: ["admin-dev-impersonate"] });
      toast({ title: "تم تحديد هوية الموظف" });
    },
    onError: () => {
      toast({
        title: "تعذّر تحديد الهوية",
        description: "خطأ في الاتصال بالخادم.",
        variant: "destructive",
      });
    },
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/dev-impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      return (await res.json()) as { ok: boolean; error?: string };
    },
    onSuccess: async (res) => {
      if (!res.ok) {
        toast({
          title: "تعذّر إنهاء الانتحال",
          description: res.error ?? "خطأ غير متوقع.",
          variant: "destructive",
        });
        return;
      }
      setSelectedId("");
      await qc.invalidateQueries({ queryKey: ["admin-dev-impersonate"] });
      toast({ title: "تم إنهاء انتحال الهوية" });
    },
  });

  return (
    <Card className="border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/10 dark:border-amber-700/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-amber-700 dark:text-amber-400" />
          وضع التطوير — انتحال هوية الموظف
        </CardTitle>
        <CardDescription>
          في بيئة التطوير فقط. يحدد هوية الموظف الحالية لاختبار تدفق الاستبيان.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card/60 px-3 py-2">
              <UserCircle2 className="h-5 w-5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">الهوية الحالية</p>
                {current ? (
                  <p className="text-sm font-medium truncate">
                    {current.displayName ?? current.externalId}
                    {current.department ? ` — ${current.department}` : ""}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    لا هوية محددة بعد.
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  اختر موظفاً للانتحال
                </label>
                <Select
                  value={selectedId}
                  onValueChange={setSelectedId}
                  dir="rtl"
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="اختر موظفاً..." />
                  </SelectTrigger>
                  <SelectContent>
                    {roster.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        لا يوجد موظفون
                      </SelectItem>
                    ) : (
                      roster.map((emp) => (
                        <SelectItem
                          key={emp.externalId}
                          value={emp.externalId}
                          disabled={!emp.isActive}
                        >
                          {emp.displayName ?? emp.externalId}
                          {emp.department ? ` — ${emp.department}` : ""}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <ActionButton
                label="تطبيق"
                loadingLabel="جارٍ التطبيق..."
                mutationFn={async () => {
                  const emp = roster.find(
                    (e) => e.externalId === selectedId
                  );
                  if (!emp) {
                    return {
                      ok: false,
                      error: "اختر موظفاً أولاً.",
                    };
                  }
                  return setMutation.mutateAsync(emp);
                }}
                queryKeyToInvalidate={["admin-dev-impersonate"]}
                disabled={!selectedId || setMutation.isPending}
              />
              <Button
                variant="outline"
                onClick={() => clearMutation.mutate()}
                disabled={!current || clearMutation.isPending}
              >
                <X className="h-4 w-4" />
                إنهاء انتحال الهوية
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {MESSAGES.previewBanner}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Horizontal dimension bar used in the org-wide strengths/improvements widget. */
function DimensionBar({
  label,
  score,
  rank,
  tone,
  responseCount,
}: {
  label: string;
  score: number | null;
  rank: number;
  tone: "emerald" | "rose";
  responseCount: number;
}) {
  if (score == null) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-3 py-2 text-sm text-muted-foreground">
        <Minus className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, (score / 5) * 100));
  const toneCls =
    tone === "emerald"
      ? "from-emerald-400 to-emerald-500"
      : "from-rose-400 to-rose-500";
  const rankCls =
    tone === "emerald"
      ? "bg-emerald-600 text-white"
      : "bg-rose-600 text-white";
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-border bg-card/60 px-3 py-2.5">
      <span
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold ${rankCls}`}
      >
        {rank}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {label}
          </span>
          <span
            className="text-xs font-mono font-semibold text-foreground"
            style={{ fontFeatureSettings: '"tnum" 1' }}
          >
            {score.toFixed(2)}
          </span>
        </div>
        <div className="relative mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={`absolute inset-y-0 right-0 rounded-full bg-gradient-to-l ${toneCls} transition-all duration-500`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
        {responseCount} إجابة
      </span>
    </div>
  );
}

/** Compact stat card for the system health widget — smaller than the
 * main StatCard, tuned for the 2×4 grid layout. */
function SystemStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/60 px-3 py-2.5 transition-colors hover:bg-card">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <p className="text-[11px] font-medium leading-tight">{label}</p>
      </div>
      <p
        className="mt-1 text-lg font-bold text-foreground tabular-nums"
        style={{ fontFeatureSettings: '"tnum" 1' }}
      >
        {value}
      </p>
    </div>
  );
}
