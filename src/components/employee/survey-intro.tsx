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
 * Card is plain shadcn Card; privacy notice is rendered inside an Alert for
 * visual emphasis (spec calls it out as the most important line).
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ShieldCheck, FileText, PlayCircle } from "lucide-react";
import { INTRO_COPY } from "@/lib/messages";
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

  return (
    <Card className="mx-auto max-w-3xl">
      <CardHeader className="gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileText className="h-3.5 w-3.5" />
          استبيان الموظفين المجهول
        </div>
        <CardTitle className="text-2xl sm:text-3xl font-bold leading-tight">
          {campaign.titleAr}
        </CardTitle>
        {campaign.descriptionAr ? (
          <CardDescription className="text-sm sm:text-base leading-relaxed text-muted-foreground">
            {campaign.descriptionAr}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-5">
        {campaign.instructionsAr ? (
          <div className="rounded-md border border-border bg-muted/20 p-4">
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">
              تعليمات
            </p>
            <p className="text-sm leading-relaxed whitespace-pre-line">
              {campaign.instructionsAr}
            </p>
          </div>
        ) : null}

        <p className="text-sm leading-relaxed text-foreground/90">
          {INTRO_COPY}
        </p>

        <Alert className="border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/15">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>إشعار الخصوصية</AlertTitle>
          <AlertDescription>
            <p className="leading-relaxed">{campaign.privacyNoticeAr}</p>
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-3 gap-3">
          <SummaryPill
            label="بيئة العمل"
            done={submittedSections.environment}
            hidden={!campaign.enableEnvironmentSurvey}
          />
          <SummaryPill
            label={`تقييم القيادات (${evaluatedCount}/${totalExecutives || "—"})`}
            done={evaluatedCount > 0 && totalExecutives > 0 && evaluatedCount >= totalExecutives}
            hidden={totalExecutives === 0}
          />
          <SummaryPill
            label="البيئة المستقبلية"
            done={submittedSections.future}
            hidden={!campaign.enableFutureSurvey}
          />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          {hasProgress ? (
            <p className="text-xs text-muted-foreground">
              لديك تقدّم محفوظ في هذه الحملة — يمكنك استئناف المشاركة من
              حيث توقفت.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              ستستغرق المشاركة حوالي 10 دقائق. لا يمكن إرسال مشاركة أخرى بعد
              الإرسال.
            </p>
          )}
          <Button
            size="lg"
            onClick={onStart}
            className="min-h-[44px] gap-2"
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
  hidden,
}: {
  label: string;
  done: boolean;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-border bg-card px-2 py-2 text-center">
      <span className="text-[11px] text-muted-foreground leading-tight">
        {label}
      </span>
      <span
        className={
          "text-[11px] font-medium mt-0.5 " +
          (done ? "text-emerald-600 dark:text-emerald-400" : "text-foreground/70")
        }
      >
        {done ? "مكتمل" : "بانتظارك"}
      </span>
    </div>
  );
}
