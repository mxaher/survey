"use client";

/**
 * Question editor — Task 3-c leaf component #2.
 *
 * Create or edit a question in the library. Includes:
 *  - Form fields: questionAr, code (unique), questionType, section,
 *    dimension (depends on section), isRequired, displayOrder, maxSelections
 *    (multi_choice only).
 *  - Options editor: rows with value/labelAr/score + drag-and-drop reordering
 *    via @dnd-kit. Prefilled from STANDARD_SCALES for new questions whose
 *    section+type match a known scale.
 *  - Save → POST (new) or PATCH (existing) → toast + navigate to list.
 *  - If GET returns `structurallyLocked: true`: disable questionAr, type,
 *    options, score fields and show an Alert explaining historical-integrity
 *    preservation. Only isActive / displayOrder / isRequired remain editable.
 *
 * Implementation note: parent `QuestionEditorView` handles data fetching +
 * loading/error states, then renders a child `QuestionForm` keyed by
 * `questionId`. The child initializes its state from `initial` props via
 * `useState(initializer)` — the React-recommended pattern for hydrating form
 * state, which avoids `setState`-in-effect cascades. Side-effects that were
 * previously in useEffect (clear code error, clear dimension on section
 * change, prefill options on type/section change) are moved into onChange
 * handlers — the natural React way to react to user input.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  GripVertical,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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

import {
  ENVIRONMENT_DIMENSIONS,
  LEADERSHIP_DIMENSIONS,
  QUESTION_SECTIONS,
  QUESTION_TYPES,
  STANDARD_SCALES,
} from "@/lib/constants";

/** Shape returned by GET /api/admin/questions/[id]. */
type QuestionDetail = {
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
  options: Array<{
    id?: string;
    value: string;
    labelAr: string;
    score: number | null;
    displayOrder: number;
    isActive: boolean;
  }>;
  campaignConfigCount: number;
  structurallyLocked?: boolean;
};

type OptionRow = {
  id?: string; // only set when editing existing option
  value: string;
  labelAr: string;
  score: string; // kept as string for controlled input; parsed on save
  displayOrder: number;
  isActive: boolean;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** Build the initial options list for a brand-new question. */
function defaultOptionsFor(type: string, section: string): OptionRow[] {
  // multi_choice + future → empty (spec says user must add)
  if (section === "future" && (type === "single_choice" || type === "multi_choice")) {
    return [];
  }
  // leadership scale + scale type → STANDARD_SCALES.leadership
  if (section === "leadership" && (type === "scale" || type === "yes_no")) {
    return (STANDARD_SCALES.leadership as ReadonlyArray<{ value: string; labelAr: string; score: number | null }>).map(
      (o, i) => ({
        value: o.value,
        labelAr: o.labelAr,
        score: o.score === null ? "" : String(o.score),
        displayOrder: i,
        isActive: true,
      })
    );
  }
  // environment + scale → environment scale
  if (section === "environment" && type === "scale") {
    return (STANDARD_SCALES.environment as ReadonlyArray<{ value: string; labelAr: string; score: number | null }>).map(
      (o, i) => ({
        value: o.value,
        labelAr: o.labelAr,
        score: o.score === null ? "" : String(o.score),
        displayOrder: i,
        isActive: true,
      })
    );
  }
  // yes_no
  if (type === "yes_no") {
    return (STANDARD_SCALES.yes_no as ReadonlyArray<{ value: string; labelAr: string; score: number | null }>).map(
      (o, i) => ({
        value: o.value,
        labelAr: o.labelAr,
        score: o.score === null ? "" : String(o.score),
        displayOrder: i,
        isActive: true,
      })
    );
  }
  return [];
}

function dimensionOptions(section: string): ReadonlyArray<{ key: string; labelAr: string }> {
  if (section === "environment") return ENVIRONMENT_DIMENSIONS;
  if (section === "leadership") return LEADERSHIP_DIMENSIONS;
  return [];
}

/** One sortable option row. */
function SortableOptionRow({
  opt,
  index,
  onChange,
  onRemove,
  locked,
}: {
  opt: OptionRow;
  index: number;
  onChange: (patch: Partial<OptionRow>) => void;
  onRemove: () => void;
  locked: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `opt-${index}` });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">القيمة</span>
        <Input
          value={opt.value}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder="option_value"
          className="w-44"
          disabled={locked}
        />
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <span className="text-xs text-muted-foreground">النص بالعربية</span>
        <Input
          value={opt.labelAr}
          onChange={(e) => onChange({ labelAr: e.target.value })}
          placeholder="نص الخيار"
          disabled={locked}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">الدرجة</span>
        <Input
          type="number"
          inputMode="numeric"
          value={opt.score}
          onChange={(e) => onChange({ score: e.target.value })}
          placeholder="اختياري"
          className="w-24"
          disabled={locked}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">الترتيب</span>
        <div className="flex h-9 w-12 items-center justify-center rounded-md border border-input bg-muted text-sm">
          {opt.displayOrder}
        </div>
      </div>
      <button
        type="button"
        className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        {...attributes}
        {...listeners}
        aria-label="اسحب لإعادة الترتيب"
        disabled={locked}
      >
        <GripVertical className="h-5 w-5" />
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        disabled={locked}
        className="text-destructive hover:text-destructive"
        aria-label="حذف الخيار"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

// =========================================================================
// Parent: data fetcher + loading / error states → renders the form keyed
// =========================================================================
export function QuestionEditorView({ questionId }: { questionId: string }) {
  const isNew = questionId === "new";

  const { data, isLoading, isError, error } = useQuery<{
    ok: boolean;
    data: QuestionDetail;
  } | null>({
    queryKey: ["admin-question", questionId],
    queryFn: () => fetchJson(`/api/admin/questions/${questionId}`),
    enabled: !isNew,
  });

  if (!isNew && isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (!isNew && isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>تعذّر تحميل السؤال</AlertTitle>
        <AlertDescription>
          {(error as Error)?.message ?? "حدث خطأ غير متوقع."}
        </AlertDescription>
      </Alert>
    );
  }
  if (!isNew && !data?.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>تعذّر تحميل السؤال</AlertTitle>
        <AlertDescription>السؤال غير موجود.</AlertDescription>
      </Alert>
    );
  }

  return (
    <QuestionForm
      key={questionId}
      questionId={questionId}
      isNew={isNew}
      initial={data?.data}
    />
  );
}

// =========================================================================
// Child: form, initializes state from `initial` props via useState(initializer)
// =========================================================================
function QuestionForm({
  questionId,
  isNew,
  initial,
}: {
  questionId: string;
  isNew: boolean;
  initial?: QuestionDetail;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const qc = useQueryClient();

  const structurallyLocked = !!initial?.structurallyLocked;

  // Initialize from props — runs once on mount thanks to `key`.
  const [code, setCode] = useState(initial?.code ?? "");
  const [questionAr, setQuestionAr] = useState(initial?.questionAr ?? "");
  const [questionType, setQuestionType] = useState<string>(
    initial?.questionType ?? "scale"
  );
  const [section, setSection] = useState<string>(initial?.section ?? "leadership");
  const [dimension, setDimension] = useState<string>(initial?.dimension ?? "");
  const [isRequired, setIsRequired] = useState(initial?.isRequired ?? true);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [displayOrder, setDisplayOrder] = useState<number>(
    initial?.displayOrder ?? 0
  );
  const [maxSelections, setMaxSelections] = useState<string>(
    initial?.maxSelections != null ? String(initial.maxSelections) : ""
  );
  // For new questions, prefill from STANDARD_SCALES based on type+section.
  const [options, setOptions] = useState<OptionRow[]>(() => {
    if (initial) {
      return initial.options.map((o) => ({
        id: o.id,
        value: o.value,
        labelAr: o.labelAr,
        score: o.score == null ? "" : String(o.score),
        displayOrder: o.displayOrder,
        isActive: o.isActive,
      }));
    }
    // New question: prefill based on the default type+section.
    return defaultOptionsFor("scale", "leadership");
  });
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const dims = useMemo(() => dimensionOptions(section), [section]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setOptions((prev) => {
      const oldIndex = prev.findIndex((_, i) => `opt-${i}` === active.id);
      const newIndex = prev.findIndex((_, i) => `opt-${i}` === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      const moved = arrayMove(prev, oldIndex, newIndex);
      // Renumber displayOrder.
      return moved.map((o, i) => ({ ...o, displayOrder: i }));
    });
  }

  function addOption() {
    setOptions((prev) => [
      ...prev,
      {
        value: "",
        labelAr: "",
        score: "",
        displayOrder: prev.length,
        isActive: true,
      },
    ]);
  }

  function updateOption(index: number, patch: Partial<OptionRow>) {
    setOptions((prev) =>
      prev.map((o, i) => (i === index ? { ...o, ...patch } : o))
    );
  }

  function removeOption(index: number) {
    setOptions((prev) =>
      prev
        .filter((_, i) => i !== index)
        .map((o, i) => ({ ...o, displayOrder: i }))
    );
  }

  /** When the user changes the section, also reset the dimension if the new
   *  section has no dimensions. */
  function handleSectionChange(newSection: string) {
    setSection(newSection);
    const newDims = dimensionOptions(newSection);
    if (newDims.length === 0 && dimension !== "") {
      setDimension("");
    }
    // Prefill options if empty (new questions only).
    if (isNew && options.length === 0) {
      setOptions(defaultOptionsFor(questionType, newSection));
    }
  }

  /** When the user changes the type, prefill options if empty (new only). */
  function handleTypeChange(newType: string) {
    setQuestionType(newType);
    if (isNew && options.length === 0) {
      setOptions(defaultOptionsFor(newType, section));
    }
  }

  /** When the user edits the code, clear any previous collision error. */
  function handleCodeChange(value: string) {
    setCode(value);
    if (codeError) setCodeError(null);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Validate locally first.
      if (!code.trim()) throw new Error("رمز السؤال مطلوب.");
      if (!questionAr.trim()) throw new Error("نص السؤال مطلوب.");

      // Build the options payload. Skip empty rows.
      const cleanOptions = options
        .filter((o) => o.value.trim() !== "" && o.labelAr.trim() !== "")
        .map((o, i) => ({
          ...(o.id ? { id: o.id } : {}),
          value: o.value.trim(),
          labelAr: o.labelAr.trim(),
          score: o.score.trim() === "" ? null : Number(o.score),
          displayOrder: i,
          isActive: o.isActive,
        }));

      // For scale / yes_no we should have at least one option.
      if (
        (questionType === "scale" || questionType === "yes_no" ||
          questionType === "single_choice" || questionType === "multi_choice") &&
        cleanOptions.length === 0
      ) {
        throw new Error("يجب إضافة خيار واحد على الأقل.");
      }

      const body: Record<string, unknown> = {
        code: code.trim(),
        questionAr: questionAr.trim(),
        questionType,
        section,
        dimension: dims.length > 0 && dimension ? dimension : null,
        isRequired,
        displayOrder,
        isActive,
        options: cleanOptions,
      };
      if (questionType === "multi_choice") {
        body.maxSelections = maxSelections.trim() === "" ? null : Number(maxSelections);
      }

      const url = isNew
        ? "/api/admin/questions"
        : `/api/admin/questions/${questionId}`;
      const method = isNew ? "POST" : "PATCH";

      // If structurally locked, drop structural fields.
      if (structurallyLocked) {
        delete body.questionAr;
        delete body.questionType;
        delete body.section;
        delete body.dimension;
        delete body.isRequired;
        delete body.maxSelections;
        delete body.options;
        // code is structural too.
        delete body.code;
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        // Code collision: 409 from API.
        if (res.status === 409) {
          setCodeError("رمز السؤال مستخدم مسبقاً. يرجى اختيار رمز فريد.");
        }
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      return json;
    },
    onSuccess: async () => {
      toast({
        title: isNew ? "تم إنشاء السؤال" : "تم تحديث السؤال",
        description: "تم حفظ السؤال بنجاح.",
      });
      await qc.invalidateQueries({ queryKey: ["admin-questions"] });
      router.push("/?view=admin&tab=questions");
    },
    onError: (err: Error) => {
      setFormError(err.message);
      toast({
        title: "تعذّر حفظ السؤال",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={isNew ? "سؤال جديد" : `تعديل السؤال: ${code}`}
        description={
          structurallyLocked
            ? "هذا السؤال مرتبط بحملة لها إجابات. التعديلات الهيكلية محظورة."
            : "أنشئ سؤالاً قابلاً لإعادة الاستخدام في حملات متعددة."
        }
        actions={
          <Button variant="outline" onClick={() => router.push("/?view=admin&tab=questions")}>
            <ArrowRight className="ml-2 h-4 w-4" />
            عودة للقائمة
          </Button>
        }
      />

      {structurallyLocked && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>السؤال مقفل هيكلياً</AlertTitle>
          <AlertDescription>
            هذا السؤال مرتبط بحملة لها إجابات. التعديلات الهيكلية محظورة حفاظاً على سلامة النتائج التاريخية. يمكنك تعديل الحالة والترتيب فقط.
          </AlertDescription>
        </Alert>
      )}

      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column: question fields */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>حقول السؤال</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="questionAr">نص السؤال *</Label>
              <Textarea
                id="questionAr"
                value={questionAr}
                onChange={(e) => setQuestionAr(e.target.value)}
                placeholder="أدخل نص السؤال بالعربية"
                rows={3}
                disabled={structurallyLocked}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="code">الرمز *</Label>
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => handleCodeChange(e.target.value)}
                  placeholder="Q_LEAD_001"
                  disabled={structurallyLocked}
                  aria-invalid={!!codeError}
                />
                {codeError && (
                  <p className="text-xs text-destructive">{codeError}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  رمز فريد يُستخدم داخلياً للتمييز بين الأسئلة.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label>نوع السؤال</Label>
                <Select
                  value={questionType}
                  onValueChange={handleTypeChange}
                  disabled={structurallyLocked}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QUESTION_TYPES.map((t) => (
                      <SelectItem key={t.key} value={t.key}>
                        {t.labelAr}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <Label>القسم</Label>
                <Select
                  value={section}
                  onValueChange={handleSectionChange}
                  disabled={structurallyLocked}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QUESTION_SECTIONS.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.labelAr}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <Label>المحور</Label>
                {dims.length > 0 ? (
                  <Select
                    value={dimension}
                    onValueChange={setDimension}
                    disabled={structurallyLocked}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="اختر المحور" />
                    </SelectTrigger>
                    <SelectContent>
                      {dims.map((d) => (
                        <SelectItem key={d.key} value={d.key}>
                          {d.labelAr}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value="لا ينطبق"
                    disabled
                    className="bg-muted/40"
                  />
                )}
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

              {questionType === "multi_choice" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="maxSelections">أقصى عدد اختيارات</Label>
                  <Input
                    id="maxSelections"
                    type="number"
                    inputMode="numeric"
                    value={maxSelections}
                    onChange={(e) => setMaxSelections(e.target.value)}
                    placeholder="اختياري"
                    disabled={structurallyLocked}
                    min={1}
                  />
                  <p className="text-xs text-muted-foreground">
                    اتركه فارغاً للسماح بكل الخيارات.
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-6 pt-2">
              <div className="flex items-center gap-2">
                <Switch
                  id="isRequired"
                  checked={isRequired}
                  onCheckedChange={setIsRequired}
                  disabled={structurallyLocked}
                />
                <Label htmlFor="isRequired">سؤال إلزامي</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="isActive"
                  checked={isActive}
                  onCheckedChange={setIsActive}
                />
                <Label htmlFor="isActive">سؤال نشط</Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right column: meta / preview / actions */}
        <Card>
          <CardHeader>
            <CardTitle>معلومات</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            {!isNew && initial && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">الإصدار</span>
                  <span className="font-mono">{initial.version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">عدد الحملات</span>
                  <span>{initial.campaignConfigCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">تاريخ الإنشاء</span>
                  <span>{new Date(initial.createdAt).toLocaleDateString("ar-SA")}</span>
                </div>
              </>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">عدد الخيارات</span>
              <span>{options.length}</span>
            </div>

            <div className="mt-2 flex flex-col gap-2">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="ml-2 h-4 w-4" />
                )}
                {isNew ? "إنشاء السؤال" : "حفظ التعديلات"}
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push("/?view=admin&tab=questions")}
              >
                إلغاء
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Options editor */}
      <Card>
        <CardHeader>
          <CardTitle>الخيارات</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {structurallyLocked && (
            <Alert>
              <AlertDescription>
                تعديل قائمة الخيارات محظور لأن السؤال مرتبط بنتائج سابقة.
              </AlertDescription>
            </Alert>
          )}
          {options.length === 0 && !structurallyLocked && (
            <div className="rounded-lg border border-dashed border-border bg-card/50 p-6 text-center">
              <p className="text-sm text-muted-foreground">
                لا توجد خيارات بعد. ابدأ بإضافة خيار جديد.
              </p>
            </div>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={options.map((_, i) => `opt-${i}`)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-2">
                {options.map((opt, idx) => (
                  <SortableOptionRow
                    key={idx}
                    index={idx}
                    opt={opt}
                    locked={structurallyLocked}
                    onChange={(patch) => updateOption(idx, patch)}
                    onRemove={() => removeOption(idx)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {!structurallyLocked && (
            <Button
              type="button"
              variant="outline"
              onClick={addOption}
              className="w-fit"
            >
              <Plus className="ml-2 h-4 w-4" />
              إضافة خيار
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
