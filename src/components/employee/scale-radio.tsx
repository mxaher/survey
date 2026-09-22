"use client";

/**
 * Scale radio group renderer (Task 3-a, spec §9).
 *
 * Renders the 5(+1) agreement/frequency scale as a horizontal RadioGroup.
 * Used by both environment questions (5-point agreement scale: أوافق بشدة /
 * أوافق / محايد / لا أوافق / لا أوافق بشدة) and leadership questions
 * (5(+1) frequency scale: دائماً / غالباً / أحياناً / نادراً / أبداً /
 * لا ينطبق). The labels and scores come from the frozen option snapshots —
 * this component just lays them out responsively.
 *
 * Visual polish (round 2):
 *  - 48px min touch target (was 44).
 *  - Hover lift + ring transition.
 *  - Checked state uses primary bg + bold + ring.
 *  - "not_applicable" option is visually muted (it's excluded from averages).
 */
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { QuestionOptionSnapshot } from "./types";

interface ScaleRadioProps {
  options: QuestionOptionSnapshot[];
  value: string | undefined;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  name: string;
}

export function ScaleRadio({
  options,
  value,
  onValueChange,
  disabled,
  name,
}: ScaleRadioProps) {
  return (
    <RadioGroup
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
      aria-label={name}
    >
      {options.map((opt) => {
        const checked = value === opt.value;
        const isNa = opt.value === "not_applicable";
        return (
          <Label
            key={opt.value}
            htmlFor={`${name}-${opt.value}`}
            className={cn(
              "group flex items-center gap-3 rounded-lg border px-3.5 py-3.5 cursor-pointer transition-all duration-150 min-h-[48px]",
              checked
                ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary/30 shadow-sm"
                : "border-border bg-card text-foreground/90 hover:bg-accent/50 hover:border-primary/30",
              isNa && "opacity-70",
              disabled && "cursor-not-allowed opacity-60"
            )}
          >
            <RadioGroupItem
              id={`${name}-${opt.value}`}
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
  );
}
