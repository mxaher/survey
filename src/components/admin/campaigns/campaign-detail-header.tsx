"use client";

/**
 * Admin campaign detail header (Task 3-b).
 *
 * Reusable header used by Task 3-c's CampaignDetailView. Self-contained:
 * given a `campaignId`, it fetches the campaign via GET
 * /api/admin/campaigns/[id], renders the title + status badge +
 * description + dates + threshold, and exposes the lifecycle action
 * buttons (schedule / open / close / archive / copy) gated by the
 * campaign's status. The buttons use the shared ActionButton so the
 * confirm dialog + toast + query invalidation are consistent.
 *
 * Lifecycle gating (mirrors the API routes in src/app/api/admin/campaigns):
 *   - draft        → show: جدولة، فتح الحملة، نسخ
 *   - scheduled    → show: فتح الحملة، نسخ
 *   - active       → show: إغلاق، نسخ
 *   - closed       → show: أرشفة، نسخ
 *   - archived     → show: نسخ
 *
 * The activate button pre-fetches readiness; on failure it surfaces an
 * AlertDialog with the Arabic issue list (so 3-c's detail view doesn't
 * need to re-implement that flow).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarClock,
  Copy,
  Eye,
  Loader2,
  PlayCircle,
  ShieldAlert,
  StopCircle,
  Archive,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PageHeader } from "@/components/shared/page-header";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { MESSAGES } from "@/lib/messages";
import { toRiyadhDisplay } from "@/lib/time";

interface CampaignDetail {
  id: string;
  titleAr: string;
  descriptionAr: string | null;
  instructionsAr: string | null;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string;
  minimumReportingThreshold: number;
  enableEnvironmentSurvey: boolean;
  enableFutureSurvey: boolean;
  allowMultipleExecutiveEvaluations: boolean;
  minExecutives: number | null;
  maxExecutives: number | null;
  allowResume: boolean;
  privacyNoticeAr: string | null;
  activatedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ReadinessResult {
  ready: boolean;
  issues: { key: string; messageAr: string }[];
  campaign: { id: string; titleAr: string; status: string } | null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function CampaignDetailHeader({
  campaignId,
}: {
  campaignId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery<{
    ok: boolean;
    data: CampaignDetail;
  }>({
    queryKey: ["admin-campaign", campaignId],
    queryFn: () =>
      fetchJson(`/api/admin/campaigns/${encodeURIComponent(campaignId)}`),
  });

  const campaign = data?.data;

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["admin-campaigns"] });
    qc.invalidateQueries({ queryKey: ["admin-campaign", campaignId] });
  };

  return (
    <div className="space-y-4">
      {isError ? (
        <Alert variant="destructive">
          <AlertTitle>تعذّر تحميل الحملة</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : "خطأ غير متوقع."}
          </AlertDescription>
        </Alert>
      ) : isLoading || !campaign ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <>
          <PageHeader
            title={campaign.titleAr}
            description={campaign.descriptionAr ?? undefined}
            actions={
              <div className="flex items-center gap-2">
                <StatusBadge status={campaign.status} />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push("/?view=admin&tab=campaigns")}
                >
                  <ArrowLeft className="h-4 w-4" />
                  عودة للقائمة
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    router.push(
                      `/?view=admin&tab=campaigns&sub=editor&id=${encodeURIComponent(campaign.id)}`
                    )
                  }
                >
                  تعديل
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    router.push(
                      `/?view=admin&tab=campaigns&sub=detail&id=${encodeURIComponent(campaign.id)}&preview=1`
                    )
                  }
                >
                  <Eye className="h-4 w-4" />
                  معاينة
                </Button>
              </div>
            }
          />

          {/* Details card */}
          <Card>
            <CardHeader>
              <CardTitle>تفاصيل الحملة</CardTitle>
              <CardDescription>
                آخر تحديث: {toRiyadhDisplay(campaign.updatedAt)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 md:grid-cols-4">
                <DetailItem label="تاريخ البداية">
                  {toRiyadhDisplay(campaign.startsAt)}
                </DetailItem>
                <DetailItem label="تاريخ النهاية">
                  {toRiyadhDisplay(campaign.endsAt)}
                </DetailItem>
                <DetailItem label="تاريخ التفعيل">
                  {toRiyadhDisplay(campaign.activatedAt)}
                </DetailItem>
                <DetailItem label="تاريخ الإغلاق">
                  {toRiyadhDisplay(campaign.closedAt)}
                </DetailItem>
                <DetailItem label="الحد الأدنى للعرض">
                  {campaign.minimumReportingThreshold}
                </DetailItem>
                <DetailItem label="الحد الأدنى للمسؤولين">
                  {campaign.minExecutives ?? "—"}
                </DetailItem>
                <DetailItem label="الحد الأقصى للمسؤولين">
                  {campaign.maxExecutives ?? "—"}
                </DetailItem>
                <DetailItem label="المنطقة الزمنية">
                  {campaign.timezone}
                </DetailItem>
                <DetailItem label="استبيان البيئة">
                  {campaign.enableEnvironmentSurvey ? "مفعّل" : "معطّل"}
                </DetailItem>
                <DetailItem label="استبيان المستقبل">
                  {campaign.enableFutureSurvey ? "مفعّل" : "معطّل"}
                </DetailItem>
                <DetailItem label="تقييم عدة مسؤولين">
                  {campaign.allowMultipleExecutiveEvaluations ? "نعم" : "لا"}
                </DetailItem>
                <DetailItem label="استئناف المشاركة">
                  {campaign.allowResume ? "نعم" : "لا"}
                </DetailItem>
              </dl>
              {campaign.instructionsAr && (
                <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                  <p className="font-medium text-foreground">تعليمات المشاركة</p>
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                    {campaign.instructionsAr}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Lifecycle actions */}
          <Card>
            <CardHeader>
              <CardTitle>إجراءات دورة الحياة</CardTitle>
              <CardDescription>
                تحكم في حالة الحملة وفق المراحل المسموح بها.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {campaign.status === "draft" && (
                  <ActionButton
                    label="جدولة"
                    icon={<CalendarClock className="h-4 w-4" />}
                    loadingLabel="جارٍ الجدولة..."
                    variant="outline"
                    confirmMessage="سيتم تحويل الحملة إلى حالة المجدولة لتُفعّل تلقائياً عند بلوغ تاريخ البداية. هل تريد المتابعة؟"
                    mutationFn={async () => {
                      const res = await fetch(
                        `/api/admin/campaigns/${encodeURIComponent(campaign.id)}/schedule`,
                        { method: "POST" }
                      );
                      const json = (await res.json()) as {
                        ok: boolean;
                        error?: string;
                      };
                      return json;
                    }}
                    queryKeyToInvalidate={["admin-campaign", campaign.id]}
                  />
                )}

                {(campaign.status === "draft" ||
                  campaign.status === "scheduled") && (
                  <ActivateButton
                    campaignId={campaign.id}
                    onActivated={invalidateAll}
                  />
                )}

                {campaign.status === "active" && (
                  <ActionButton
                    label="إغلاق"
                    icon={<StopCircle className="h-4 w-4" />}
                    loadingLabel="جارٍ الإغلاق..."
                    variant="outline"
                    confirmMessage="سيتم إغلاق الحملة أمام المشاركة. لن يتم قبول إجابات جديدة بعد الإغلاق. هل تريد المتابعة؟"
                    mutationFn={async () => {
                      const res = await fetch(
                        `/api/admin/campaigns/${encodeURIComponent(campaign.id)}/close`,
                        { method: "POST" }
                      );
                      const json = (await res.json()) as {
                        ok: boolean;
                        error?: string;
                      };
                      return json;
                    }}
                    queryKeyToInvalidate={["admin-campaign", campaign.id]}
                  />
                )}

                {campaign.status === "closed" && (
                  <ActionButton
                    label="أرشفة"
                    icon={<Archive className="h-4 w-4" />}
                    loadingLabel="جارٍ الأرشفة..."
                    variant="outline"
                    confirmMessage="سيتم أرشفة الحملة. لا يمكن تعديل الحملة المؤرشفة لاحقاً. هل تريد المتابعة؟"
                    mutationFn={async () => {
                      const res = await fetch(
                        `/api/admin/campaigns/${encodeURIComponent(campaign.id)}/archive`,
                        { method: "POST" }
                      );
                      const json = (await res.json()) as {
                        ok: boolean;
                        error?: string;
                      };
                      return json;
                    }}
                    queryKeyToInvalidate={["admin-campaign", campaign.id]}
                  />
                )}

                <ActionButton
                  label="نسخ"
                  icon={<Copy className="h-4 w-4" />}
                  loadingLabel="جارٍ النسخ..."
                  variant="outline"
                  confirmMessage={`هل تريد إنشاء نسخة من حملة «${campaign.titleAr}» كمسودة جديدة؟`}
                  mutationFn={async () => {
                    const res = await fetch(
                      `/api/admin/campaigns/${encodeURIComponent(campaign.id)}/copy`,
                      { method: "POST" }
                    );
                    const json = (await res.json()) as {
                      ok: boolean;
                      error?: string;
                      data?: { id: string };
                    };
                    return json;
                  }}
                  queryKeyToInvalidate={["admin-campaigns"]}
                  onSuccess={(d) => {
                    const newId = (d as { id?: string } | undefined)?.id;
                    if (newId) {
                      router.push(
                        `/?view=admin&tab=campaigns&sub=editor&id=${encodeURIComponent(newId)}`
                      );
                    }
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/** Small label/value pair used inside the details grid. */
function DetailItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{children}</dd>
    </div>
  );
}

/** Activate button — pre-fetches readiness; if not ready, surfaces an
 * AlertDialog with the Arabic issue list instead of POSTing /activate. */
function ActivateButton({
  campaignId,
  onActivated,
}: {
  campaignId: string;
  onActivated: () => void;
}) {
  const { toast } = useToast();
  const [issues, setIssues] = useState<
    { key: string; messageAr: string }[] | null
  >(null);
  const [pending, setPending] = useState(false);

  const handleActivate = async () => {
    setPending(true);
    try {
      // Pre-flight readiness fetch — cleaner UX (we surface issues
      // BEFORE the POST, so a readiness failure doesn't burn an audit-
      // log entry for a no-op activation attempt).
      const readyRes = await fetchJson<{
        ok: boolean;
        data: ReadinessResult;
      }>(`/api/admin/campaigns/${encodeURIComponent(campaignId)}/readiness`);
      if (!readyRes.data.ready) {
        setIssues(readyRes.data.issues);
        return;
      }
      const res = await fetch(
        `/api/admin/campaigns/${encodeURIComponent(campaignId)}/activate`,
        { method: "POST" }
      );
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        ready?: boolean;
        issues?: { key: string; messageAr: string }[];
      };
      if (!res.ok || !json.ok) {
        if (json.issues && json.issues.length > 0) {
          setIssues(json.issues);
          return;
        }
        toast({
          title: "تعذّر تفعيل الحملة",
          description: json.error ?? `HTTP ${res.status}`,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "تم تفعيل الحملة" });
      onActivated();
    } catch (err) {
      toast({
        title: "تعذّر تفعيل الحملة",
        description: err instanceof Error ? err.message : "خطأ غير متوقع.",
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        onClick={handleActivate}
        disabled={pending}
        className="sm:min-w-32"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <PlayCircle className="h-4 w-4" />
        )}
        فتح الحملة
      </Button>

      <AlertDialog open={!!issues} onOpenChange={(o) => !o && setIssues(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-600" />
              لا يمكن تفعيل الحملة بعد
            </AlertDialogTitle>
            <AlertDialogDescription>
              {MESSAGES.configIncomplete} يرجى استكمال المتطلبات التالية ثم
              إعادة المحاولة:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-72 overflow-y-auto space-y-2 scroll-rtl pr-1">
            {issues?.map((iss) => (
              <li
                key={iss.key}
                className="flex gap-2 rounded-md border border-border bg-card/50 px-3 py-2 text-sm"
              >
                <span className="text-destructive" aria-hidden="true">•</span>
                <span className="text-foreground">{iss.messageAr}</span>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>إغلاق</AlertDialogCancel>
            <AlertDialogAction onClick={() => setIssues(null)}>
              حسناً
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
