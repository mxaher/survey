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
 * RTL behavior: relies on flex/grid auto-mirroring. No `text-left/right`.
 */
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScaleRadio } from "./scale-radio";
import type { QuestionSnapshot } from "./types";
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
    <Card className="py-4">
      <CardHeader className="pb-2 gap-1.5">
        <div className="flex items-start gap-2">
          <span className="text-xs font-mono text-muted-foreground pt-0.5 shrink-0">
            {index + 1}.
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm sm:text-base font-medium leading-relaxed text-foreground">
              {question.questionAr}
              {question.isRequired ? (
                <span className="text-destructive ms-1" aria-hidden>
                  *
                </span>
              ) : null}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              {question.dimension ? (
                <Badge variant="outline" className="text-[10px] font-normal">
                  {question.dimension}
                </Badge>
              ) : null}
              {question.isRequired ? (
                <Badge variant="secondary" className="text-[10px] font-normal">
                  مطلوب
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] font-normal">
                  اختياري
                </Badge>
              )}
              {isMulti && maxSelections > 0 ? (
                <Badge variant="outline" className="text-[10px] font-normal">
                  حد أقصى {maxSelections} اختيارات
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        {isScale ? (
          <ScaleRadio
            options={question.options}
            value={value}
            onValueChange={(v) => onValueChange?.(v)}
            disabled={disabled}
            name={fieldName}
          />
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
                    "flex items-center gap-3 rounded-md border px-3 py-3 cursor-pointer transition-colors min-h-[44px]",
                    checked
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border bg-card text-foreground/90 hover:bg-accent/50"
                  )}
                >
                  <RadioGroupItem
                    id={`${fieldName}-${opt.value}`}
                    value={opt.value}
                    className="shrink-0"
                  />
                  <span className="text-sm font-medium leading-snug">
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
                    "flex items-center gap-3 rounded-md border px-3 py-3 cursor-pointer transition-colors min-h-[44px]",
                    checked
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:bg-accent/50",
                    optDisabled && !disabled && "opacity-60 cursor-not-allowed"
                  )}
                >
                  <Checkbox
                    id={`${fieldName}-${opt.value}`}
                    checked={checked}
                    disabled={optDisabled}
                    onCheckedChange={() => toggleMulti(opt.value)}
                  />
                  <span className="text-sm font-medium leading-snug">
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
