"use client";

/**
 * Questions library list view — Task 3-c leaf component #1.
 *
 * Shows the admin's question library with filters (section, isActive, search),
 * a table of all questions, and a per-row dropdown with edit / activate-or-
 * deactivate / delete actions. Uses TanStack Query for data + cache
 * invalidation, ActionButton for lifecycle mutations, and EmptyState when
 * there are no questions to show.
 *
 * URL contract (this view does NOT own navigation — admin-app.tsx does):
 *   ?view=admin&tab=questions                      → this view
 *   ?view=admin&tab=questions&sub=editor&id=new     → QuestionEditorView (create)
 *   ?view=admin&tab=questions&sub=editor&id=xxx     → QuestionEditorView (edit)
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, MoreVertical, Pencil, Power, Trash2, Library as LibraryIcon, Filter } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ActionButton } from "@/components/shared/action-button";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { MESSAGES } from "@/lib/messages";
import {
  QUESTION_SECTIONS,
  QUESTION_TYPES,
} from "@/lib/constants";

/** Shape returned by GET /api/admin/questions (each row). */
type QuestionListItem = {
  id: string;
  code: string;
  questionAr: string;
  questionType: string;
  section: string;
  dimension: string | null;
  isRequired: boolean;
  displayOrder: number;
  maxSelections: number | null;
  version: number;
  isActive: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  campaignConfigCount: number;
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

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("ar-SA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function QuestionsListView() {
  const router = useRouter();
  const { toast } = useToast();

  const [sectionFilter, setSectionFilter] = useState<string>("all");
  const [isActiveFilter, setIsActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [search, setSearch] = useState("");

  // Build the API URL from current filters.
  const apiUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (sectionFilter !== "all") params.set("section", sectionFilter);
    if (isActiveFilter === "active") params.set("isActive", "true");
    else if (isActiveFilter === "inactive") params.set("isActive", "false");
    if (search.trim() !== "") params.set("search", search.trim());
    const qs = params.toString();
    return `/api/admin/questions${qs ? `?${qs}` : ""}`;
  }, [sectionFilter, isActiveFilter, search]);

  const { data, isLoading, isError, error, refetch } = useQuery<{
    ok: boolean;
    data: QuestionListItem[];
  }>({
    queryKey: ["admin-questions", sectionFilter, isActiveFilter, search],
    queryFn: () => fetchJson(apiUrl),
    // Avoid hammering the API while typing in the search box.
    staleTime: 10_000,
  });

  const questions = data?.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="الأسئلة"
        description="مكتبة الأسئلة المتاحة للحملات. يمكن إعادة استخدام السؤال في عدة حملات."
        actions={
          <Button onClick={() => router.push("/?view=admin&tab=questions&sub=editor&id=new")}>
            <Plus className="ml-2 h-4 w-4" />
            سؤال جديد
          </Button>
        }
      />

      {/* Filter bar */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-2 sm:w-56">
            <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Filter className="h-3 w-3" />
              القسم
            </label>
            <Select value={sectionFilter} onValueChange={setSectionFilter}>
              <SelectTrigger className="w-full" aria-label="تصفية حسب القسم">
                <SelectValue placeholder="الكل" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {QUESTION_SECTIONS.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.labelAr}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2 sm:w-48">
            <label className="text-xs font-medium text-muted-foreground">الحالة</label>
            <Select
              value={isActiveFilter}
              onValueChange={(v) => setIsActiveFilter(v as typeof isActiveFilter)}
            >
              <SelectTrigger className="w-full" aria-label="تصفية حسب الحالة">
                <SelectValue placeholder="الكل" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="active">نشط</SelectItem>
                <SelectItem value="inactive">معطّل</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-1 flex-col gap-2">
            <label className="text-xs font-medium text-muted-foreground">بحث نصي</label>
            <div className="relative">
              <Search className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث برمز السؤال أو نصه"
                className="pr-8"
                aria-label="بحث نصي"
              />
            </div>
          </div>

          {/* Tri-state-ish isActive quick toggle */}
          <div className="flex items-center gap-3 rounded-lg border border-input bg-card px-3 py-2">
            <Switch
              id="active-filter"
              checked={isActiveFilter !== "all"}
              onCheckedChange={(c) =>
                setIsActiveFilter(c ? "active" : "all")
              }
              aria-label="تصفية حسب حالة التفعيل"
            />
            <label htmlFor="active-filter" className="text-xs font-medium text-muted-foreground">
              {isActiveFilter === "all"
                ? "إظهار الكل"
                : isActiveFilter === "active"
                ? "النشطة فقط"
                : "المعطّلة فقط"}
            </label>
            {isActiveFilter !== "all" && (
              <button
                type="button"
                onClick={() => setIsActiveFilter(isActiveFilter === "active" ? "inactive" : "active")}
                className="ml-1 text-xs text-primary underline-offset-2 hover:underline"
              >
                {isActiveFilter === "active" ? "عرض المعطّلة" : "عرض النشطة"}
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {isError && (
        <Alert variant="destructive">
          <AlertTitle>تعذّر تحميل الأسئلة</AlertTitle>
          <AlertDescription>
            {(error as Error)?.message ?? "حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى."}
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : questions.length === 0 ? (
        <EmptyState
          icon={<LibraryIcon className="h-10 w-10" />}
          title="لا توجد أسئلة بعد"
          description={
            search || sectionFilter !== "all" || isActiveFilter !== "all"
              ? "لا توجد أسئلة مطابقة لمعايير التصفية الحالية. جرّب تعديل الفلاتر أو إضافة سؤال جديد."
              : "ابدأ بإنشاء أول سؤال في مكتبة الأسئلة. يمكن إعادة استخدام كل سؤال في عدة حملات."
          }
          action={
            <Button onClick={() => router.push("/?view=admin&tab=questions&sub=editor&id=new")}>
              <Plus className="ml-2 h-4 w-4" />
              سؤال جديد
            </Button>
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>نص السؤال</TableHead>
                <TableHead>الرمز</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>القسم</TableHead>
                <TableHead>إلزامي؟</TableHead>
                <TableHead>عدد الحملات</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>آخر تعديل</TableHead>
                <TableHead>الترتيب</TableHead>
                <TableHead className="text-left">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {questions.map((q) => {
                const isInactive = !q.isActive || q.deletedAt !== null;
                return (
                  <TableRow key={q.id}>
                    <TableCell className="max-w-md truncate font-medium" title={q.questionAr}>
                      {q.questionAr}
                    </TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{q.code}</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {TYPE_LABEL[q.questionType] ?? q.questionType}
                      </Badge>
                    </TableCell>
                    <TableCell>{SECTION_LABEL[q.section] ?? q.section}</TableCell>
                    <TableCell>
                      {q.isRequired ? (
                        <Badge variant="default" className="font-normal">إلزامي</Badge>
                      ) : (
                        <Badge variant="secondary" className="font-normal">اختياري</Badge>
                      )}
                    </TableCell>
                    <TableCell>{q.campaignConfigCount}</TableCell>
                    <TableCell>
                      {isInactive ? (
                        <Badge variant="outline" className="font-normal text-muted-foreground">
                          معطّل
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-emerald-300 bg-emerald-100/70 text-emerald-900 font-normal">
                          نشط
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(q.updatedAt ?? q.createdAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{q.displayOrder}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9"
                            aria-label="إجراءات السؤال"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() =>
                              router.push(`/?view=admin&tab=questions&sub=editor&id=${q.id}`)
                            }
                          >
                            <Pencil className="ml-2 h-4 w-4" />
                            تعديل
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {q.isActive ? (
                            <DropdownMenuItem
                              onSelect={(e) => e.preventDefault()}
                              className="p-0"
                            >
                              <ActionButton
                                label="تعطيل"
                                icon={<Power className="ml-2 h-4 w-4" />}
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start"
                                mutationFn={() =>
                                  fetch(`/api/admin/questions/${q.id}/deactivate`, {
                                    method: "POST",
                                  }).then((r) => r.json())
                                }
                                queryKeyToInvalidate={["admin-questions"]}
                              />
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={(e) => e.preventDefault()}
                              className="p-0"
                            >
                              <ActionButton
                                label="تفعيل"
                                icon={<Power className="ml-2 h-4 w-4" />}
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start"
                                mutationFn={() =>
                                  fetch(`/api/admin/questions/${q.id}/activate`, {
                                    method: "POST",
                                  }).then((r) => r.json())
                                }
                                queryKeyToInvalidate={["admin-questions"]}
                              />
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={(e) => e.preventDefault()}
                            className="p-0"
                          >
                            <ActionButton
                              label="حذف"
                              icon={<Trash2 className="ml-2 h-4 w-4" />}
                              variant="ghost"
                              size="sm"
                              className="w-full justify-start text-destructive hover:text-destructive"
                              confirmMessage={MESSAGES.confirmDeleteQuestion}
                              mutationFn={() =>
                                fetch(`/api/admin/questions/${q.id}`, {
                                  method: "DELETE",
                                }).then(async (r) => {
                                  const body = await r.json();
                                  // Soft-delete fallback returns ok:true with a `message`.
                                  if (body?.ok && body?.data?.message) {
                                    toast({
                                      title: "تعذّر الحذف النهائي",
                                      description: body.data.message,
                                    });
                                  }
                                  return body;
                                })
                              }
                              queryKeyToInvalidate={["admin-questions"]}
                            />
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {questions.length} سؤال
          {(sectionFilter !== "all" || isActiveFilter !== "all" || search) && " مطابق"}
        </span>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          تحديث
        </Button>
      </div>
    </div>
  );
}
