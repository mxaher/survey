"use client";

/**
 * Executive editor — Task 3-c leaf component #4.
 *
 * Create or edit an executive in the registry. Fields:
 *  - nameAr, titleAr, category (Select from EXECUTIVE_CATEGORIES),
 *    departmentAr, displayOrder, isActive (Switch).
 *
 * Save → POST (new) or PATCH (existing) → toast + navigate to list.
 *
 * Implementation note: the form is split into a parent data-fetcher
 * (`ExecutiveEditorView`) and a child form (`ExecutiveForm`) keyed by
 * `executiveId`. The child initializes its state from `initial` props via
 * `useState(initializer)` — the React-recommended pattern for hydrating form
 * state from server data, which avoids `setState`-in-effect cascades.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Save, User as UserIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { EXECUTIVE_CATEGORIES } from "@/lib/constants";

type ExecutiveDetail = {
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

export function ExecutiveEditorView({ executiveId }: { executiveId: string }) {
  const isNew = executiveId === "new";

  const { data, isLoading, isError, error } = useQuery<{
    ok: boolean;
    data: ExecutiveDetail;
  } | null>({
    queryKey: ["admin-executive", executiveId],
    queryFn: () => fetchJson(`/api/admin/executives/${executiveId}`),
    enabled: !isNew,
  });

  if (!isNew && isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!isNew && isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>تعذّر تحميل المسؤول</AlertTitle>
        <AlertDescription>
          {(error as Error)?.message ?? "حدث خطأ غير متوقع."}
        </AlertDescription>
      </Alert>
    );
  }
  if (!isNew && !data?.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>تعذّر تحميل المسؤول</AlertTitle>
        <AlertDescription>المسؤول غير موجود.</AlertDescription>
      </Alert>
    );
  }

  // Render the form. `key` ensures the form remounts when the admin
  // navigates between executives, so state is reset cleanly from `initial`.
  return (
    <ExecutiveForm
      key={executiveId}
      executiveId={executiveId}
      isNew={isNew}
      initial={data?.data}
    />
  );
}

function ExecutiveForm({
  executiveId,
  isNew,
  initial,
}: {
  executiveId: string;
  isNew: boolean;
  initial?: ExecutiveDetail;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const qc = useQueryClient();

  // Initialize state from server data — runs once on mount thanks to `key`.
  const [nameAr, setNameAr] = useState(initial?.nameAr ?? "");
  const [titleAr, setTitleAr] = useState(initial?.titleAr ?? "");
  const [category, setCategory] = useState<string>(
    initial?.category ?? EXECUTIVE_CATEGORIES[0].key
  );
  const [departmentAr, setDepartmentAr] = useState(initial?.departmentAr ?? "");
  const [displayOrder, setDisplayOrder] = useState<number>(
    initial?.displayOrder ?? 0
  );
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [formError, setFormError] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!nameAr.trim()) throw new Error("اسم المسؤول مطلوب.");
      if (!titleAr.trim()) throw new Error("المسمى الوظيفي مطلوب.");

      const body: Record<string, unknown> = {
        nameAr: nameAr.trim(),
        titleAr: titleAr.trim(),
        category,
        departmentAr: departmentAr.trim() || null,
        displayOrder,
        isActive,
      };

      const url = isNew
        ? "/api/admin/executives"
        : `/api/admin/executives/${executiveId}`;
      const method = isNew ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      return json;
    },
    onSuccess: async () => {
      toast({
        title: isNew ? "تم إنشاء المسؤول" : "تم تحديث المسؤول",
        description: "تم حفظ بيانات المسؤول بنجاح.",
      });
      await qc.invalidateQueries({ queryKey: ["admin-executives"] });
      router.push("/?view=admin&tab=executives");
    },
    onError: (err: Error) => {
      setFormError(err.message);
      toast({
        title: "تعذّر حفظ المسؤول",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={isNew ? "إضافة مسؤول" : `تعديل المسؤول: ${nameAr}`}
        description="المسؤولون هم الموظفون القياديون القابلون للتقييم في الحملات."
        actions={
          <Button variant="outline" onClick={() => router.push("/?view=admin&tab=executives")}>
            <ArrowRight className="ms-2 h-4 w-4" />
            عودة للقائمة
          </Button>
        }
      />

      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>البيانات</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="nameAr">الاسم *</Label>
              <Input
                id="nameAr"
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                placeholder="الاسم الكامل بالعربية"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="titleAr">المسمى الوظيفي *</Label>
              <Input
                id="titleAr"
                value={titleAr}
                onChange={(e) => setTitleAr(e.target.value)}
                placeholder="مدير عام، نائب رئيس، إلخ."
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label>الفئة</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXECUTIVE_CATEGORIES.map((c) => (
                      <SelectItem key={c.key} value={c.key}>
                        {c.labelAr}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="departmentAr">الإدارة</Label>
                <Input
                  id="departmentAr"
                  value={departmentAr}
                  onChange={(e) => setDepartmentAr(e.target.value)}
                  placeholder="إدارة المالية، إلخ."
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="displayOrder">ترتيب العرض</Label>
                <Input
                  id="displayOrder"
                  type="number"
                  inputMode="numeric"
                  value={String(displayOrder)}
                  onChange={(e) => setDisplayOrder(Number(e.target.value) || 0)}
                  min={0}
                />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <Switch
                id="isActive"
                checked={isActive}
                onCheckedChange={setIsActive}
              />
              <Label htmlFor="isActive">المسؤول نشط</Label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>معلومات</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <div className="flex items-center justify-center rounded-lg bg-muted/30 p-8">
              <UserIcon className="h-10 w-10 text-muted-foreground" />
            </div>
            {!isNew && initial && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">عدد الحملات</span>
                  <span>{initial.campaignCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">تاريخ الإنشاء</span>
                  <span>{new Date(initial.createdAt).toLocaleDateString("ar-SA")}</span>
                </div>
              </>
            )}
            <div className="mt-2 flex flex-col gap-2">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="ms-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="ms-2 h-4 w-4" />
                )}
                {isNew ? "إنشاء المسؤول" : "حفظ التعديلات"}
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push("/?view=admin&tab=executives")}
              >
                إلغاء
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
