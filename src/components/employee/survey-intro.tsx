"use client";

/**
 * Survey intro card (Task 3-a, spec §8 step 1).
 *
 * Shown before the wizard starts. Displays:
 *   - Campaign title (large)
 *   - Description (if present)
 *   - Instructions (if present)
 *   - Privacy notice (resolved server-side: campaign override → system
 *     setting → bundled `PRIVACY_NOTICE`)
 *   - The bundled `INTRO_COPY` paragraph
 *   - CTA "ابدأ الاستبيان" button → calls `onStart`
 *
 * Visual polish (round 2):
 *  - Hero gradient header band.
 *  - Larger CTA with shadow + icon emphasis.
 *  - Summary pills with status icons + consistent card heights.
 *  - Better vertical rhythm + line-height for Arabic readability.
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck,
  FileText,
  PlayCircle,
  CheckCircle2,
  Circle,
  Clock,
} from "lucide-react";
import { INTRO_COPY } from "@/lib/messages";
import { envSectionEnabled, futureSectionEnabled } from "@/lib/survey-sections";
import type { ActiveCampaign } from "./types";

interface SurveyIntroProps {
  campaign: ActiveCampaign;
  onStart: () => void;
  /** How many executives the employee is expected to evaluate. */
  totalExecutives: number;
  /** How many executives are already evaluated (server-side truth). */
  evaluatedCount: number;
  /** How many sections are already submitted (env + future). */
  submittedSections: { environment: boolean; future: boolean };
}

export function SurveyIntro({
  campaign,
  onStart,
  totalExecutives,
  evaluatedCount,
  submittedSections,
}: SurveyIntroProps) {
  const hasProgress =
    submittedSections.environment ||
    submittedSections.future ||
    evaluatedCount > 0;

  const pills = [
    {
      label: "بيئة العمل",
      done: submittedSections.environment,
      hidden: !envSectionEnabled(campaign),
      progress: submittedSections.environment ? "مكتمل" : "بانتظارك",
    },
    {
      label: `تقييم القيادات (${evaluatedCount}/${totalExecutives || "—"})`,
      done:
        evaluatedCount > 0 &&
        totalExecutives > 0 &&
        evaluatedCount >= totalExecutives,
      hidden: totalExecutives === 0,
      progress:
        evaluatedCount > 0
          ? `${evaluatedCount} مُقيَّم`
          : "بانتظارك",
    },
    {
      label: "البيئة المستقبلية",
      done: submittedSections.future,
      hidden: !futureSectionEnabled(campaign),
      progress: submittedSections.future ? "مكتمل" : "بانتظارك",
    },
  ].filter((p) => !p.hidden);

  return (
    <Card className="mx-auto max-w-3xl overflow-hidden">
      {/* Hero header band */}
      <div className="relative bg-gradient-to-l from-primary/95 via-primary to-primary/90 text-primary-foreground">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_top_left,white,transparent_60%)]" />
        <CardHeader className="relative gap-2 pb-4">
          <div className="flex items-center gap-2 text-xs text-primary-foreground/80">
            <FileText className="h-3.5 w-3.5" />
            استبيان الموظفين المجهول
          </div>
          <CardTitle className="text-2xl sm:text-3xl font-bold leading-tight text-primary-foreground">
            {campaign.titleAr}
          </CardTitle>
          {campaign.descriptionAr ? (
            <CardDescription className="text-sm sm:text-base leading-relaxed text-primary-foreground/85">
              {campaign.descriptionAr}
            </CardDescription>
          ) : null}
        </CardHeader>
      </div>

      <CardContent className="space-y-5 pt-6">
        {campaign.instructionsAr ? (
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              تعليمات
            </p>
            <p className="text-sm leading-loose whitespace-pre-line text-foreground/90">
              {campaign.instructionsAr}
            </p>
          </div>
        ) : null}

        <p className="text-sm leading-loose text-foreground/90">
          {INTRO_COPY}
        </p>

        <Alert className="border-amber-300/70 bg-amber-50/70 dark:bg-amber-950/20">
          <ShieldCheck className="h-4 w-4 text-amber-700 dark:text-amber-300" />
          <AlertTitle className="text-amber-900 dark:text-amber-200">
            إشعار الخصوصية
          </AlertTitle>
          <AlertDescription>
            <p className="leading-relaxed text-amber-900/90 dark:text-amber-100/90">
              {campaign.privacyNoticeAr}
            </p>
          </AlertDescription>
        </Alert>

        {/* Summary pills — equal-height cards with status icons */}
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${pills.length}, minmax(0, 1fr))` }}
        >
          {pills.map((p) => (
            <SummaryPill key={p.label} label={p.label} done={p.done} progress={p.progress} />
          ))}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            {hasProgress
              ? "لديك تقدّم محفوظ في هذه الحملة — يمكنك استئناف المشاركة من حيث توقفت."
              : "ستستغرق المشاركة حوالي 10 دقائق. لا يمكن إرسال مشاركة أخرى بعد الإرسال."}
          </p>
          <Button
            size="lg"
            onClick={onStart}
            className="min-h-[48px] gap-2 shadow-md hover:shadow-lg transition-shadow shrink-0"
          >
            <PlayCircle className="h-5 w-5" />
            {hasProgress ? "استئناف الاستبيان" : "ابدأ الاستبيان"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryPill({
  label,
  done,
  progress,
}: {
  label: string;
  done: boolean;
  progress: string;
}) {
  return (
    <div
      className={
        "flex flex-col items-center justify-center rounded-lg border px-3 py-3 text-center transition-colors min-h-[80px] " +
        (done
          ? "border-emerald-300/60 bg-emerald-50/60 dark:bg-emerald-950/20"
          : "border-border bg-card")
      }
    >
      <div className="mb-1.5">
        {done ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <Circle className="h-5 w-5 text-muted-foreground/50" />
        )}
      </div>
      <span className="text-xs text-muted-foreground leading-tight">{label}</span>
      <span
        className={
          "text-xs font-semibold mt-1 " +
          (done
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-foreground/80")
        }
      >
        {progress}
      </span>
    </div>
  );
}
