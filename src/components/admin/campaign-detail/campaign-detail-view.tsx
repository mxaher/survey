"use client";

/**
 * Campaign detail — Task 3-c leaf component #5.
 *
 * Wraps a shadcn Tabs container with 6 sub-tabs:
 *   1. الإعدادات (Settings)    → renders CampaignEditorView (3-b) — read-only
 *                                  when status ∈ {active, closed, archived}.
 *   2. الأسئلة (Questions)     → two-pane: question library + assigned list
 *                                  with drag-and-drop reorder via @dnd-kit.
 *   3. المسؤولون (Executives)  → two-column: available + assigned, with
 *                                  reorder + activate/deactivate.
 *   4. المعاينة (Preview)      → GET-only inline render of the employee UI.
 *   5. الجاهزية (Readiness)    → readiness check list + فتح الحملة button.
 *   6. النتائج (Results)       → link to full report.
 *
 * Top of view renders CampaignDetailHeader (3-b) — loaded via next/dynamic
 * with a minimal inline fallback so the page works even before 3-b ships.
 *
 * All Arabic copy + structural-edit gating come from the API contracts.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Eye,
  GripVertical,
  LayoutList,
  Loader2,
  Plus,
  Power,
  Rocket,
  Settings as SettingsIcon,
  Trash2,
  UserPlus,
  Users as UsersIcon,
  XCircle,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ActionButton } from "@/components/shared/action-button";
import { focusDataField } from "@/components/admin/focus-data-field";
import { ReadinessIssueList } from "@/components/admin/readiness-issue-list";
import type { ReadinessTarget } from "@/lib/readiness-targets";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { MESSAGES, PRIVACY_NOTICE } from "@/lib/messages";
import {
  EXECUTIVE_CATEGORIES,
  QUESTION_SCOPES,
  QUESTION_SECTIONS,
  QUESTION_TYPES,
} from "@/lib/constants";

// ---- Dynamic imports for Task 3-b's components (safe fallback if missing) ----
// We provide inline fallback components so the detail view compiles + runs
// even before 3-b's files exist. Once 3-b lands, dynamic() resolves to
// their real component automatically.

type HeaderProps = {
  campaignId: string;
  onResolveIssue?: (target: ReadinessTarget) => void;
};
type EditorProps = { campaignId: string; readOnly?: boolean };

function FallbackHeader({ campaignId }: HeaderProps) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <span className="text-sm text-muted-foreground">
          معرّف الحملة: <code className="font-mono">{campaignId}</code>
        </span>
        <Badge variant="outline" className="font-normal">
          يتم تحميل الرأس
        </Badge>
      </CardContent>
    </Card>
  );
}

function FallbackEditor({ campaignId, readOnly }: EditorProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>محرر الحملة</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
        <p>
          محرر الحملة غير متاح حالياً (في انتظار مكوّن المحرر من المهمة 3-ب).
        </p>
        <p>
          معرّف الحملة: <code className="font-mono">{campaignId}</code>
          {readOnly ? " — وضع القراءة فقط" : ""}
        </p>
        <p>
          يمكنك متابعة تعديل إسنادات الأسئلة والمسؤولين من باقي التبويبات.
        </p>
      </CardContent>
    </Card>
  );
}

const CampaignDetailHeader = dynamic<HeaderProps>(
  () =>
    import("@/components/admin/campaigns/campaign-detail-header")
      .then((m) => ({ default: m.CampaignDetailHeader ?? FallbackHeader }))
      .catch(() => ({ default: FallbackHeader })),
  { ssr: false, loading: () => <FallbackHeader campaignId="" /> }
);

const CampaignEditorView = dynamic<EditorProps>(
  () =>
    import("@/components/admin/campaigns/campaign-editor-view")
      .then((m) => ({ default: m.CampaignEditorView ?? FallbackEditor }))
      .catch(() => ({ default: FallbackEditor })),
  { ssr: false, loading: () => <FallbackEditor campaignId="" /> }
);

// ---- Types ----
type CampaignDetail = {
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
  counts: {
    responses: number;
    participationLedger: number;
    questionSnapshots: number;
    executives: number;
    questions: number;
  };
};

type AssignedQuestion = {
  campaignId: string;
  questionId: string;
  scope: string;
  isRequired: boolean;
  displayOrder: number;
  question: {
    id: string;
    code: string;
    questionAr: string;
    questionType: string;
    section: string;
    dimension: string | null;
    isRequired: boolean;
    isActive: boolean;
    maxSelections: number | null;
    options: Array<{
      id: string;
      value: string;
      labelAr: string;
      score: number | null;
      displayOrder: number;
    }>;
  } | null;
};

type LibraryQuestion = {
  id: string;
  code: string;
  questionAr: string;
  questionType: string;
  section: string;
  dimension: string | null;
  isRequired: boolean;
  displayOrder: number;
  maxSelections: number | null;
  isActive: boolean;
  campaignConfigCount: number;
};

type AssignedExecutive = {
  campaignId: string;
  executiveId: string;
  displayOrder: number;
  isEnabled: boolean;
  executive: {
    id: string;
    nameAr: string;
    titleAr: string;
    category: string;
    departmentAr: string | null;
    displayOrder: number;
    isActive: boolean;
  } | null;
};

type LibraryExecutive = {
  id: string;
  nameAr: string;
  titleAr: string;
  category: string;
  departmentAr: string | null;
  displayOrder: number;
  isActive: boolean;
  campaignCount: number;
};

type ReadinessIssue = { key: string; messageAr: string };
type ReadinessData = { ready: boolean; issues: ReadinessIssue[]; campaign?: { id: string; titleAr: string; status: string } };

type PreviewData = {
  campaign: {
    id: string;
    titleAr: string;
    descriptionAr: string | null;
    instructionsAr: string | null;
    privacyNoticeAr: string;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
    timezone: string;
    minimumReportingThreshold: number;
    enableEnvironmentSurvey: boolean;
    enableFutureSurvey: boolean;
    allowMultipleExecutiveEvaluations: boolean;
    minExecutives: number;
    maxExecutives: number;
    allowResume: boolean;
    activatedAt: string | null;
    closedAt: string | null;
  };
  source: "snapshots" | "library";
  environment: { enabled: boolean; questions: PreviewQuestion[] };
  leadership: { questions: PreviewQuestion[] };
  executives: PreviewExecutive[];
  future: { enabled: boolean; questions: PreviewQuestion[] };
};

type PreviewQuestion = {
  questionId?: string;
  snapshotId?: string;
  originalQuestionId?: string;
  code?: string;
  questionCode?: string;
  questionAr: string;
  questionType: string;
  section: string;
  dimension: string | null;
  isRequired: boolean;
  displayOrder: number;
  maxSelections: number | null;
  scope?: string;
  options: Array<{
    id?: string;
    value: string;
    labelAr: string;
    score: number | null;
    displayOrder: number;
  }>;
};

type PreviewExecutive = {
  executiveId: string;
  displayOrder: number;
  nameAr: string;
  titleAr: string;
  category: string;
  departmentAr: string | null;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

const SECTION_LABEL: Record<string, string> = Object.fromEntries(
  QUESTION_SECTIONS.map((s) => [s.key, s.labelAr])
);
const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  QUESTION_TYPES.map((t) => [t.key, t.labelAr])
);
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  EXECUTIVE_CATEGORIES.map((c) => [c.key, c.labelAr])
);

function isEditable(status: string): boolean {
  return status === "draft" || status === "scheduled";
}

/** Valid `?dtab=` values — matches the TabsTrigger values below. */
const TAB_VALUES = [
  "settings",
  "questions",
  "executives",
  "preview",
  "readiness",
  "results",
];

// =========================================================================
// Main component
// =========================================================================
export function CampaignDetailView({ campaignId }: { campaignId: string }) {
  const sp = useSearchParams();
  const [tab, setTab] = useState<string>(() => {
    const requested = sp.get("dtab");
    return requested && TAB_VALUES.includes(requested) ? requested : "settings";
  });

  // Deep link from other admin surfaces: ?dtab=<tab>&focus=<data-field>.
  // `focusDataField` polls until the control mounts, so it's safe to call
  // while the settings form is still loading.
  const focusField = sp.get("focus");
  useEffect(() => {
    if (focusField) focusDataField(focusField);
  }, [focusField]);

  /** Readiness «إصلاح» shortcut: jump to the tab that fixes the
   *  issue and focus the exact control when it lives in the settings form. */
  const handleResolveIssue = (target: ReadinessTarget) => {
    setTab(target.tab);
    if (target.field) focusDataField(target.field);
  };

  const { data, isLoading, isError, error } = useQuery<{ ok: boolean; data: CampaignDetail } | null>({
    queryKey: ["admin-campaign-detail", campaignId],
    queryFn: () => fetchJson(`/api/admin/campaigns/${campaignId}`),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (isError || !data?.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>تعذّر تحميل الحملة</AlertTitle>
        <AlertDescription>
          {(error as Error)?.message ?? "الحملة غير موجودة أو حدث خطأ غير متوقع."}
        </AlertDescription>
      </Alert>
    );
  }

  const campaign = data.data;
  const editable = isEditable(campaign.status);

  return (
    <div className="flex flex-col gap-6">
      {/* Header from Task 3-b (with safe fallback) */}
      <CampaignDetailHeader
        campaignId={campaignId}
        onResolveIssue={handleResolveIssue}
      />

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList className="flex h-auto w-full flex-wrap">
          <TabsTrigger value="settings" className="gap-1.5">
            <SettingsIcon className="h-4 w-4" />
            الإعدادات
          </TabsTrigger>
          <TabsTrigger value="questions" className="gap-1.5">
            <LayoutList className="h-4 w-4" />
            الأسئلة
          </TabsTrigger>
          <TabsTrigger value="executives" className="gap-1.5">
            <UsersIcon className="h-4 w-4" />
            المسؤولون
          </TabsTrigger>
          <TabsTrigger value="preview" className="gap-1.5">
            <Eye className="h-4 w-4" />
            المعاينة
          </TabsTrigger>
          <TabsTrigger value="readiness" className="gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            الجاهزية
          </TabsTrigger>
          <TabsTrigger value="results" className="gap-1.5">
            <BarChart3 className="h-4 w-4" />
            النتائج
          </TabsTrigger>
        </TabsList>

        <TabsContent value="settings">
          {!editable && (
            <Alert className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>الحملة {campaign.status === "active" ? "نشطة" : campaign.status === "closed" ? "مغلقة" : "مؤرشفة"}</AlertTitle>
              <AlertDescription>
                {campaign.status === "active"
                  ? "الحقول مقفولة في هذا التبويب حفاظاً على سلامة النتائج. الحقول المسموح بها أثناء التشغيل (الوصف، تعليمات المشاركة، تاريخ النهاية، الحد الأدنى لعرض النتائج) متاحة من زر «تعديل» في رأس الصفحة."
                  : "لا يمكن تعديل حملة مغلقة أو مؤرشفة. يمكنك نسخها لإنشاء حملة جديدة."}
              </AlertDescription>
            </Alert>
          )}
          <CampaignEditorView
            campaignId={campaignId}
            readOnly={!editable}
          />
        </TabsContent>

        <TabsContent value="questions">
          <QuestionsTab campaignId={campaignId} editable={editable} status={campaign.status} />
        </TabsContent>

        <TabsContent value="executives">
          <ExecutivesTab campaignId={campaignId} editable={editable} status={campaign.status} />
        </TabsContent>

        <TabsContent value="preview">
          <PreviewTab campaignId={campaignId} />
        </TabsContent>

        <TabsContent value="readiness">
          <ReadinessTab
            campaignId={campaignId}
            status={campaign.status}
            onResolveIssue={handleResolveIssue}
          />
        </TabsContent>

        <TabsContent value="results">
          <ResultsTab campaignId={campaignId} hasResponses={campaign.counts.responses > 0} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// =========================================================================
// 1. Questions assignment tab — two-pane UI with DnD reorder
// =========================================================================
function QuestionsTab({
  campaignId,
  editable,
  status,
}: {
  campaignId: string;
  editable: boolean;
  status: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Library state (filters + selection)
  const [libSearch, setLibSearch] = useState("");
  const [libSection, setLibSection] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Build library API URL
  const libUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (libSection !== "all") params.set("section", libSection);
    if (libSearch.trim()) params.set("search", libSearch.trim());
    const qs = params.toString();
    return `/api/admin/questions${qs ? `?${qs}` : ""}`;
  }, [libSearch, libSection]);

  // Library data
  const libQuery = useQuery<{ ok: boolean; data: LibraryQuestion[] }>({
    queryKey: ["admin-questions", libSection, libSearch],
    queryFn: () => fetchJson(libUrl),
    staleTime: 10_000,
  });

  // Assigned questions data
  const assignedQuery = useQuery<{ ok: boolean; data: { campaign: { editable: boolean; status: string; titleAr: string }; assignments: AssignedQuestion[] } }>({
    queryKey: ["admin-campaign-questions", campaignId],
    queryFn: () => fetchJson(`/api/admin/campaigns/${campaignId}/questions`),
  });

  const assigned = assignedQuery.data?.data?.assignments ?? [];
  const assignedIds = new Set(assigned.map((a) => a.questionId));

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Mutations
  const assignMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch(`/api/admin/campaigns/${campaignId}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionIds: ids }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      return json;
    },
    onSuccess: async () => {
      toast({ title: "تم إضافة الأسئلة", description: "تم إسناد الأسئلة المحددة بنجاح." });
      setSelectedIds(new Set());
      await qc.invalidateQueries({ queryKey: ["admin-campaign-questions", campaignId] });
    },
    onError: (err: Error) =>
      toast({
        title: "تعذّر إضافة الأسئلة",
        description: err.message,
        variant: "destructive",
      }),
  });

  const updateAssignmentMutation = useMutation({
    mutationFn: async ({
      questionId,
      patch,
    }: {
      questionId: string;
      patch: { scope?: string; isRequired?: boolean; displayOrder?: number };
    }) => {
      const res = await fetch(
        `/api/admin/campaigns/${campaignId}/questions/${questionId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      return json;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin-campaign-questions", campaignId] });
    },
    onError: (err: Error) =>
      toast({
        title: "تعذّر تحديث الإسناد",
        description: err.message,
        variant: "destructive",
      }),
  });

  const reorderMutation = useMutation({
    mutationFn: async (order: Array<{ questionId: string; displayOrder: number }>) => {
      const res = await fetch(`/api/admin/campaigns/${campaignId}/questions/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      return json;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin-campaign-questions", campaignId] });
    },
    onError: (err: Error) =>
      toast({
        title: "تعذّر حفظ الترتيب",
        description: err.message,
        variant: "destructive",
      }),
  });

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = assigned.map((a) => a.questionId);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(assigned, oldIndex, newIndex);
    // Optimistic update: write the new order to the cache immediately.
    const prev = assignedQuery.data?.data;
    if (prev) {
      qc.setQueryData(["admin-campaign-questions", campaignId], {
        ok: true,
        data: {
          ...prev,
          assignments: reordered.map((a, i) => ({ ...a, displayOrder: i })),
        },
      });
    }
    // Fire-and-forget reorder POST.
    reorderMutation.mutate(
      reordered.map((a, i) => ({ questionId: a.questionId, displayOrder: i }))
    );
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const libraryQuestions = libQuery.data?.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {!editable && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{MESSAGES.cannotEditActiveCampaign}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* LEFT: available library */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>المكتبة المتاحة</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Input
                placeholder="بحث"
                value={libSearch}
                onChange={(e) => setLibSearch(e.target.value)}
                className="flex-1 min-w-32"
              />
              <Select value={libSection} onValueChange={setLibSection}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="القسم" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الأقسام</SelectItem>
                  {QUESTION_SECTIONS.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.labelAr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="max-h-96 overflow-y-auto rounded-lg border border-border">
              {libQuery.isLoading ? (
                <div className="flex flex-col gap-2 p-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : libraryQuestions.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  لا توجد أسئلة مطابقة.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {libraryQuestions.map((q) => {
                    const alreadyAssigned = assignedIds.has(q.id);
                    const checked = selectedIds.has(q.id);
                    return (
                      <li
                        key={q.id}
                        className={`flex items-start gap-3 p-3 transition-colors ${
                          alreadyAssigned ? "bg-muted/30 opacity-60" : "hover:bg-muted/30"
                        }`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleSelect(q.id)}
                          disabled={alreadyAssigned || !editable}
                          aria-label="تحديد السؤال"
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-sm font-medium">{q.questionAr}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <code className="rounded bg-muted px-1 py-0.5">{q.code}</code>
                            <span>·</span>
                            <span>{SECTION_LABEL[q.section] ?? q.section}</span>
                            <span>·</span>
                            <span>{TYPE_LABEL[q.questionType] ?? q.questionType}</span>
                          </div>
                        </div>
                        {alreadyAssigned && (
                          <Badge variant="secondary" className="text-xs font-normal">
                            مُسند
                          </Badge>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <Button
              onClick={() => assignMutation.mutate(Array.from(selectedIds))}
              disabled={selectedIds.size === 0 || !editable || assignMutation.isPending}
              size="sm"
            >
              {assignMutation.isPending && <Loader2 className="ms-2 h-4 w-4 animate-spin" />}
              <Plus className="ms-2 h-4 w-4" />
              إضافة إلى الحملة {selectedIds.size > 0 && `(${selectedIds.size})`}
            </Button>
          </CardContent>
        </Card>

        {/* RIGHT: assigned questions, DnD-reorderable */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>الأسئلة المعيّنة لهذه الحملة</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {assignedQuery.isLoading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : assigned.length === 0 ? (
              <EmptyState
                title="لا توجد أسئلة معيّنة"
                description="حدّد أسئلة من المكتبة على اليمين ثم اضغط «إضافة إلى الحملة»."
              />
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
              >
                <SortableContext
                  items={assigned.map((a) => a.questionId)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
                    {assigned.map((a, idx) => (
                      <SortableAssignedQuestion
                        key={a.questionId}
                        assigned={a}
                        index={idx}
                        editable={editable}
                        campaignId={campaignId}
                        onPatch={(patch) =>
                          updateAssignmentMutation.mutate({
                            questionId: a.questionId,
                            patch,
                          })
                        }
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SortableAssignedQuestion({
  assigned,
  index: _index,
  editable,
  campaignId,
  onPatch,
}: {
  assigned: AssignedQuestion;
  index: number;
  editable: boolean;
  campaignId: string;
  onPatch: (patch: { scope?: string; isRequired?: boolean; displayOrder?: number }) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: assigned.questionId });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };
  const q = assigned.question;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-lg border border-border bg-card p-3"
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-50"
          {...attributes}
          {...listeners}
          disabled={!editable}
          aria-label="اسحب لإعادة الترتيب"
        >
          <GripVertical className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium">{q?.questionAr ?? "سؤال محذوف"}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {q && <code className="rounded bg-muted px-1 py-0.5">{q.code}</code>}
                <span>·</span>
                <span>{SECTION_LABEL[q?.section ?? ""] ?? q?.section}</span>
                <span>·</span>
                <span>{TYPE_LABEL[q?.questionType ?? ""] ?? q?.questionType}</span>
                <span>·</span>
                <span>ترتيب: {assigned.displayOrder}</span>
              </div>
            </div>
            <ActionButton
              label="إزالة"
              icon={<Trash2 className="ms-2 h-4 w-4" />}
              variant="ghost"
              size="sm"
              disabled={!editable}
              confirmMessage="هل تريد إزالة هذا السؤال من الحملة؟"
              mutationFn={() =>
                fetch(
                  `/api/admin/campaigns/${campaignId}/questions/${assigned.questionId}`,
                  { method: "DELETE" }
                ).then((r) => r.json())
              }
              queryKeyToInvalidate={["admin-campaign-questions", campaignId]}
              className="text-destructive hover:text-destructive"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">النطاق</label>
              <Select
                value={assigned.scope}
                onValueChange={(v) => onPatch({ scope: v })}
                disabled={!editable}
              >
                <SelectTrigger className="h-8 w-40 text-xs" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUESTION_SCOPES.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.labelAr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id={`req-${assigned.questionId}`}
                checked={assigned.isRequired}
                onCheckedChange={(c) => onPatch({ isRequired: c })}
                disabled={!editable}
              />
              <label htmlFor={`req-${assigned.questionId}`} className="text-xs">
                إلزامي
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// 2. Executives assignment tab — two-column layout with DnD reorder
// =========================================================================
function ExecutivesTab({
  campaignId,
  editable,
  status,
}: {
  campaignId: string;
  editable: boolean;
  status: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [libSearch, setLibSearch] = useState("");

  // Library: all executives
  const libQuery = useQuery<{ ok: boolean; data: LibraryExecutive[] }>({
    queryKey: ["admin-executives", "all"],
    queryFn: () => fetchJson("/api/admin/executives"),
    staleTime: 10_000,
  });

  // Assigned
  const assignedQuery = useQuery<{ ok: boolean; data: { campaign: { editable: boolean; status: string; titleAr: string }; assignments: AssignedExecutive[] } }>({
    queryKey: ["admin-campaign-executives", campaignId],
    queryFn: () => fetchJson(`/api/admin/campaigns/${campaignId}/executives`),
  });

  const assigned = assignedQuery.data?.data?.assignments ?? [];
  const assignedIds = new Set(assigned.map((a) => a.executiveId));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const assignMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch(`/api/admin/campaigns/${campaignId}/executives`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executiveIds: ids }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      return json;
    },
    onSuccess: async () => {
      toast({ title: "تم إضافة المسؤولين", description: "تم إسناد المسؤولين المحددين بنجاح." });
      await qc.invalidateQueries({ queryKey: ["admin-campaign-executives", campaignId] });
    },
    onError: (err: Error) =>
      toast({
        title: "تعذّر إضافة المسؤولين",
        description: err.message,
        variant: "destructive",
      }),
  });

  const patchMutation = useMutation({
    mutationFn: async ({
      executiveId,
      patch,
    }: {
      executiveId: string;
      patch: { isEnabled?: boolean; displayOrder?: number };
    }) => {
      const res = await fetch(
        `/api/admin/campaigns/${campaignId}/executives/${executiveId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      return json;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin-campaign-executives", campaignId] });
    },
    onError: (err: Error) =>
      toast({
        title: "تعذّر تحديث الإسناد",
        description: err.message,
        variant: "destructive",
      }),
  });

  const reorderMutation = useMutation({
    mutationFn: async (order: Array<{ executiveId: string; displayOrder: number }>) => {
      const res = await fetch(`/api/admin/campaigns/${campaignId}/executives/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      return json;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin-campaign-executives", campaignId] });
    },
    onError: (err: Error) =>
      toast({
        title: "تعذّر حفظ الترتيب",
        description: err.message,
        variant: "destructive",
      }),
  });

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = assigned.map((a) => a.executiveId);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(assigned, oldIndex, newIndex);
    const prev = assignedQuery.data?.data;
    if (prev) {
      qc.setQueryData(["admin-campaign-executives", campaignId], {
        ok: true,
        data: {
          ...prev,
          assignments: reordered.map((a, i) => ({ ...a, displayOrder: i })),
        },
      });
    }
    reorderMutation.mutate(
      reordered.map((a, i) => ({ executiveId: a.executiveId, displayOrder: i }))
    );
  }

  const filteredLibrary = useMemo(() => {
    const all = libQuery.data?.data ?? [];
    if (!libSearch.trim()) return all;
    const s = libSearch.trim();
    return all.filter(
      (e) =>
        e.nameAr.includes(s) || e.titleAr.includes(s) || (e.departmentAr ?? "").includes(s)
    );
  }, [libQuery.data, libSearch]);

  return (
    <div className="flex flex-col gap-4">
      {!editable && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{MESSAGES.cannotEditActiveCampaign}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* LEFT: available */}
        <Card>
          <CardHeader>
            <CardTitle>متاحون</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Input
              placeholder="بحث بالاسم أو المسمى"
              value={libSearch}
              onChange={(e) => setLibSearch(e.target.value)}
            />
            <div className="max-h-96 overflow-y-auto rounded-lg border border-border">
              {libQuery.isLoading ? (
                <div className="flex flex-col gap-2 p-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : filteredLibrary.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  لا يوجد مسؤولون متاحون.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {filteredLibrary.map((e) => {
                    const alreadyAssigned = assignedIds.has(e.id);
                    return (
                      <li
                        key={e.id}
                        className={`flex items-center justify-between gap-3 p-3 ${
                          alreadyAssigned ? "bg-muted/30 opacity-60" : "hover:bg-muted/30"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{e.nameAr}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <span>{e.titleAr}</span>
                            <span>·</span>
                            <span>{CATEGORY_LABEL[e.category] ?? e.category}</span>
                            {e.departmentAr && (
                              <>
                                <span>·</span>
                                <span>{e.departmentAr}</span>
                              </>
                            )}
                          </div>
                        </div>
                        {alreadyAssigned ? (
                          <Badge variant="secondary" className="text-xs font-normal">
                            معيّن
                          </Badge>
                        ) : (
                          <ActionButton
                            label="إضافة"
                            icon={<UserPlus className="ms-2 h-4 w-4" />}
                            disabled={!editable || !e.isActive}
                            variant="outline"
                            size="sm"
                            mutationFn={() =>
                              fetch(`/api/admin/campaigns/${campaignId}/executives`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ executiveIds: [e.id] }),
                              }).then((r) => r.json())
                            }
                            queryKeyToInvalidate={["admin-campaign-executives", campaignId]}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        {/* RIGHT: assigned */}
        <Card>
          <CardHeader>
            <CardTitle>معيّنون</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {assignedQuery.isLoading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : assigned.length === 0 ? (
              <EmptyState
                title="لا يوجد مسؤولون معيّنون"
                description="أضف مسؤولين من القائمة على اليمين."
              />
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
              >
                <SortableContext
                  items={assigned.map((a) => a.executiveId)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
                    {assigned.map((a) => (
                      <SortableAssignedExecutive
                        key={a.executiveId}
                        assigned={a}
                        editable={editable}
                        status={status}
                        campaignId={campaignId}
                        onPatch={(patch) =>
                          patchMutation.mutate({
                            executiveId: a.executiveId,
                            patch,
                          })
                        }
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SortableAssignedExecutive({
  assigned,
  editable,
  status,
  campaignId,
  onPatch,
}: {
  assigned: AssignedExecutive;
  editable: boolean;
  status: string;
  campaignId: string;
  onPatch: (patch: { isEnabled?: boolean; displayOrder?: number }) => void;
}) {
  const { toast } = useToast();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: assigned.executiveId });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };
  const e = assigned.executive;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-lg border border-border bg-card p-3"
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-50"
          {...attributes}
          {...listeners}
          disabled={!editable}
          aria-label="اسحب لإعادة الترتيب"
        >
          <GripVertical className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{e?.nameAr ?? "مسؤول محذوف"}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span>{e?.titleAr}</span>
                <span>·</span>
                <span>{CATEGORY_LABEL[e?.category ?? ""] ?? e?.category}</span>
                {e?.departmentAr && (
                  <>
                    <span>·</span>
                    <span>{e.departmentAr}</span>
                  </>
                )}
                <span>·</span>
                <span>ترتيب: {assigned.displayOrder}</span>
              </div>
            </div>
            <ActionButton
              label="إزالة من الحملة"
              icon={<Trash2 className="ms-2 h-4 w-4" />}
              variant="ghost"
              size="sm"
              disabled={!editable}
              confirmMessage={MESSAGES.confirmRemoveManager}
              mutationFn={() =>
                fetch(
                  `/api/admin/campaigns/${campaignId}/executives/${assigned.executiveId}`,
                  { method: "DELETE" }
                ).then(async (r) => {
                  const body = await r.json();
                  if (body?.data?.message) {
                    toast({
                      title: "تعذّر الحذف النهائي",
                      description: body.data.message,
                    });
                  }
                  return body;
                })
              }
              queryKeyToInvalidate={["admin-campaign-executives", campaignId]}
              className="text-destructive hover:text-destructive"
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Switch
              id={`en-${assigned.executiveId}`}
              checked={assigned.isEnabled}
              onCheckedChange={(c) => onPatch({ isEnabled: c })}
              disabled={!editable && status !== "active"}
            />
            <label htmlFor={`en-${assigned.executiveId}`} className="text-xs">
              ظاهر للموظفين
            </label>
            {!assigned.isEnabled && (
              <Badge variant="secondary" className="text-xs font-normal">
                مخفي
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// 3. Preview tab — GET only, render employee UI inline
// =========================================================================
function PreviewTab({ campaignId }: { campaignId: string }) {
  const { data, isLoading, isError, error } = useQuery<{ ok: boolean; data: PreviewData }>({
    queryKey: ["admin-campaign-preview", campaignId],
    queryFn: () => fetchJson(`/api/admin/campaigns/${campaignId}/preview`),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }
  if (isError || !data?.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>تعذّر تحميل المعاينة</AlertTitle>
        <AlertDescription>
          {(error as Error)?.message ?? "حدث خطأ غير متوقع."}
        </AlertDescription>
      </Alert>
    );
  }

  const preview = data.data;

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <Eye className="h-4 w-4" />
        <AlertTitle>وضع المعاينة</AlertTitle>
        <AlertDescription>{MESSAGES.previewBanner}</AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>{preview.campaign.titleAr}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {preview.campaign.descriptionAr && (
            <p className="text-muted-foreground">{preview.campaign.descriptionAr}</p>
          )}
          {preview.campaign.instructionsAr && (
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="font-medium mb-1">تعليمات</p>
              <p className="text-muted-foreground whitespace-pre-line">
                {preview.campaign.instructionsAr}
              </p>
            </div>
          )}
          <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            <p className="font-medium mb-1 text-foreground">إشعار الخصوصية</p>
            {preview.campaign.privacyNoticeAr ?? PRIVACY_NOTICE}
          </div>
        </CardContent>
      </Card>

      {preview.environment.enabled &&
        preview.environment.questions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>أسئلة بيئة العمل</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {preview.environment.questions.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد أسئلة.</p>
            ) : (
              preview.environment.questions.map((q, i) => (
                <PreviewQuestionBlock key={q.questionId ?? q.snapshotId ?? i} q={q} />
              ))
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>المسؤولون القابلون للتقييم</CardTitle>
        </CardHeader>
        <CardContent>
          {preview.executives.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا يوجد مسؤولون مفعّلون.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {preview.executives.map((e) => (
                <li
                  key={e.executiveId}
                  className="rounded-lg border border-border bg-card p-3"
                >
                  <p className="font-medium">{e.nameAr}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.titleAr}
                    {e.departmentAr ? ` · ${e.departmentAr}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>أسئلة تقييم القيادات</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {preview.leadership.questions.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد أسئلة.</p>
          ) : (
            preview.leadership.questions.map((q, i) => (
              <PreviewQuestionBlock key={q.questionId ?? q.snapshotId ?? i} q={q} />
            ))
          )}
        </CardContent>
      </Card>

      {preview.future.enabled && preview.future.questions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>أسئلة البيئة المستقبلية</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {preview.future.questions.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد أسئلة.</p>
            ) : (
              preview.future.questions.map((q, i) => (
                <PreviewQuestionBlock key={q.questionId ?? q.snapshotId ?? i} q={q} />
              ))
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PreviewQuestionBlock({ q }: { q: PreviewQuestion }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-sm font-medium">{q.questionAr}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {q.code && <code className="rounded bg-muted px-1 py-0.5">{q.code}</code>}
        {q.questionCode && <code className="rounded bg-muted px-1 py-0.5">{q.questionCode}</code>}
        <span>·</span>
        <span>{TYPE_LABEL[q.questionType] ?? q.questionType}</span>
        <span>·</span>
        <span>{q.isRequired ? "إلزامي" : "اختياري"}</span>
        {q.scope && (
          <>
            <span>·</span>
            <span>النطاق: {QUESTION_SCOPES.find((s) => s.key === q.scope)?.labelAr ?? q.scope}</span>
          </>
        )}
      </div>
      {q.options.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {q.options.map((o) => (
            <li
              key={o.value}
              className="flex items-center gap-2 rounded-md bg-muted/30 px-2 py-1 text-xs"
            >
              <span className="font-medium">{o.labelAr}</span>
              <span className="text-muted-foreground">({o.value})</span>
              {o.score !== null && (
                <Badge variant="outline" className="text-xs font-normal">
                  الدرجة: {o.score}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// =========================================================================
// 4. Readiness tab
// =========================================================================
function ReadinessTab({
  campaignId,
  status,
  onResolveIssue,
}: {
  campaignId: string;
  status: string;
  onResolveIssue?: (target: ReadinessTarget) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const router = useRouter();

  const { data, isLoading, isError, error, refetch } = useQuery<{ ok: boolean; data: ReadinessData }>({
    queryKey: ["admin-campaign-readiness", campaignId],
    queryFn: () => fetchJson(`/api/admin/campaigns/${campaignId}/readiness`),
  });

  const activateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/campaigns/${campaignId}/activate`, {
        method: "POST",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      return json;
    },
    onSuccess: async () => {
      toast({
        title: "تم تفعيل الحملة",
        description: "أصبحت الحملة نشطة ومتاحة للموظفين.",
      });
      await qc.invalidateQueries({ queryKey: ["admin-campaign-detail", campaignId] });
      await qc.invalidateQueries({ queryKey: ["admin-campaigns"] });
      router.push("/?view=admin&tab=campaigns&sub=detail&id=" + campaignId);
    },
    onError: (err: Error) =>
      toast({
        title: "تعذّر تفعيل الحملة",
        description: err.message,
        variant: "destructive",
      }),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (isError || !data?.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>تعذّر تحميل فحص الجاهزية</AlertTitle>
        <AlertDescription>
          {(error as Error)?.message ?? "حدث خطأ غير متوقع."}
        </AlertDescription>
      </Alert>
    );
  }

  const r = data.data;
  const alreadyActive = status === "active" || status === "closed" || status === "archived";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="فحص الجاهزية"
        description="تحقق من استيفاء الحملة لمتطلبات النشر قبل تفعيلها."
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            إعادة الفحص
          </Button>
        }
      />

      {r.ready ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertTitle>الحملة جاهزة للنشر</AlertTitle>
          <AlertDescription>
            جميع المتطلبات مستوفاة. يمكنك تفعيل الحملة الآن.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>لا يمكن فتح الحملة قبل معالجة العناصر التالية:</AlertTitle>
          <AlertDescription>
            <ReadinessIssueList
              issues={r.issues}
              variant="alert"
              onResolve={onResolveIssue}
            />
          </AlertDescription>
        </Alert>
      )}

      {alreadyActive ? (
        <Alert>
          <AlertDescription>
            هذه الحملة {status === "active" ? "نشطة بالفعل" : status === "closed" ? "مغلقة" : "مؤرشفة"}.
            لا يمكن تفعيلها مرة أخرى.
          </AlertDescription>
        </Alert>
      ) : (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={!r.ready}>
              <Rocket className="ms-2 h-4 w-4" />
              فتح الحملة
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>تأكيد تفعيل الحملة</AlertDialogTitle>
              <AlertDialogDescription>{MESSAGES.confirmActivate}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>إلغاء</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => activateMutation.mutate()}
                disabled={activateMutation.isPending}
                className="gap-1"
              >
                {activateMutation.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                تفعيل الحملة
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

// =========================================================================
// 5. Results tab — link to full report
// =========================================================================
function ResultsTab({
  campaignId,
  hasResponses,
}: {
  campaignId: string;
  hasResponses: boolean;
}) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="النتائج"
        description="عرض التقرير التفصيلي للحملة وتوزيع الإجابات."
      />
      {hasResponses ? (
        <Card>
          <CardContent className="flex items-center justify-between p-6">
            <p className="text-sm text-muted-foreground">
              يتوفر تقرير كامل بهذه الحملة، يشمل نتائج أقسام بيئة العمل والمستقبلية
              وتقييم المسؤولين، مع إخفاء النتائج التي لا تتجاوز عتبة الإخفاء.
            </p>
            <Button onClick={() => router.push(`/?view=admin&tab=reports&sub=campaign&id=${campaignId}`)}>
              <BarChart3 className="ms-2 h-4 w-4" />
              عرض التقرير الكامل
            </Button>
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={<BarChart3 className="h-10 w-10" />}
          title="لا توجد نتائج بعد"
          description="لم تُسجَّل أي مشاركات في هذه الحملة بعد. ستظهر النتائج هنا وفي التقرير الكامل بمجرد استلام الإجابات."
        />
      )}
    </div>
  );
}
