"use client";

/**
 * Executives list view — Task 3-c leaf component #3.
 *
 * Lists all executives in the registry with filters (category, isActive,
 * search), a table, and a per-row dropdown (edit / activate-or-deactivate /
 * delete with confirm + soft-disable fallback for executives referenced by
 * historical campaigns).
 *
 * URL contract: navigation handled by admin-app.tsx.
 *   ?view=admin&tab=executives
 *   ?view=admin&tab=executives&sub=editor&id=new
 *   ?view=admin&tab=executives&sub=editor&id=xxx
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  MoreVertical,
  Pencil,
  Power,
  Trash2,
  Users as UsersIcon,
  Filter,
} from "lucide-react";

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
import { EXECUTIVE_CATEGORIES } from "@/lib/constants";

/** Shape returned by GET /api/admin/executives (each row). */
type ExecutiveListItem = {
  id: string;
  nameAr: string;
  titleAr: string;
  category: string;
  departmentAr: string | null;
  displayOrder: number;
  isActive: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  campaignCount: number;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  EXECUTIVE_CATEGORIES.map((c) => [c.key, c.labelAr])
);

export function ExecutivesListView() {
  const router = useRouter();
  const { toast } = useToast();

  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [isActiveFilter, setIsActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [search, setSearch] = useState("");

  const apiUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (categoryFilter !== "all") params.set("category", categoryFilter);
    if (isActiveFilter === "active") params.set("isActive", "true");
    else if (isActiveFilter === "inactive") params.set("isActive", "false");
    if (search.trim() !== "") params.set("search", search.trim());
    const qs = params.toString();
    return `/api/admin/executives${qs ? `?${qs}` : ""}`;
  }, [categoryFilter, isActiveFilter, search]);

  const { data, isLoading, isError, error, refetch } = useQuery<{
    ok: boolean;
    data: ExecutiveListItem[];
  }>({
    queryKey: ["admin-executives", categoryFilter, isActiveFilter, search],
    queryFn: () => fetchJson(apiUrl),
    staleTime: 10_000,
  });

  const executives = data?.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="المسؤولون والمديرون"
        description="سجل الموظفين القياديين المتاحين للتقييم في الحملات. يمكن إعادة استخدام المسؤول في عدة حملات."
        actions={
          <Button onClick={() => router.push("/?view=admin&tab=executives&sub=editor&id=new")}>
            <Plus className="ms-2 h-4 w-4" />
            إضافة مسؤول
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-2 sm:w-56">
            <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Filter className="h-3 w-3" />
              الفئة
            </label>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full" aria-label="تصفية حسب الفئة">
                <SelectValue placeholder="الكل" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {EXECUTIVE_CATEGORIES.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    {c.labelAr}
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
              <Search className="pointer-events-none absolute end-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث بالاسم أو المسمى أو الإدارة"
                className="pe-8"
                aria-label="بحث نصي"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-lg border border-input bg-card px-3 py-2">
            <Switch
              id="exec-active-filter"
              checked={isActiveFilter !== "all"}
              onCheckedChange={(c) =>
                setIsActiveFilter(c ? "active" : "all")
              }
              aria-label="تصفية حسب حالة التفعيل"
            />
            <label htmlFor="exec-active-filter" className="text-xs font-medium text-muted-foreground">
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
                className="ms-1 text-xs text-primary underline-offset-2 hover:underline"
              >
                {isActiveFilter === "active" ? "عرض المعطّلة" : "عرض النشطة"}
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {isError && (
        <Alert variant="destructive">
          <AlertTitle>تعذّر تحميل المسؤولين</AlertTitle>
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
      ) : executives.length === 0 ? (
        <EmptyState
          icon={<UsersIcon className="h-10 w-10" />}
          title="لا يوجد مسؤولون بعد"
          description={
            search || categoryFilter !== "all" || isActiveFilter !== "all"
              ? "لا يوجد مسؤولون مطابقون لمعايير التصفية الحالية."
              : "ابدأ بإضافة أول مسؤول قابل للتقييم في الحملات."
          }
          action={
            <Button onClick={() => router.push("/?view=admin&tab=executives&sub=editor&id=new")}>
              <Plus className="ms-2 h-4 w-4" />
              إضافة مسؤول
            </Button>
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead>المسمى</TableHead>
                <TableHead>الفئة</TableHead>
                <TableHead>الإدارة</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>عدد الحملات</TableHead>
                <TableHead>الترتيب</TableHead>
                <TableHead className="text-start">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {executives.map((e) => {
                const isInactive = !e.isActive || e.deletedAt !== null;
                return (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">{e.nameAr}</TableCell>
                    <TableCell>{e.titleAr}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {CATEGORY_LABEL[e.category] ?? e.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {e.departmentAr || "—"}
                    </TableCell>
                    <TableCell>
                      {isInactive ? (
                        <Badge variant="outline" className="text-muted-foreground font-normal">
                          معطّل
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-emerald-300 bg-emerald-100/70 text-emerald-900 font-normal">
                          نشط
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{e.campaignCount}</TableCell>
                    <TableCell className="text-muted-foreground">{e.displayOrder}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9"
                            aria-label="إجراءات المسؤول"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() =>
                              router.push(`/?view=admin&tab=executives&sub=editor&id=${e.id}`)
                            }
                          >
                            <Pencil className="ms-2 h-4 w-4" />
                            تعديل
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {e.isActive ? (
                            <DropdownMenuItem
                              onSelect={(e) => e.preventDefault()}
                              className="p-0"
                            >
                              <ActionButton
                                label="تعطيل"
                                icon={<Power className="ms-2 h-4 w-4" />}
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start"
                                mutationFn={() =>
                                  fetch(`/api/admin/executives/${e.id}/deactivate`, {
                                    method: "POST",
                                  }).then((r) => r.json())
                                }
                                queryKeyToInvalidate={["admin-executives"]}
                              />
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={(e) => e.preventDefault()}
                              className="p-0"
                            >
                              <ActionButton
                                label="تفعيل"
                                icon={<Power className="ms-2 h-4 w-4" />}
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start"
                                mutationFn={() =>
                                  fetch(`/api/admin/executives/${e.id}/activate`, {
                                    method: "POST",
                                  }).then((r) => r.json())
                                }
                                queryKeyToInvalidate={["admin-executives"]}
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
                              icon={<Trash2 className="ms-2 h-4 w-4" />}
                              variant="ghost"
                              size="sm"
                              className="w-full justify-start text-destructive hover:text-destructive"
                              confirmMessage={MESSAGES.confirmRemoveManager}
                              mutationFn={() =>
                                fetch(`/api/admin/executives/${e.id}`, {
                                  method: "DELETE",
                                }).then(async (r) => {
                                  const body = await r.json();
                                  if (!r.ok) {
                                    // Likely "referenced by historical campaign"
                                    toast({
                                      title: "تعذّر الحذف",
                                      description:
                                        body?.error ??
                                        MESSAGES.removeExecutiveFromActiveWithHistory,
                                      variant: "destructive",
                                    });
                                  }
                                  return body;
                                })
                              }
                              queryKeyToInvalidate={["admin-executives"]}
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
          {executives.length} مسؤول
          {(categoryFilter !== "all" || isActiveFilter !== "all" || search) && " مطابق"}
        </span>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          تحديث
        </Button>
      </div>
    </div>
  );
}
