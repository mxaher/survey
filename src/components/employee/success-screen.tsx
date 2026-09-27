"use client";

/**
 * Success screen (Task 3-a, spec §8.1 step 11).
 *
 * Final "تم تسجيل مشاركتك بنجاح" page shown after the user clicks the
 * step-4 submit button. No identity info, no `responseGroupId`, no internal
 * tokens — strictly a thank-you + "what happens next" copy. Provides a
 * button to return to the home / employee view.
 *
 * The component receives the campaign title so the thank-you copy can name
 * the survey the user just submitted (no other data is needed).
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Home, ShieldCheck } from "lucide-react";
import { MESSAGES, PRIVACY_NOTICE } from "@/lib/messages";

interface SuccessScreenProps {
  campaignTitle: string;
  onReturnHome: () => void;
}

export function SuccessScreen({
  campaignTitle,
  onReturnHome,
}: SuccessScreenProps) {
  return (
    <div className="mx-auto max-w-2xl">
      <Card className="text-center">
        <CardHeader className="items-center gap-3 pb-3">
          <div className="mx-auto h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-950 grid place-items-center">
            <CheckCircle2 className="h-9 w-9 text-emerald-600 dark:text-emerald-400" />
          </div>
          <CardTitle className="text-2xl sm:text-3xl font-bold">
            تم تسجيل مشاركتك بنجاح
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {campaignTitle}
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <p className="text-sm sm:text-base leading-relaxed text-foreground/90">
            {MESSAGES.submissionSuccess}
          </p>
          <div className="rounded-md border border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/15 p-3 flex items-start gap-2 text-end">
            <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
            <p className="text-xs leading-relaxed text-amber-900 dark:text-amber-200">
              {PRIVACY_NOTICE}
            </p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            تُعرض نتائج الاستبيان بصورة إجمالية فقط لأغراض التحسين المؤسسي.
            لن يتمكن أحد من ربط إجاباتك بهويتك.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
            <Button
              variant="default"
              size="lg"
              onClick={onReturnHome}
              className="min-h-[44px] gap-2"
            >
              <Home className="h-5 w-5" />
              العودة للصفحة الرئيسية
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
