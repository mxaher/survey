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
 * RTL behavior: relies on flex/grid auto-mirroring (no `text-left/right`
 * hacks). On wide screens options wrap horizontally with a min touch target
 * of 44px; on narrow screens they stack vertically.
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
        return (
          <Label
            key={opt.value}
            htmlFor={`${name}-${opt.value}`}
            className={cn(
              "flex items-center gap-3 rounded-md border px-3 py-3 cursor-pointer transition-colors min-h-[44px]",
              checked
                ? "border-primary bg-primary/5 text-foreground"
                : "border-border bg-card text-foreground/90 hover:bg-accent/50"
            )}
          >
            <RadioGroupItem
              id={`${name}-${opt.value}`}
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
  );
}
