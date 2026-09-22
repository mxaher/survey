"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Trash2, Settings as SettingsIcon, Loader2 } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ActionButton } from "@/components/shared/action-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { toRiyadhDisplay } from "@/lib/time";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function mutationFetch<T>(
  url: string,
  method: string,
  body?: unknown
): Promise<{ ok: boolean; error?: string; data?: T }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) {
      return { ok: false, error: json?.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, data: json.data as T };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

type Envelope<T> = { ok: boolean; data: T };

type Setting = {
  id: string;
  key: string;
  valueAr: string;
  updatedAt: string;
};

const RESERVED: Array<{ key: string; labelAr: string; descriptionAr: string }> = [
  {
    key: "privacy_notice",
    labelAr: "نص إشعار الخصوصية",
    descriptionAr:
      "يُعرض للموظفين قبل بدء الاستبيان لبيان كيفية الحفاظ على سرية هوياتهم.",
  },
  {
    key: "intro_copy",
    labelAr: "نص المقدمة",
    descriptionAr:
      "الفقرة التعريفية التي تظهر في الصفحة الرئيسية لبوابة الموظف.",
  },
];

export function SettingsView() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const query = useQuery<Envelope<{ settings: Setting[] }>>({
    queryKey: ["admin-settings"],
    queryFn: () => fetchJson<Envelope<{ settings: Setting[] }>>("/api/admin/settings"),
  });

  const settings = query.data?.data.settings ?? [];

  const reserved: Setting[] = [];
  const others: Setting[] = [];
  for (const s of settings) {
    const match = RESERVED.find((r) => r.key === s.key);
    if (match) reserved.push(s);
    else others.push(s);
  }
  // Ensure reserved entries exist (even if missing from DB) so the admin can
  // create them with the correct Arabic label.
  for (const r of RESERVED) {
    if (!reserved.find((s) => s.key === r.key)) {
      reserved.push({
        id: `pending-${r.key}`,
        key: r.key,
        valueAr: "",
        updatedAt: "",
      });
    }
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-settings"] });

  const patchMutation = useMutation({
    mutationFn: ({ key, valueAr }: { key: string; valueAr: string }) =>
      mutationFetch<Setting>(
        `/api/admin/settings/${encodeURIComponent(key)}`,
        "PATCH",
        { valueAr }
      ),
    onSuccess: async (res, vars) => {
      if (!res.ok) {
        toast({
          title: "تعذّر حفظ الإعداد",
          description: res.error ?? "حدث خطأ غير متوقع.",
          variant: "destructive",
        });
        return;
      }
      // If the setting didn't exist before (POST/PATCH upsert is fine on the
      // backend via the [key]/PATCH route? — no, that route returns 404. The
      // POST /api/admin/settings endpoint does the upsert. So we use POST
      // for the reserved-missing case below; here we use PATCH only for
      // existing rows.)
      await invalidate();
      toast({
        title: "تم الحفظ",
        description: `تم تحديث إعداد «${vars.key}» بنجاح.`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "تعذّر حفظ الإعداد",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const upsertMutation = useMutation({
    mutationFn: ({ key, valueAr }: { key: string; valueAr: string }) =>
      mutationFetch<Setting>(`/api/admin/settings`, "POST", { key, valueAr }),
    onSuccess: async (res, vars) => {
      if (!res.ok) {
        toast({
          title: "تعذّر حفظ الإعداد",
          description: res.error ?? "حدث خطأ غير متوقع.",
          variant: "destructive",
        });
        return;
      }
      await invalidate();
      toast({
        title: "تم الحفظ",
        description: `تم حفظ إعداد «${vars.key}» بنجاح.`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "تعذّر حفظ الإعداد",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (key: string) =>
      mutationFetch<{ id: string; key: string; deleted: boolean }>(
        `/api/admin/settings/${encodeURIComponent(key)}`,
        "DELETE"
      ),
    onSuccess: async (res, key) => {
      if (!res.ok) {
        toast({
          title: "تعذّر حذف الإعداد",
          description: res.error ?? "حدث خطأ غير متوقع.",
          variant: "destructive",
        });
        return;
      }
      await invalidate();
      toast({
        title: "تم الحذف",
        description: `تم حذف إعداد «${key}» بنجاح.`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "تعذّر حذف الإعداد",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const isLoading = query.isLoading;
  const isError = query.isError;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="إعدادات النظام"
        description="إدارة النصوص الافتراضية وإشعارات الخصوصية والقيم الموحَّدة لكل أنحاء النظام."
      />

      {isLoading ? (
        <LoadingSkeleton />
      ) : isError ? (
        <EmptyState
          icon={<SettingsIcon className="h-8 w-8" />}
          title="تعذّر تحميل الإعدادات"
          description="حدث خطأ غير متوقع. يرجى تحديث الصفحة."
        />
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">
                النصوص المحجوزة
              </h2>
              <Badge variant="secondary" className="text-xs">
                تظهر في بوابة الموظف
              </Badge>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {RESERVED.map((r) => {
                const s = reserved.find((x) => x.key === r.key)!;
                return (
                  <ReservedSettingCard
                    key={r.key}
                    labelAr={r.labelAr}
                    descriptionAr={r.descriptionAr}
                    setting={s}
                    onSave={(valueAr) => {
                      // PATCH only when the row exists in DB. Otherwise upsert via POST.
                      if (s.id.startsWith("pending-")) {
                        upsertMutation.mutate({ key: s.key, valueAr });
                      } else {
                        patchMutation.mutate({ key: s.key, valueAr });
                      }
                    }}
                    pending={
                      patchMutation.isPending || upsertMutation.isPending
                    }
                  />
                );
              })}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">
                باقي الإعدادات
              </h2>
            </div>

            {others.length === 0 ? (
              <EmptyState
                title="لا توجد إعدادات إضافية"
                description="يمكنك إضافة إعداد جديد بالنموذج أدناه."
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {others.map((s) => (
                  <SettingCard
                    key={s.id}
                    setting={s}
                    onSave={(valueAr) =>
                      patchMutation.mutate({ key: s.key, valueAr })
                    }
                    pending={patchMutation.isPending}
                    onDelete={() =>
                      deleteMutation.mutate(s.key)
                    }
                    deletePending={deleteMutation.isPending}
                  />
                ))}
              </div>
            )}
          </section>

          <AddSettingCard
            onCreate={({ key, valueAr }) =>
              upsertMutation.mutate({ key, valueAr })
            }
            pending={upsertMutation.isPending}
          />
        </>
      )}
    </div>
  );
}

function ReservedSettingCard({
  labelAr,
  descriptionAr,
  setting,
  onSave,
  pending,
}: {
  labelAr: string;
  descriptionAr: string;
  setting: Setting;
  onSave: (valueAr: string) => void;
  pending: boolean;
}) {
  const [value, setValue] = useState(setting.valueAr);
  // Sync local state when the server value changes (parent passes fresh
  // row after a successful mutation). Done in render to avoid the
  // setState-in-effect lint rule.
  const [lastValue, setLastValue] = useState(setting.valueAr);
  if (setting.valueAr !== lastValue) {
    setLastValue(setting.valueAr);
    setValue(setting.valueAr);
  }

  const dirty = value !== setting.valueAr;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span>{labelAr}</span>
          <code className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
            {setting.key}
          </code>
        </CardTitle>
        <CardDescription>{descriptionAr}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={5}
            className="min-h-32"
            aria-label={labelAr}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {setting.updatedAt
                ? `آخر تحديث: ${toRiyadhDisplay(setting.updatedAt)}`
                : "لم يُحفظ بعد"}
            </span>
            <Button
              onClick={() => onSave(value)}
              disabled={!dirty || !value.trim() || pending}
              className="min-h-11"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              حفظ
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SettingCard({
  setting,
  onSave,
  pending,
  onDelete,
  deletePending,
}: {
  setting: Setting;
  onSave: (valueAr: string) => void;
  pending: boolean;
  onDelete: () => void;
  deletePending: boolean;
}) {
  const [value, setValue] = useState(setting.valueAr);
  // Sync local state when the server value changes (parent passes fresh
  // row after a successful mutation). Done in render to avoid the
  // setState-in-effect lint rule.
  const [lastValue, setLastValue] = useState(setting.valueAr);
  if (setting.valueAr !== lastValue) {
    setLastValue(setting.valueAr);
    setValue(setting.valueAr);
  }

  const dirty = value !== setting.valueAr;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <code className="rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
            {setting.key}
          </code>
        </CardTitle>
        <CardDescription>
          آخر تحديث: {toRiyadhDisplay(setting.updatedAt)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={4}
            className="min-h-24"
            aria-label={`قيمة الإعداد ${setting.key}`}
          />
          <div className="flex items-center justify-between gap-2">
            <ActionButton
              label="حذف"
              icon={<Trash2 className="h-4 w-4" />}
              loadingLabel="جارٍ الحذف…"
              variant="destructive"
              size="sm"
              confirmMessage={`هل أنت متأكد من حذف الإعداد «${setting.key}»؟ لا يمكن التراجع عن هذا الإجراء.`}
              mutationFn={async () => {
                onDelete();
                // Optimistic — we don't actually know the result here. Return
                // ok=true so ActionButton doesn't toast an error; the parent
                // component's mutation will toast the real outcome.
                return { ok: true };
              }}
              queryKeyToInvalidate={["admin-settings"]}
              disabled={deletePending}
            />
            <Button
              onClick={() => onSave(value)}
              disabled={!dirty || !value.trim() || pending}
              className="min-h-11"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              حفظ
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AddSettingCard({
  onCreate,
  pending,
}: {
  onCreate: (input: { key: string; valueAr: string }) => void;
  pending: boolean;
}) {
  const [key, setKey] = useState("");
  const [valueAr, setValueAr] = useState("");

  const reset = () => {
    setKey("");
    setValueAr("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plus className="h-4 w-4" />
          إضافة إعداد جديد
        </CardTitle>
        <CardDescription>
          أضف إعدادًا مخصصًا جديدًا باستخدام مفتاح فريد وقيمة عربية.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-key">المفتاح</Label>
            <Input
              id="new-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="مثال: survey_footer_note"
              className="min-h-11"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-value">القيمة (عربي)</Label>
            <Textarea
              id="new-value"
              value={valueAr}
              onChange={(e) => setValueAr(e.target.value)}
              rows={4}
              className="min-h-24"
              placeholder="النص العربي…"
            />
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => {
                onCreate({ key: key.trim(), valueAr: valueAr.trim() });
                if (key.trim() && valueAr.trim()) reset();
              }}
              disabled={!key.trim() || !valueAr.trim() || pending}
              className="min-h-11"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              إضافة
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Skeleton className="h-56" />
      <Skeleton className="h-56" />
      <Skeleton className="h-56" />
      <Skeleton className="h-56" />
    </div>
  );
}
