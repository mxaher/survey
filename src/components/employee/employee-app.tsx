"use client";

/**
 * Employee survey entry. Default view at `/?view=employee`.
 *
 * Orchestrates the entire employee UX:
 *   - Sticky top header (group logo + title + link "دخول الإدارة").
 *   - Optional dev-mode impersonation banner (401 prompt or active-identity chip).
 *   - Main content area: shows ONE of:
 *       1. loading skeleton (during initial fetch)
 *       2. no-active-campaign empty state
 *       3. survey intro card (before wizard starts)
 *       4. 4-step survey wizard (after the user clicks "ابدأ الاستبيان")
 *       5. success screen (after the user clicks the final submit on step 4)
 *   - Sticky bottom footer "© مجموعة المرشد".
 *
 * Server state:
 *   - `GET /api/employee/campaign` returns the active campaign + bundled
 *     environment + future question snapshots (Task 3-a extension) — single
 *     round-trip so the wizard can render steps 1 and 3 immediately.
 *   - On 401 → set `unauthorized` so the ImpersonationBanner shows the
 *     dev-mode prompt (in production this is where SSO would take over).
 *
 * The wizard itself (`SurveyWizard`) loads executives, participation-status,
 * and per-executive leadership questions via TanStack Query + the existing
 * employee endpoints. This component just owns the campaign fetch + the
 * top-level layout + the state transition between intro → wizard → success.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ClipboardList, LogIn, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_TITLE, MESSAGES } from "@/lib/messages";
import { ImpersonationBanner } from "./impersonation-banner";
import { SurveyIntro } from "./survey-intro";
import { SurveyWizard } from "./survey-wizard";
import { SuccessScreen } from "./success-screen";
import { useWizardStore } from "./wizard-store";
import { fetchEmployeeApi, ApiError } from "./api";
import type { ActiveCampaign } from "./types";

type Phase = "loading" | "error" | "no-campaign" | "intro" | "wizard" | "success";

interface PsShape {
  environmentSubmitted: boolean;
  futureSubmitted: boolean;
  evaluatedExecutiveIds: string[];
}

export function EmployeeApp() {
  // ─── Server-state: fetch the active campaign (with bundled snapshots). ──
  const campaignQuery = useQuery<ActiveCampaign | null>({
    queryKey: ["employee-campaign"],
    queryFn: () =>
      fetchEmployeeApi<ActiveCampaign | null>("/api/employee/campaign"),
    retry: false,
    staleTime: 30_000,
  });

  const unauthorized =
    campaignQuery.isError &&
    campaignQuery.error instanceof ApiError &&
    campaignQuery.error.status === 401;

  // ─── Wizard phase state (in-progress ephemeral UI state). ──────────────
  const started = useWizardStore((s) => s.started);
  const finished = useWizardStore((s) => s.finished);
  const setStarted = useWizardStore((s) => s.setStarted);
  const setFinished = useWizardStore((s) => s.setFinished);
  const resetWizard = useWizardStore((s) => s.reset);

  // Used by SurveyIntro to show a summary of progress before the wizard
  // starts. We pre-fetch participation-status + executives counts here so
  // the intro card can show "تم تقييم 2 من 5" + section-completion badges.
  // If it 401s, we just hide those pills (the wizard itself re-fetches
  // the same queries and handles the 401).
  const campaignId = campaignQuery.data?.id ?? null;

  const participationStatusQuery = useQuery<PsShape>({
    queryKey: ["employee-participation-status", campaignId],
    queryFn: () =>
      fetchEmployeeApi<PsShape>(
        campaignId
          ? `/api/employee/participation-status?campaignId=${encodeURIComponent(campaignId)}`
          : "/api/employee/participation-status?campaignId=_"
      ),
    enabled: !!campaignId && !unauthorized,
    retry: false,
    staleTime: 30_000,
  });

  const executivesQuery = useQuery<{ executives: { id: string }[] }>({
    queryKey: ["employee-executives", campaignId],
    queryFn: () =>
      fetchEmployeeApi<{ executives: { id: string }[] }>(
        campaignId
          ? `/api/employee/executives?campaignId=${encodeURIComponent(campaignId)}`
          : "/api/employee/executives?campaignId=_"
      ),
    enabled: !!campaignId && !unauthorized,
    retry: false,
    staleTime: 30_000,
  });

  const ps = participationStatusQuery.data ?? null;

  // If the user falls back to the intro after finishing (i.e., clicked
  // "العودة للصفحة الرئيسية" on the success screen), make sure the
  // participation-status refetch reflects the just-submitted state.
  useEffect(() => {
    if (finished) {
      participationStatusQuery.refetch();
      executivesQuery.refetch();
    }
  }, [finished, participationStatusQuery, executivesQuery]);

  // ─── Decide the current phase. ──────────────────────────────────────────
  let phase: Phase = "loading";
  if (campaignQuery.isLoading) {
    phase = "loading";
  } else if (unauthorized) {
    // No campaign loaded yet (and 401) → show impersonation prompt.
    phase = "loading";
  } else if (campaignQuery.isError) {
    // Non-401 failure (server error, network error) — never fall through to
    // the intro card with an undefined campaign.
    phase = "error";
  } else if (campaignQuery.data === null) {
    phase = "no-campaign";
  } else if (finished) {
    phase = "success";
  } else if (started) {
    phase = "wizard";
  } else {
    phase = "intro";
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-4xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold">
              الم
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">
                مجموعة المرشد
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {APP_TITLE}
              </p>
            </div>
          </div>
          <a
            href="/?view=admin"
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline flex items-center gap-1 min-h-[44px] px-2"
          >
            <LogIn className="h-3.5 w-3.5" />
            دخول الإدارة
          </a>
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-4xl w-full px-4 py-6 sm:py-10">
        <ImpersonationBanner unauthorized={unauthorized} />

        {phase === "loading" ? (
          <IntroSkeleton />
        ) : phase === "no-campaign" ? (
          <NoActiveCampaignCard />
        ) : phase === "error" ? (
          <LoadErrorCard
            message={
              campaignQuery.error instanceof ApiError
                ? campaignQuery.error.message
                : "تعذّر تحميل الاستبيان. يرجى المحاولة مرة أخرى."
            }
            onRetry={() => {
              campaignQuery.refetch();
            }}
          />
        ) : phase === "success" ? (
          <SuccessScreen
            campaignTitle={campaignQuery.data?.titleAr ?? ""}
            onReturnHome={() => {
              setFinished(false);
              setStarted(false);
              resetWizard();
              // Refetch the campaign so the wizard can re-evaluate the
              // employee's state.
              campaignQuery.refetch();
              participationStatusQuery.refetch();
              executivesQuery.refetch();
            }}
          />
        ) : phase === "wizard" ? (
          <SurveyWizard
            campaign={campaignQuery.data as ActiveCampaign}
            onFinish={() => setFinished(true)}
            onCancel={() => {
              setStarted(false);
            }}
          />
        ) : (
          <SurveyIntro
            campaign={campaignQuery.data as ActiveCampaign}
            totalExecutives={executivesQuery.data?.executives.length ?? 0}
            evaluatedCount={ps?.evaluatedExecutiveIds.length ?? 0}
            submittedSections={{
              environment: ps?.environmentSubmitted ?? false,
              future: ps?.futureSubmitted ?? false,
            }}
            onStart={() => setStarted(true)}
          />
        )}
      </main>

      <footer className="border-t border-border bg-card mt-auto">
        <div className="mx-auto max-w-4xl px-4 py-3 text-xs text-muted-foreground text-center">
          © مجموعة المرشد — منصة الاستبيان المجهول
        </div>
      </footer>
    </div>
  );
}

// ─── Tiny presentation helpers ───────────────────────────────────────────

function IntroSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-10 w-1/3" />
    </div>
  );
}

function NoActiveCampaignCard() {
  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardContent className="py-12 text-center space-y-4">
          <div className="mx-auto h-16 w-16 rounded-full bg-muted grid place-items-center">
            <ClipboardList className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold">
              {MESSAGES.noActiveCampaign}
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              لا توجد حالياً حملات استبيان مفتوحة للمشاركة. يرجى المراجعة
              لاحقاً، أو التواصل مع الإدارة إذا كنت تعتقد أن هذا خطأ.
            </p>
          </div>
          <Button asChild variant="outline" size="default" className="gap-2 min-h-[44px]">
            <a href="/?view=admin">
              <LogIn className="h-4 w-4" />
              دخول الإدارة
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function LoadErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardContent className="py-12 text-center space-y-4">
          <div className="mx-auto h-16 w-16 rounded-full bg-destructive/10 grid place-items-center">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold">
              تعذّر تحميل بيانات الاستبيان
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {message}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="default"
            className="gap-2 min-h-[44px]"
            onClick={onRetry}
          >
            <RefreshCw className="h-4 w-4" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

