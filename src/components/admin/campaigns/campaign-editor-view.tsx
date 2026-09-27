"use client";

/**
 * Admin campaign editor leaf view (Task 3-b).
 *
 * Create mode (campaignId === "new"): POST /api/admin/campaigns.
 * Edit mode (any other id): GET /api/admin/campaigns/[id] to populate,
 *   then PATCH /api/admin/campaigns/[id] to save.
 *
 * Three lifecycle buttons gated by status:
 *   - حفظ كمسودة — always available (POST or PATCH).
 *   - جدولة — only when status==='draft'. POST /schedule. Requires
 *     startsAt in the future.
 *   - فتح الحملة — only when status in ['draft','scheduled']. POST
 *     /activate. Pre-fetches GET /readiness first and pops an
 *     AlertDialog listing any issues before actually activating.
 *
 * Form is react-hook-form + zodResolver (Zod 4) with two-column grid on
 * desktop and stacked layout on mobile. RTL throughout — flex/grid
 * mirror automatically so we never use text-left/text-right.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  ArrowRight,
  CalendarClock,
  Eye,
  Loader2,
  PlayCircle,
  Save,
  ShieldAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActionButton } from "@/components/shared/action-button";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { MESSAGES, PRIVACY_NOTICE } from "@/lib/messages";

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

interface SystemSettingsList {
  settings: { id: string; key: string; valueAr: string; updatedAt: string }[];
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

const RIYADH_TZ = "Asia/Riyadh";

/** Convert an ISO (UTC) timestamp into the local datetime-local input
 * format, in Riyadh timezone. Returns "" if null. */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: RIYADH_TZ,
      calendar: "gregory",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
  } catch {
    return iso.slice(0, 16);
  }
}

/** Convert a datetime-local input value (interpreted as Riyadh local
 * time) into an ISO UTC string. Returns null if empty/invalid. */
function localInputToIso(value: string): string | null {
  if (!value) return null;
  // The browser parses "YYYY-MM-DDTHH:MM" as local time when constructing
  // `new Date()`. Since the admin's browser is in Saudi Arabia
  // (UTC+3, no DST) and we explicitly tag the campaign with timezone=
  // Asia/Riyadh, this conversion is correct.
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

const formSchema = z
  .object({
    titleAr: z.string().trim().min(1, "عنوان الحملة مطلوب."),
    descriptionAr: z.string().optional().nullable(),
    instructionsAr: z.string().optional().nullable(),
    startsAtLocal: z.string().optional(),
    endsAtLocal: z.string().optional(),
    minimumReportingThreshold: z.coerce
      .number()
      .int("يجب أن يكون الحد الأدنى عدداً صحيحاً.")
      .min(1, "يجب أن يكون الحد الأدنى لعرض النتائج 1 على الأقل."),
    enableEnvironmentSurvey: z.boolean(),
    enableFutureSurvey: z.boolean(),
    allowMultipleExecutiveEvaluations: z.boolean(),
    minExecutives: z
      .union([z.coerce.number().int().min(1), z.null()])
      .optional(),
    maxExecutives: z
      .union([z.coerce.number().int().min(1), z.null()])
      .optional(),
    allowResume: z.boolean(),
    privacyNoticeAr: z.string().optional().nullable(),
  })
  .refine(
    (data) => {
      if (data.startsAtLocal && data.endsAtLocal) {
        return data.endsAtLocal > data.startsAtLocal;
      }
      return true;
    },
    {
      message: "يجب أن يكون تاريخ انتهاء الحملة بعد تاريخ بدئها.",
      path: ["endsAtLocal"],
    }
  )
  .refine(
    (data) => {
      const min = data.minExecutives;
      const max = data.maxExecutives;
      if (
        min !== null &&
        min !== undefined &&
        max !== null &&
        max !== undefined
      ) {
        return Number(min) <= Number(max);
      }
      return true;
    },
    {
      message: "الحد الأدنى لعدد المسؤولين أكبر من الحد الأقصى.",
      path: ["maxExecutives"],
    }
  );

type CampaignFormValues = z.input<typeof formSchema>;

const DEFAULTS: CampaignFormValues = {
  titleAr: "",
  descriptionAr: "",
  instructionsAr: "",
  startsAtLocal: "",
  endsAtLocal: "",
  minimumReportingThreshold: 5,
  enableEnvironmentSurvey: true,
  enableFutureSurvey: true,
  allowMultipleExecutiveEvaluations: true,
  minExecutives: undefined,
  maxExecutives: undefined,
  allowResume: true,
  privacyNoticeAr: "",
};

export function CampaignEditorView({
  campaignId,
}: {
  campaignId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isCreate = campaignId === "new";

  // Fetch system settings to prefill the privacy notice default.
  const { data: settingsData } = useQuery<{
    ok: boolean;
    data: SystemSettingsList;
  }>({
    queryKey: ["admin-settings"],
    queryFn: () => fetchJson("/api/admin/settings"),
    enabled: isCreate, // only needed for create mode prefill
  });

  // Fetch the campaign in edit mode.
  const { data, isLoading, isError, error } = useQuery<{
    ok: boolean;
    data: CampaignDetail;
  }>({
    queryKey: ["admin-campaign", campaignId],
    queryFn: () => fetchJson(`/api/admin/campaigns/${encodeURIComponent(campaignId)}`),
    enabled: !isCreate,
  });

  const campaign = data?.data;

  const form = useForm<CampaignFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: DEFAULTS,
    mode: "onSubmit",
  });

  // Prefill form: on create-mode, use system setting privacy_notice (or the
  // bundled PRIVACY_NOTICE constant) when the data first becomes available.
  // On edit-mode, populate every field from the fetched campaign.
  useEffect(() => {
    if (isCreate) {
      const privacy =
        settingsData?.data?.settings?.find((s) => s.key === "privacy_notice")
          ?.valueAr ?? PRIVACY_NOTICE;
      if (form.getValues("privacyNoticeAr") === "") {
        form.setValue("privacyNoticeAr", privacy);
      }
      return;
    }
    if (!campaign) return;
    form.reset({
      titleAr: campaign.titleAr ?? "",
      descriptionAr: campaign.descriptionAr ?? "",
      instructionsAr: campaign.instructionsAr ?? "",
      startsAtLocal: isoToLocalInput(campaign.startsAt),
      endsAtLocal: isoToLocalInput(campaign.endsAt),
      minimumReportingThreshold: campaign.minimumReportingThreshold,
      enableEnvironmentSurvey: campaign.enableEnvironmentSurvey,
      enableFutureSurvey: campaign.enableFutureSurvey,
      allowMultipleExecutiveEvaluations:
        campaign.allowMultipleExecutiveEvaluations,
      minExecutives: campaign.minExecutives ?? undefined,
      maxExecutives: campaign.maxExecutives ?? undefined,
      allowResume: campaign.allowResume,
      privacyNoticeAr: campaign.privacyNoticeAr ?? "",
    });
  }, [campaign, isCreate, settingsData, form]);

  const status = campaign?.status;

  // Build the POST/PATCH payload from the form values.
  const buildPayload = (values: CampaignFormValues) => {
    const payload: Record<string, unknown> = {
      titleAr: values.titleAr.trim(),
      descriptionAr: values.descriptionAr?.trim() || null,
      instructionsAr: values.instructionsAr?.trim() || null,
      startsAt: localInputToIso(values.startsAtLocal ?? ""),
      endsAt: localInputToIso(values.endsAtLocal ?? ""),
      timezone: "Asia/Riyadh",
      minimumReportingThreshold: values.minimumReportingThreshold,
      enableEnvironmentSurvey: values.enableEnvironmentSurvey,
      enableFutureSurvey: values.enableFutureSurvey,
      allowMultipleExecutiveEvaluations:
        values.allowMultipleExecutiveEvaluations,
      minExecutives:
        values.minExecutives === undefined || values.minExecutives === null
          ? null
          : Number(values.minExecutives),
      maxExecutives:
        values.maxExecutives === undefined || values.maxExecutives === null
          ? null
          : Number(values.maxExecutives),
      allowResume: values.allowResume,
      privacyNoticeAr: values.privacyNoticeAr?.trim() || null,
    };
    return payload;
  };

  const saveMutation = useMutation({
    mutationFn: async (values: CampaignFormValues) => {
      const payload = buildPayload(values);
      if (isCreate) {
        const res = await fetch("/api/admin/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = (await res.json()) as {
          ok: boolean;
          error?: string;
          data?: { id: string };
        };
        if (!res.ok || !json.ok) {
          throw new Error(json.error ?? `HTTP ${res.status}`);
        }
        return json.data!;
      } else {
        const res = await fetch(
          `/api/admin/campaigns/${encodeURIComponent(campaignId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        );
        const json = (await res.json()) as {
          ok: boolean;
          error?: string;
          data?: { id: string };
        };
        if (!res.ok || !json.ok) {
          throw new Error(json.error ?? `HTTP ${res.status}`);
        }
        return json.data!;
      }
    },
    onSuccess: async (saved) => {
      await qc.invalidateQueries({ queryKey: ["admin-campaigns"] });
      await qc.invalidateQueries({
        queryKey: ["admin-campaign", saved.id],
      });
      toast({ title: "تم حفظ الحملة" });
      router.push(
        `/?view=admin&tab=campaigns&sub=detail&id=${encodeURIComponent(saved.id)}`
      );
    },
    onError: (err: Error) => {
      toast({
        title: "تعذّر حفظ الحملة",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = form.handleSubmit(
    (values) => saveMutation.mutate(values),
    (errs) => {
      const first = errs[Object.keys(errs)[0] as keyof typeof errs];
      toast({
        title: "يراجَع الاستمارة",
        description: first?.message ?? "توجد حقول تحتاج إلى مراجعة.",
        variant: "destructive",
      });
    }
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={isCreate ? "حملة جديدة" : `تعديل حملة`}
        description={
          isCreate
            ? "أدخِل تفاصيل الحملة الأساسية. يمكن استكمال الإسناد والجدولة لاحقاً."
            : `تعديل تفاصيل الحملة «${campaign?.titleAr ?? ""}»`
        }
        actions={
          campaign ? (
            <div className="flex items-center gap-2">
              <StatusBadge status={campaign.status} />
              <Button
                variant="outline"
                onClick={() =>
                  router.push(
                    `/?view=admin&tab=campaigns&sub=detail&id=${encodeURIComponent(campaign.id)}`
                  )
                }
              >
                عودة للتفاصيل
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={() => router.push("/?view=admin&tab=campaigns")}
            >
              عودة للقائمة
              <ArrowRight className="h-4 w-4" />
            </Button>
          )
        }
      />

      {isError ? (
        <Alert variant="destructive">
          <AlertTitle>تعذّر تحميل الحملة</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : "خطأ غير متوقع."}
          </AlertDescription>
        </Alert>
      ) : !isCreate && (isLoading || !campaign) ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            {/* Basic info */}
            <Card>
              <CardHeader>
                <CardTitle>المعلومات الأساسية</CardTitle>
                <CardDescription>
                  العنوان والوصف وتعليمات المشاركة.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="titleAr"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>عنوان الحملة *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="مثال: استبيان بيئة العمل 2025"
                          {...field}
                          aria-label="عنوان الحملة"
                        />
                      </FormControl>
                      <FormDescription>
                        الاسم الظاهر للموظفين في صفحة المشاركة.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="descriptionAr"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>وصف الحملة</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="وصف موجز لأهداف الحملة"
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                          aria-label="وصف الحملة"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="instructionsAr"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>تعليمات المشاركة</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="تعليمات تظهر قبل بدء الاستبيان"
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                          aria-label="تعليمات المشاركة"
                        />
                      </FormControl>
                      <FormDescription>
                        مطلوبة قبل فتح الحملة (تحقق الجاهزية).
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Schedule */}
            <Card>
              <CardHeader>
                <CardTitle>الجدولة الزمنية</CardTitle>
                <CardDescription>
                  تواريخ البداية والنهاية بتوقيت الرياض.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="startsAtLocal"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>تاريخ البداية</FormLabel>
                      <FormControl>
                        <Input
                          type="datetime-local"
                          {...field}
                          aria-label="تاريخ البداية"
                        />
                      </FormControl>
                      <FormDescription>
                        تُترك فارغة لمسودة مفتوحة أو تُحدد لجدولة لاحقة.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endsAtLocal"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>تاريخ النهاية</FormLabel>
                      <FormControl>
                        <Input
                          type="datetime-local"
                          {...field}
                          aria-label="تاريخ النهاية"
                        />
                      </FormControl>
                      <FormDescription>
                        يجب أن يكون بعد تاريخ البداية.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Settings */}
            <Card>
              <CardHeader>
                <CardTitle>إعدادات الحملة</CardTitle>
                <CardDescription>
                  عتبة عرض النتائج ونطاقات المسؤولين وخيارات الاستئناف.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="minimumReportingThreshold"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>الحد الأدنى لعرض النتائج *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          {...field}
                          aria-label="الحد الأدنى لعرض النتائج"
                        />
                      </FormControl>
                      <FormDescription>
                        عدد المشاركات الأدنى قبل عرض النتائج (افتراضي 5).
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="minExecutives"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>الحد الأدنى لعدد المسؤولين</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === ""
                                ? undefined
                                : Number(e.target.value)
                            )
                          }
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                          aria-label="الحد الأدنى لعدد المسؤولين"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="maxExecutives"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>الحد الأقصى لعدد المسؤولين</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === ""
                                ? undefined
                                : Number(e.target.value)
                            )
                          }
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                          aria-label="الحد الأقصى لعدد المسؤولين"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Toggles */}
            <Card>
              <CardHeader>
                <CardTitle>خيارات الحملة</CardTitle>
                <CardDescription>
                  تفعيل أو تعطيل أقسام الاستبيان والسلوك العام.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ToggleRow
                  control={form.control}
                  name="enableEnvironmentSurvey"
                  label="تفعيل استبيان بيئة العمل"
                  description="قسم الأسئلة على مستوى المؤسسة."
                />
                <ToggleRow
                  control={form.control}
                  name="enableFutureSurvey"
                  label="تفعيل استبيان البيئة المستقبلية"
                  description="قسم أسئلة الاختيار حول التوجهات المستقبلية."
                />
                <ToggleRow
                  control={form.control}
                  name="allowMultipleExecutiveEvaluations"
                  label="السماح بتقييم عدة مسؤولين"
                  description="يتيح للموظف تقييم أكثر من مسؤول في نفس الحملة."
                />
                <ToggleRow
                  control={form.control}
                  name="allowResume"
                  label="السماح باستئناف المشاركة"
                  description="حفظ مسودة محلياً وإكمالها لاحقاً (ميزة قيد التطوير)."
                />
              </CardContent>
            </Card>

            {/* Privacy notice */}
            <Card>
              <CardHeader>
                <CardTitle>إشعار الخصوصية</CardTitle>
                <CardDescription>
                  النص الذي يراه الموظف قبل بدء الاستبيان. يُفضّل تعديله من
                  إعدادات النظام.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="privacyNoticeAr"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Textarea
                          rows={5}
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                          aria-label="إشعار الخصوصية"
                        />
                      </FormControl>
                      <FormDescription>
                        يُستخدم الإعداد الافتراضي في حال ترك الحقل فارغاً.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Action buttons */}
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <Button
                type="submit"
                disabled={saveMutation.isPending}
                className="sm:min-w-32"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                حفظ كمسودة
              </Button>

              {!isCreate && status === "draft" && (
                <ActionButton
                  label="جدولة"
                  loadingLabel="جارٍ الجدولة..."
                  icon={<CalendarClock className="h-4 w-4" />}
                  variant="outline"
                  confirmMessage="سيتم تحويل الحملة إلى حالة المجدولة. هل تريد المتابعة؟"
                  mutationFn={async () => {
                    const res = await fetch(
                      `/api/admin/campaigns/${encodeURIComponent(campaignId)}/schedule`,
                      { method: "POST" }
                    );
                    const json = (await res.json()) as {
                      ok: boolean;
                      error?: string;
                    };
                    return json;
                  }}
                  queryKeyToInvalidate={["admin-campaign", campaignId]}
                  onSuccess={() =>
                    router.push(
                      `/?view=admin&tab=campaigns&sub=detail&id=${encodeURIComponent(campaignId)}`
                    )
                  }
                />
              )}

              {!isCreate &&
                (status === "draft" || status === "scheduled") && (
                  <ActivateButton campaignId={campaignId} />
                )}

              {!isCreate && campaign && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    router.push(
                      `/?view=admin&tab=campaigns&sub=detail&id=${encodeURIComponent(campaignId)}&preview=1`
                    )
                  }
                >
                  <Eye className="h-4 w-4" />
                  معاينة
                </Button>
              )}
            </div>
          </form>
        </Form>
      )}
    </div>
  );
}

/** A single labelled Switch row inside the editor form. */
function ToggleRow({
  control,
  name,
  label,
  description,
}: {
  control: import("react-hook-form").Control<CampaignFormValues>;
  name:
    | "enableEnvironmentSurvey"
    | "enableFutureSurvey"
    | "allowMultipleExecutiveEvaluations"
    | "allowResume";
  label: string;
  description?: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <div className="flex flex-row items-center justify-between gap-4 rounded-lg border border-border p-4">
            <div className="space-y-0.5 min-w-0">
              <FormLabel className="text-sm font-medium">{label}</FormLabel>
              {description && (
                <FormDescription>{description}</FormDescription>
              )}
            </div>
            <FormControl>
              <Switch
                checked={!!field.value}
                onCheckedChange={field.onChange}
                aria-label={label}
              />
            </FormControl>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** The activate button — pre-fetches readiness, then either activates
 * directly (when ready) or surfaces an AlertDialog listing the issues. */
function ActivateButton({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [issues, setIssues] = useState<
    { key: string; messageAr: string }[] | null
  >(null);
  const [pending, setPending] = useState(false);

  const handleActivate = async () => {
    setPending(true);
    try {
      // Pre-flight readiness fetch (also surfaces issues from /activate
      // itself, but pre-fetching gives a cleaner UX: the dialog appears
      // before the POST, and we don't burn an audit-log entry on a
      // pre-emptive failure).
      const readyRes = await fetchJson<{
        ok: boolean;
        data: ReadinessResult;
      }>(`/api/admin/campaigns/${encodeURIComponent(campaignId)}/readiness`);
      if (!readyRes.data.ready) {
        setIssues(readyRes.data.issues);
        return;
      }
      // Ready — fire the activation.
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
      await qc.invalidateQueries({ queryKey: ["admin-campaigns"] });
      await qc.invalidateQueries({
        queryKey: ["admin-campaign", campaignId],
      });
      toast({ title: "تم تفعيل الحملة" });
      router.push(
        `/?view=admin&tab=campaigns&sub=detail&id=${encodeURIComponent(campaignId)}`
      );
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
          <ul className="max-h-72 overflow-y-auto space-y-2 scroll-rtl pe-1">
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
