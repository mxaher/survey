"use client";

/**
 * Executive picker (Task 3-a, spec §8 step 2).
 *
 * Renders the dropdown of executives assigned to the active campaign that
 * the employee has not yet evaluated, plus a separate list of already-
 * evaluated executives with `MESSAGES.alreadyEvaluatedLabel` badges.
 *
 * Uses the shadcn Select component. When the user picks an executive, the
 * parent wizard loads the leadership questions for that executive. If
 * `allowMultipleExecutiveEvaluations === false` AND one executive is already
 * evaluated, the picker is disabled and the parent renders the
 * "تم تقييم مسؤول واحد ضمن هذه الحملة" banner instead.
 *
 * RTL: the Select component's chevron is mirrored by Radix; the
 * already-evaluated list uses a plain RTL flex row with a checkmark badge.
 */
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Users, Info } from "lucide-react";
import { MESSAGES } from "@/lib/messages";
import type { ExecutiveRow } from "./types";

interface ExecutivePickerProps {
  executives: ExecutiveRow[];
  evaluatedExecutiveIds: string[];
  currentExecutiveId: string | null;
  onSelect: (id: string) => void;
  /** When false AND ≥1 evaluated → render the "single eval done" banner. */
  allowMultiple: boolean;
}

export function ExecutivePicker({
  executives,
  evaluatedExecutiveIds,
  currentExecutiveId,
  onSelect,
  allowMultiple,
}: ExecutivePickerProps) {
  // Block further evaluations when single-eval mode and one is done.
  const singleEvalDone =
    !allowMultiple && evaluatedExecutiveIds.length >= 1;

  const evaluatedSet = new Set(evaluatedExecutiveIds);
  const available = executives.filter((e) => !evaluatedSet.has(e.id));
  const evaluated = executives.filter((e) => evaluatedSet.has(e.id));

  if (singleEvalDone) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm">
        <Info className="h-5 w-5 shrink-0 mt-0.5 text-muted-foreground" />
        <div className="flex-1">
          <p className="font-medium text-foreground">
            تم تقييم مسؤول واحد ضمن هذه الحملة
          </p>
          <p className="text-muted-foreground mt-1 leading-relaxed">
            لا يُسمح بتقييم أكثر من مسؤول ضمن هذه الحملة. يمكنك الانتقال
            إلى القسم التالي.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="executive-select"
          className="block text-sm font-medium mb-2"
        >
          {MESSAGES.selectExecutivePrompt}
        </label>
        <Select
          value={currentExecutiveId ?? ""}
          onValueChange={(v) => onSelect(v)}
          disabled={available.length === 0}
        >
          <SelectTrigger
            id="executive-select"
            className="w-full min-h-[44px]"
            aria-label={MESSAGES.selectExecutivePrompt}
          >
            <SelectValue
              placeholder={
                available.length === 0
                  ? "لا يوجد مسؤولون متاحون للتقييم"
                  : "— اختر مسؤولاً —"
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>المسؤولون المتاحون</SelectLabel>
              {available.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  تم تقييم جميع المسؤولين المخصصين.
                </div>
              ) : (
                available.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    <span className="font-medium">{e.nameAr}</span>
                    <span className="text-muted-foreground text-xs ms-1">
                      — {e.titleAr}
                      {e.departmentAr ? ` · ${e.departmentAr}` : ""}
                    </span>
                  </SelectItem>
                ))
              )}
            </SelectGroup>
            {evaluated.length > 0 ? (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>{MESSAGES.evaluatedManagersLabel}</SelectLabel>
                  {evaluated.map((e) => (
                    <SelectItem
                      key={e.id}
                      value={e.id}
                      disabled
                      className="opacity-60"
                    >
                      <span className="font-medium">{e.nameAr}</span>
                      <span className="text-muted-foreground text-xs ms-1">
                        — {e.titleAr}
                      </span>
                      <Badge variant="secondary" className="ms-2 text-[10px]">
                        {MESSAGES.alreadyEvaluatedLabel}
                      </Badge>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            ) : null}
          </SelectContent>
        </Select>
      </div>

      {evaluated.length > 0 ? (
        <div className="rounded-md border border-border bg-muted/20 p-3">
          <div className="flex items-center gap-2 mb-2 text-xs font-medium text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            {MESSAGES.evaluatedManagersLabel}
          </div>
          <ul className="space-y-1.5">
            {evaluated.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="font-medium">
                  {e.nameAr}
                  <span className="text-muted-foreground text-xs ms-1">
                    — {e.titleAr}
                  </span>
                </span>
                <Badge variant="secondary" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {MESSAGES.alreadyEvaluatedLabel}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
