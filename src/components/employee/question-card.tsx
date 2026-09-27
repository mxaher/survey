"use client";

/**
 * Single-question renderer (Task 3-a).
 *
 * Picks the right input component per `questionType`:
 *   - `scale`         → ScaleRadio (5(+1) agreement/frequency scale)
 *   - `yes_no`        → ScaleRadio (re-uses the same renderer; options drive
 *                       the labels)
 *   - `single_choice` → RadioGroup (one of N)
 *   - `multi_choice`  → Checkbox grid (multi-select up to `maxSelections`)
 *
 * Required questions are flagged with a red asterisk on the label per the
 * task spec ("Mark required ones with a red asterisk"). The card is plain
 * shadcn Card — no custom CSS.
 *
 * Visual polish (round 2):
 *  - 2px right border accent (RTL) for required questions.
 *  - Better spacing between the question header and the options.
 *  - Hover lift on the card itself.
 *  - Clearer dimension + required badges.
 *
 * RTL behavior: relies on flex/grid auto-mirroring. No `text-left/right`.
 */
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScaleRadio } from "./scale-radio";
import type { QuestionSnapshot } from "./types";
import { CATEGORY_LABEL_AR } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface QuestionCardProps {
  question: QuestionSnapshot;
  index: number;
  /** Single-select value (for `scale`, `yes_no`, `single_choice`). */
  value?: string;
  onValueChange?: (value: string) => void;
  /** Multi-select values (for `multi_choice`). */
  values?: string[];
  onValuesChange?: (values: string[]) => void;
  disabled?: boolean;
}

export function QuestionCard({
  question,
  index,
  value,
  onValueChange,
  values,
  onValuesChange,
  disabled,
}: QuestionCardProps) {
  const qType = question.questionType;
  const fieldName = `q-${question.id}`;

  const isMulti = qType === "multi_choice";
  const isScale = qType === "scale" || qType === "yes_no";
  const isSingle = qType === "single_choice";

  // Multi-select with max enforcement: once `maxSelections` is reached, the
  // remaining unchecked options become disabled. We surface the limit too
  // so the user understands why some options gray out.
  const maxSelections = question.maxSelections ?? 0;
  const atMax =
    isMulti && maxSelections > 0 && (values?.length ?? 0) >= maxSelections;

  const toggleMulti = (optValue: string) => {
    if (!onValuesChange) return;
    const cur = values ?? [];
    if (cur.includes(optValue)) {
      onValuesChange(cur.filter((v) => v !== optValue));
    } else {
      onValuesChange([...cur, optValue]);
    }
  };

  return (
    <Card
      className={cn(
        "py-4 transition-all duration-200 hover:shadow-sm",
        // Subtle right-edge accent (RTL) for required questions.
        question.isRequired &&
          "border-e-2 border-e-primary/40 hover:border-r-primary/70"
      )}
    >
      <CardHeader className="pb-3 gap-1.5">
        <div className="flex items-start gap-2.5">
          <span
            className="text-xs font-mono text-muted-foreground/80 pt-1 shrink-0 tabular-nums"
            style={{ fontFeatureSettings: '"tnum" 1' }}
          >
            {index + 1}.
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm sm:text-base font-medium leading-relaxed text-foreground">
              {question.questionAr}
              {question.isRequired ? (
                <span
                  className="text-destructive ms-1 font-bold"
                  aria-label="مطلوب"
                  aria-hidden
                >
                  *
                </span>
              ) : null}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {question.dimension ? (
                <Badge
                  variant="outline"
                  className="text-[10px] font-medium text-primary/80 border-primary/30 bg-primary/5"
                >
                  {CATEGORY_LABEL_AR[question.dimension] ?? question.dimension}
                </Badge>
              ) : null}
              {question.isRequired ? (
                <Badge
                  variant="outline"
                  className="text-[10px] font-medium text-destructive border-destructive/30 bg-destructive/5"
                >
                  مطلوب
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="text-[10px] font-medium text-muted-foreground"
                >
                  اختياري
                </Badge>
              )}
              {isMulti && maxSelections > 0 ? (
                <Badge
                  variant="outline"
                  className="text-[10px] font-medium text-amber-700 border-amber-300/50 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40"
                >
                  حد أقصى {maxSelections} اختيارات
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isScale ? (
          <div className="space-y-2.5">
            {qType === "scale" ? (
              <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
                <p>
                  اختر الإجابة التي تصف تكرار السلوك كما تراه في العمل الفعلي.
                </p>
                {question.options.some((o) => o.value === "not_applicable") ? (
                  <p>
                    اختر «لا ينطبق / لا أملك معلومات كافية» إذا لم تكن لديك
                    تجربة كافية للحكم على هذا البند.
                  </p>
                ) : null}
              </div>
            ) : null}
            <ScaleRadio
              options={question.options}
              value={value}
              onValueChange={(v) => onValueChange?.(v)}
              disabled={disabled}
              name={fieldName}
            />
          </div>
        ) : isSingle ? (
          <RadioGroup
            value={value}
            onValueChange={(v) => onValueChange?.(v)}
            disabled={disabled}
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
            aria-label={fieldName}
          >
            {question.options.map((opt) => {
              const checked = value === opt.value;
              return (
                <Label
                  key={opt.value}
                  htmlFor={`${fieldName}-${opt.value}`}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border px-3.5 py-3.5 cursor-pointer transition-all duration-150 min-h-[48px]",
                    checked
                      ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary/30 shadow-sm"
                      : "border-border bg-card text-foreground/90 hover:bg-accent/50 hover:border-primary/30"
                  )}
                >
                  <RadioGroupItem
                    id={`${fieldName}-${opt.value}`}
                    value={opt.value}
                    className="shrink-0"
                  />
                  <span
                    className={cn(
                      "text-sm leading-snug",
                      checked ? "font-semibold" : "font-medium"
                    )}
                  >
                    {opt.labelAr}
                  </span>
                </Label>
              );
            })}
          </RadioGroup>
        ) : isMulti ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {question.options.map((opt) => {
              const checked = values?.includes(opt.value) ?? false;
              const optDisabled = disabled || (atMax && !checked);
              return (
                <Label
                  key={opt.value}
                  htmlFor={`${fieldName}-${opt.value}`}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border px-3.5 py-3.5 cursor-pointer transition-all duration-150 min-h-[48px]",
                    checked
                      ? "border-primary bg-primary/5 ring-1 ring-primary/30 shadow-sm"
                      : "border-border bg-card hover:bg-accent/50 hover:border-primary/30",
                    optDisabled && !disabled && "opacity-60 cursor-not-allowed"
                  )}
                >
                  <Checkbox
                    id={`${fieldName}-${opt.value}`}
                    checked={checked}
                    disabled={optDisabled}
                    onCheckedChange={() => toggleMulti(opt.value)}
                  />
                  <span
                    className={cn(
                      "text-sm leading-snug",
                      checked ? "font-semibold" : "font-medium"
                    )}
                  >
                    {opt.labelAr}
                  </span>
                </Label>
              );
            })}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            نوع سؤال غير مدعوم ({qType})
          </div>
        )}
      </CardContent>
    </Card>
  );
}
