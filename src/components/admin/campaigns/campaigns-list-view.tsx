"use client";

/**
 * Admin campaigns list leaf view (Task 3-b).
 *
 * Lists every campaign returned by `GET /api/admin/campaigns` in a shadcn
 * Table with per-row lifecycle actions wired to the activate / close /
 * archive / copy / delete endpoints exposed by Task 2-a.
 *
 * The lifecycle actions share ActionButton's underlying pattern (window
 * confirm + toast + query invalidation) but are surfaced as shadcn
 * DropdownMenuItem entries — the dropdown is the navigation pattern
 * required by the task spec.
 */
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  FolderKanban,
  Plus,
  MoreVertical,
  Pencil,
  PlayCircle,
  StopCircle,
  Archive,
  Copy,
  Eye,
  Trash2,
  CalendarClock,
  Loader2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { MESSAGES } from "@/lib/messages";
import { toRiyadhDisplay, toRiyadhDate } from "@/lib/time";

interface CampaignListRow {
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
  minExecutives: number | null;
  maxExecutives: number | null;
  allowResume: boolean;
  activatedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  counts: {
    executives: number;
    questions: number;
    responses: number;
    participationLedger: number;
    questionSnapshots: number;
  };
}

interface ReadinessIssue {
  key: string;
  messageAr: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function postLifecycle(
  url: string,
  confirmMessage: string
): Promise<{ ok: boolean; error?: string; issues?: ReadinessIssue[] }> {
  if (confirmMessage && !window.confirm(confirmMessage)) {
    return { ok: true }; // user-cancelled — treat as no-op success
  }
  const res = await fetch(url, { method: "POST" });
  const json = (await res.json()) as {
    ok: boolean;
    error?: string;
    issues?: ReadinessIssue[];
  };
  if (!res.ok) {
    return { ok: false, error: json.error ?? `HTTP ${res.status}`, issues: json.issues };
  }
  return json;
}

async function deleteLifecycle(
  url: string,
  confirmMessage: string
): Promise<{ ok: boolean; error?: string }> {
  if (!window.confirm(confirmMessage)) return { ok: true };
  const res = await fetch(url, { method: "DELETE" });
  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!res.ok) {
    return { ok: false, error: json.error ?? `HTTP ${res.status}` };
  }
  return json;
}

export function CampaignsListView() {
  const router = useRouter();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery<{
    ok: boolean;
    data: CampaignListRow[];
  }>({
    queryKey: ["admin-campaigns"],
    queryFn: () => fetchJson("/api/admin/campaigns"),
  });

  const campaigns = data?.data ?? [];
  const [readinessIssues, setReadinessIssues] = useState<{
    campaignId: string;
    title: string;
    issues: ReadinessIssue[];
  } | null>(null);
  const [density, setDensity] = useState<"comfortable" | "compact">(
    "comfortable"
  );
  const [healthFilter, setHealthFilter] = useState<string>("all");

  // Compute health level for a campaign — mirrors the HealthDot logic.
  const healthLevel = (c: CampaignListRow): "idle" | "weak" | "low" | "active" | "healthy" => {
    if (c.status === "draft" || c.status === "scheduled") return "idle";
    const r = c.counts.responses;
    const t = c.minimumReportingThreshold;
    if (r >= t * 3) return "healthy";
    if (r >= t * 2) return "active";
    if (r >= t) return "low";
    return "weak";
  };

  const filteredCampaigns =
    healthFilter === "all"
      ? campaigns
      : campaigns.filter((c) => healthLevel(c) === healthFilter);

  const invalidateAll = () =>
    qc.invalidateQueries({ queryKey: ["admin-campaigns"] });

  // Lifecycle mutation wrapper — handles loading state, errors, query
  // invalidation, and routes readiness-issue responses into the dialog.
  const lifecycleMutation = useMutation({
    mutationFn: async (args: {
      campaign: CampaignListRow;
      action: "activate" | "close" | "archive" | "schedule" | "copy" | "delete";
    }) => {
      const { campaign, action } = args;
      const url = `/api/admin/campaigns/${encodeURIComponent(campaign.id)}/${action}`;
      if (action === "delete") {
        return deleteLifecycle(
          url,
          `هل أنت متأكد من حذف مسودة حملة «${campaign.titleAr}»؟ لا يمكن التراجع عن هذا الإجراء.`
        );
      }
      const confirmMessages: Record<string, string> = {
        activate: MESSAGES.confirmActivate,
        close: `هل تريد إغلاق حملة «${campaign.titleAr}»؟`,
        archive: `هل تريد أرشفة حملة «${campaign.titleAr}»؟`,
        schedule: `سيتم جدولة حملة «${campaign.titleAr}» لتُفعّل تلقائياً عند بلوغ تاريخ البداية. هل تريد المتابعة؟`,
        copy: `هل تريد إنشاء نسخة من حملة «${campaign.titleAr}»؟`,
      };
      return postLifecycle(url, confirmMessages[action]);
    },
    onSuccess: async (res, vars) => {
      if (!res.ok) {
        if (vars.action === "activate" && res.issues && res.issues.length > 0) {
          setReadinessIssues({
            campaignId: vars.campaign.id,
            title: vars.campaign.titleAr,
            issues: res.issues,
          });
          return;
        }
        toast({
          title: "تعذّر تنفيذ العملية",
          description: res.error ?? "حدث خطأ غير متوقع.",
          variant: "destructive",
        });
        return;
      }
      await invalidateAll();
      const okTitles: Record<string, string> = {
        activate: "تم تفعيل الحملة",
        close: "تم إغلاق الحملة",
        archive: "تمت أرشفة الحملة",
        schedule: "تمت جدولة الحملة",
        copy: "تم إنشاء نسخة",
        delete: "تم حذف المسودة",
      };
      toast({ title: okTitles[vars.action] });

      // For copy, navigate to the new draft editor.
      if (vars.action === "copy") {
        // Refetch to get the new campaign id (the new draft will be the
        // newest by createdAt desc).
        const fresh = await fetchJson<{ ok: boolean; data: CampaignListRow[] }>(
          "/api/admin/campaigns"
        );
        const newest = fresh.data?.[0];
        if (newest && newest.titleAr.endsWith("(نسخة)")) {
          router.push(
            `/?view=admin&tab=campaigns&sub=editor&id=${encodeURIComponent(newest.id)}`
          );
        }
      }
    },
    onError: (err: Error) => {
      toast({
        title: "تعذّر تنفيذ العملية",
        description: err.message ?? "حدث خطأ غير متوقع.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="الحملات"
        description="إدارة حملات الاستبيان ودورة حياتها."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-border bg-card p-0.5 no-print">
              <button
                type="button"
                onClick={() => setDensity("comfortable")}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  density === "comfortable"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-label="عرض مريح"
              >
                مريح
              </button>
              <button
                type="button"
                onClick={() => setDensity("compact")}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  density === "compact"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-label="عرض مضغوط"
              >
                مضغوط
              </button>
            </div>
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
          </div>
        }
      />

      {/* Health filter bar — only shown when there are campaigns */}
      {!isLoading && !isError && campaigns.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 no-print">
          <span className="text-xs text-muted-foreground">تصفية حسب الصحة:</span>
          <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
            {[
              { value: "all", label: "الكل", dot: "bg-slate-400" },
              { value: "healthy", label: "قوية", dot: "bg-emerald-500" },
              { value: "active", label: "جيدة", dot: "bg-sky-500" },
              { value: "low", label: "ضمن الحد", dot: "bg-amber-500" },
              { value: "weak", label: "أقل من الحد", dot: "bg-rose-500" },
              { value: "idle", label: "لم تُفعَّل", dot: "bg-slate-400" },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setHealthFilter(opt.value)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  healthFilter === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${opt.dot}`} />
                {opt.label}
              </button>
            ))}
          </div>
          {healthFilter !== "all" && (
            <span className="text-xs text-muted-foreground">
              ({filteredCampaigns.length} من {campaigns.length})
            </span>
          )}
        </div>
      )}

      {isError ? (
        <Alert variant="destructive">
          <AlertTitle>تعذّر تحميل الحملات</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : "خطأ غير متوقع."}
          </AlertDescription>
        </Alert>
      ) : isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon={<FolderKanban className="h-10 w-10" />}
          title="لا توجد حملات بعد"
          description="ابدأ بإنشاء حملة استبيان جديدة لإسناد المسؤولين والأسئلة وفتحها للموظفين."
          action={
            <Button
              onClick={() =>
                router.push("/?view=admin&tab=campaigns&sub=editor&id=new")
              }
            >
              <Plus className="h-4 w-4" />
              إنشاء حملة جديدة
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="max-h-[70vh] overflow-y-auto scroll-rtl">
            <Table>
              <TableHeader>
                <TableRow className="sticky top-0 z-10 bg-card hover:bg-card">
                  <TableHead className="min-w-40">اسم الحملة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>تاريخ البداية</TableHead>
                  <TableHead>تاريخ النهاية</TableHead>
                  <TableHead className="text-center">عدد المسؤولين</TableHead>
                  <TableHead className="text-center">عدد الأسئلة</TableHead>
                  <TableHead className="text-center">عدد المشاركات</TableHead>
                  <TableHead>تاريخ آخر تعديل</TableHead>
                  <TableHead className="text-center">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCampaigns.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="text-center text-sm text-muted-foreground py-12"
                    >
                      لا توجد حملات مطابقة لعامل التصفية الحالي.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCampaigns.map((c) => {
                    const busy = lifecycleMutation.isPending;
                    return (
                      <TableRow
                        key={c.id}
                        className={
                          density === "compact"
                            ? "py-1 [&>td]:py-1.5 [&>td]:text-xs"
                            : "py-2 [&>td]:py-3"
                        }
                    >
                      <TableCell>
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              `/?view=admin&tab=campaigns&sub=detail&id=${encodeURIComponent(c.id)}`
                            )
                          }
                          className="text-sm font-semibold text-foreground hover:underline"
                        >
                          {c.titleAr}
                        </button>
                        {c.descriptionAr && (
                          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5 max-w-xs">
                            {c.descriptionAr}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <HealthDot
                            status={c.status}
                            responses={c.counts.responses}
                            threshold={c.minimumReportingThreshold}
                          />
                          <StatusBadge status={c.status} />
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {toRiyadhDate(c.startsAt)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {toRiyadhDate(c.endsAt)}
                      </TableCell>
                      <TableCell className="text-center text-sm tabular-nums">
                        {c.counts.executives}
                      </TableCell>
                      <TableCell className="text-center text-sm tabular-nums">
                        {c.counts.questions}
                      </TableCell>
                      <TableCell className="text-center text-sm tabular-nums">
                        {c.counts.responses}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {toRiyadhDisplay(c.updatedAt)}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-9"
                              disabled={busy}
                              aria-label="إجراءات"
                            >
                              {busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <MoreVertical className="h-4 w-4" />
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>إجراءات</DropdownMenuLabel>
                            <DropdownMenuItem
                              onSelect={() =>
                                router.push(
                                  `/?view=admin&tab=campaigns&sub=editor&id=${encodeURIComponent(c.id)}`
                                )
                              }
                            >
                              <Pencil className="h-4 w-4" />
                              تعديل
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                router.push(
                                  `/?view=admin&tab=campaigns&sub=detail&id=${encodeURIComponent(c.id)}&preview=1`
                                )
                              }
                            >
                              <Eye className="h-4 w-4" />
                              معاينة
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {(c.status === "draft" ||
                              c.status === "scheduled") && (
                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.preventDefault();
                                  lifecycleMutation.mutate({
                                    campaign: c,
                                    action: "activate",
                                  });
                                }}
                              >
                                <PlayCircle className="h-4 w-4" />
                                فتح الحملة (تفعيل)
                              </DropdownMenuItem>
                            )}
                            {c.status === "draft" && (
                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.preventDefault();
                                  lifecycleMutation.mutate({
                                    campaign: c,
                                    action: "schedule",
                                  });
                                }}
                              >
                                <CalendarClock className="h-4 w-4" />
                                جدولة
                              </DropdownMenuItem>
                            )}
                            {c.status === "active" && (
                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.preventDefault();
                                  lifecycleMutation.mutate({
                                    campaign: c,
                                    action: "close",
                                  });
                                }}
                              >
                                <StopCircle className="h-4 w-4" />
                                إغلاق
                              </DropdownMenuItem>
                            )}
                            {c.status === "closed" && (
                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.preventDefault();
                                  lifecycleMutation.mutate({
                                    campaign: c,
                                    action: "archive",
                                  });
                                }}
                              >
                                <Archive className="h-4 w-4" />
                                أرشفة
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onSelect={(e) => {
                                e.preventDefault();
                                lifecycleMutation.mutate({
                                  campaign: c,
                                  action: "copy",
                                });
                              }}
                            >
                              <Copy className="h-4 w-4" />
                              نسخ
                            </DropdownMenuItem>
                            {c.status === "draft" && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={(e) => {
                                    e.preventDefault();
                                    lifecycleMutation.mutate({
                                      campaign: c,
                                      action: "delete",
                                    });
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  حذف المسودة
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <ReadinessIssuesDialog
        state={readinessIssues}
        onClose={() => setReadinessIssues(null)}
      />
    </div>
  );
}

/** Readiness issues Dialog — surfaced when activation is rejected because
 * the campaign doesn't pass the spec §11.7 readiness checks. */
function ReadinessIssuesDialog({
  state,
  onClose,
}: {
  state: {
    campaignId: string;
    title: string;
    issues: ReadinessIssue[];
  } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>لا يمكن تفعيل الحملة بعد</DialogTitle>
          <DialogDescription>
            {state
              ? `الحملة «${state.title}» تحتاج إلى استكمال المتطلبات التالية قبل النشر:`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-80 overflow-y-auto space-y-2 scroll-rtl pr-1">
          {state?.issues.map((iss) => (
            <li
              key={iss.key}
              className="flex gap-2 rounded-md border border-border bg-card/50 px-3 py-2 text-sm"
            >
              <span className="text-destructive" aria-hidden="true">•</span>
              <span className="text-foreground">{iss.messageAr}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Campaign health indicator — a colored dot + tooltip showing the
 * participation level relative to the campaign's threshold.
 *
 *  - "healthy" (emerald): responses ≥ threshold × 3 (strong participation)
 *  - "active" (sky):       responses ≥ threshold × 2 (good participation)
 *  - "low" (amber):        responses ≥ threshold (meets minimum)
 *  - "weak" (rose):        responses < threshold (below minimum — reports suppressed)
 *  - "idle" (slate):       draft/scheduled (no responses yet)
 *
 * Never color-only — always paired with the StatusBadge text label. */
function HealthDot({
  status,
  responses,
  threshold,
}: {
  status: string;
  responses: number;
  threshold: number;
}) {
  if (status === "draft" || status === "scheduled") {
    return (
      <span
        className="inline-block h-2 w-2 rounded-full bg-slate-400"
        title="حملة لم تُفعَّل بعد"
        aria-label="حملة لم تُفعَّل بعد"
      />
    );
  }
  let level: "healthy" | "active" | "low" | "weak";
  let color: string;
  let label: string;
  if (responses >= threshold * 3) {
    level = "healthy";
    color = "bg-emerald-500";
    label = `مشاركة قوية (${responses} إجابة)`;
  } else if (responses >= threshold * 2) {
    level = "active";
    color = "bg-sky-500";
    label = `مشاركة جيدة (${responses} إجابة)`;
  } else if (responses >= threshold) {
    level = "low";
    color = "bg-amber-500";
    label = `مشاركة ضمن الحد الأدنى (${responses} إجابة)`;
  } else {
    level = "weak";
    color = "bg-rose-500";
    label = `مشاركة أقل من الحد (${responses} من ${threshold})`;
  }
  const pulse = level === "healthy" ? "animate-pulse" : "";
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${color} ${pulse}`}
      title={label}
      aria-label={label}
    />
  );
}
