"use client";

/**
 * 4-step employee survey wizard (Task 3-a, spec §8.2).
 *
 * Steps:
 *   1) بيئة العمل — environment question snapshots (single-select scale)
 *   2) تقييم القيادات — pick an executive → leadership snapshots (5(+1) scale)
 *   3) البيئة المستقبلية — future snapshots (single_choice RadioGroup /
 *      multi_choice Checkbox with maxSelections)
 *   4) المراجعة والإرسال — completion summary + confirm checkbox → success
 *
 * Server-state queries:
 *   - participation-status: tells us which sections are already submitted
 *     (drives step skipping + the "تم تقديم … مسبقًا" banners).
 *   - executives: list of available executives + already-evaluated IDs.
 *   - executive questions: leadership snapshots for the selected exec.
 *
 * Mutations:
 *   - submitEnvironment, submitFuture, submitEvaluation — each refetches
 *     participation-status + executives on success so the wizard stays in
 *     sync with the server's view of the employee's progress.
 *
 * In-progress answer state lives in `useWizardStore` (Zustand, persisted to
 * sessionStorage) — see `wizard-store.ts`. Each executive eval uses local
 * React state (transient; resets when the user picks a different exec).
 *
 * Resilience: on mount we derive the starting step from participation-status,
 * so a refresh after submitting environment restarts the user at step 2
 * automatically (the wizard survives a refresh without needing client state
 * for the step itself).
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  ArrowLeft,
  Send,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ChevronLeft,
  ShieldCheck,
  Lock,
  Keyboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { MESSAGES } from "@/lib/messages";
import { envSectionEnabled, futureSectionEnabled } from "@/lib/survey-sections";
import { QuestionCard } from "./question-card";
import { ExecutivePicker } from "./executive-picker";
import { useWizardStore } from "./wizard-store";
import { fetchEmployeeApi, ApiError } from "./api";
import type {
  ActiveCampaign,
  ExecutivesResponse,
  ParticipationStatus,
  ExecutiveQuestionsResponse,
} from "./types";

const STEPS = [
  { n: 1, key: "environment", labelAr: "بيئة العمل العامة" },
  { n: 2, key: "leadership", labelAr: "تقييم المسؤول" },
  { n: 3, key: "future", labelAr: "أولويات التحسين المستقبلية" },
  { n: 4, key: "review", labelAr: "المراجعة والإرسال" },
] as const;

interface SurveyWizardProps {
  campaign: ActiveCampaign;
  /** Called when the user clicks the final submit on step 4. */
  onFinish: () => void;
  /** Called when the user explicitly aborts the wizard (cancel). */
  onCancel: () => void;
}

export function SurveyWizard({ campaign, onFinish, onCancel }: SurveyWizardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ─── Server-state queries ─────────────────────────────────────────────
  const participationStatusQuery = useQuery<ParticipationStatus>({
    queryKey: ["employee-participation-status", campaign.id],
    queryFn: () =>
      fetchEmployeeApi<ParticipationStatus>(
        `/api/employee/participation-status?campaignId=${encodeURIComponent(campaign.id)}`
      ),
    enabled: !!campaign.id,
    retry: false,
  });

  const executivesQuery = useQuery<ExecutivesResponse>({
    queryKey: ["employee-executives", campaign.id],
    queryFn: () =>
      fetchEmployeeApi<ExecutivesResponse>(
        `/api/employee/executives?campaignId=${encodeURIComponent(campaign.id)}`
      ),
    enabled: !!campaign.id,
    retry: false,
  });

  // ─── Wizard store (client-side in-progress answer state) ──────────────
  const envAnswers = useWizardStore((s) => s.envAnswers);
  const futureAnswers = useWizardStore((s) => s.futureAnswers);
  const currentExecutiveId = useWizardStore((s) => s.currentExecutiveId);
  const confirmedFinal = useWizardStore((s) => s.confirmedFinal);
  const setEnvAnswer = useWizardStore((s) => s.setEnvAnswer);
  const setFutureAnswer = useWizardStore((s) => s.setFutureAnswer);
  const setCurrentExecutive = useWizardStore((s) => s.setCurrentExecutive);
  const setConfirmedFinal = useWizardStore((s) => s.setConfirmedFinal);
  const resetWizard = useWizardStore((s) => s.reset);

  // ─── Local UI state ──────────────────────────────────────────────────
  const [step, setStep] = useState<number>(1);
  const [initialized, setInitialized] = useState(false);

  // ─── Visible steps ───────────────────────────────────────────────────
  // A section that is toggled off OR has no questions is never rendered:
  // the employee skips straight past it (see `src/lib/survey-sections.ts`).
  const visibleSteps = useMemo(
    () =>
      STEPS.filter((s) => {
        if (s.key === "environment") return envSectionEnabled(campaign);
        if (s.key === "future") return futureSectionEnabled(campaign);
        return true;
      }),
    [campaign]
  );
  const visibleIndex = (v: number) => visibleSteps.findIndex((s) => s.n === v);
  const clampToVisible = (v: number) => {
    if (visibleIndex(v) >= 0) return v;
    const next = visibleSteps.find((s) => s.n > v);
    return (next ?? visibleSteps[0] ?? { n: 1 }).n;
  };
  const goNext = () => {
    const i = visibleIndex(step);
    const next = i < 0 ? visibleSteps[0] : visibleSteps[i + 1];
    if (next) setStep(next.n);
  };
  const goBack = () => {
    const i = visibleIndex(step);
    if (i > 0) setStep(visibleSteps[i - 1].n);
  };

  // Local answer state for the current executive evaluation (transient —
  // reset whenever the user picks a different executive).
  const [executiveAnswers, setExecutiveAnswers] = useState<
    Record<string, string>
  >({});
  // Track the executive id the local answers belong to (so we can reset
  // when the user picks a different one).
  const [answersForExecId, setAnswersForExecId] = useState<string | null>(null);

  // ─── Derive starting step from server-side participation-status ───────
  // React-idiomatic render-phase state adjustment: compute the "floor" step
  // from server truth (so a refresh after submitting env lands the user at
  // step 2), then advance the local `step` only on first load (before the
  // user has moved manually). After initialization, the user's own next/back
  // clicks drive `step`; the derived floor only re-applies if the server's
  // truth changes (e.g., a tab-submitted section is reflected via refetch).
  const ps = participationStatusQuery.data;
  const derivedStep = useMemo(() => {
    if (!ps) return 1;
    let s = 1;
    const envDone =
      !envSectionEnabled(campaign) || ps.environmentSubmitted;
    if (envDone) {
      const evaluated = new Set(ps.evaluatedExecutiveIds);
      const totalAssigned = executivesQuery.data?.executives.length ?? 0;
      const allExecsDone =
        totalAssigned > 0 && evaluated.size >= totalAssigned;
      const singleEvalDone =
        !campaign.allowMultipleExecutiveEvaluations && evaluated.size >= 1;
      const step2Done = allExecsDone || singleEvalDone;
      if (step2Done) {
        const futureDone =
          !futureSectionEnabled(campaign) || ps.futureSubmitted;
        s = futureDone ? 4 : 3;
      } else {
        s = 2;
      }
    }
    return s;
  }, [ps, campaign, executivesQuery.data]);

  // Apply the derived step once on first load (initialized=false → true).
  // After that, only advance (never move backwards) if the server's truth
  // changes — e.g., user submits future from another tab.
  // A step that is not rendered (empty section) is never landed on.
  if (visibleIndex(step) === -1 && visibleSteps.length > 0) {
    setStep(visibleSteps[0].n);
  }
  if (ps && !initialized) {
    setInitialized(true);
    setStep(clampToVisible(derivedStep));
  } else if (ps && initialized && derivedStep > step) {
    // Server says we should be further along than we are — bump up.
    setStep(clampToVisible(derivedStep));
  }

  // ─── beforeunload warning (in-progress answers) ──────────────────────
  useEffect(() => {
    const hasInProgressAnswers =
      Object.keys(envAnswers).length > 0 ||
      Object.keys(futureAnswers).length > 0 ||
      Object.keys(executiveAnswers).length > 0;
    if (!hasInProgressAnswers) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue =
        "هل تريد المغادرة؟ ستفقد تقدمك غير المُرسل.";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [envAnswers, futureAnswers, executiveAnswers]);

  // ─── Refetch helpers (post-submit invalidation) ──────────────────────
  const invalidateAll = () => {
    queryClient.invalidateQueries({
      queryKey: ["employee-participation-status", campaign.id],
    });
    queryClient.invalidateQueries({
      queryKey: ["employee-executives", campaign.id],
    });
  };

  // ─── Mutations ───────────────────────────────────────────────────────
  const envMutation = useMutation({
    mutationFn: async () => {
      const answers = Object.entries(envAnswers).map(
        ([questionSnapshotId, selectedValue]) => ({
          questionSnapshotId,
          selectedValue,
        })
      );
      return fetchEmployeeApi<{ message: string }>(
        "/api/employee/environment/submit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaignId: campaign.id, answers }),
        }
      );
    },
    onSuccess: (data) => {
      toast({
        title: "تم بنجاح",
        description: data?.message ?? MESSAGES.submissionSuccess,
      });
      invalidateAll();
      goNext();
    },
    onError: (err: Error) => {
      const status = err instanceof ApiError ? err.status : 0;
      toast({
        variant: "destructive",
        title: "تعذّر الإرسال",
        description: err.message,
      });
      // 409 → already submitted; refetch so the banner shows.
      if (status === 409) {
        invalidateAll();
        goNext();
      }
    },
  });

  const futureMutation = useMutation({
    mutationFn: async () => {
      const answers = Object.entries(futureAnswers).map(
        ([questionSnapshotId, selectedValues]) => ({
          questionSnapshotId,
          selectedValues,
        })
      );
      return fetchEmployeeApi<{ message: string }>(
        "/api/employee/future/submit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaignId: campaign.id, answers }),
        }
      );
    },
    onSuccess: (data) => {
      toast({
        title: "تم بنجاح",
        description: data?.message ?? MESSAGES.submissionSuccess,
      });
      invalidateAll();
      goNext();
    },
    onError: (err: Error) => {
      const status = err instanceof ApiError ? err.status : 0;
      toast({
        variant: "destructive",
        title: "تعذّر الإرسال",
        description: err.message,
      });
      if (status === 409) {
        invalidateAll();
        goNext();
      }
    },
  });

  const evalMutation = useMutation({
    mutationFn: async ({
      executiveId,
      answers,
    }: {
      executiveId: string;
      answers: Record<string, string>;
    }) => {
      const payload = Object.entries(answers).map(
        ([questionSnapshotId, selectedValue]) => ({
          questionSnapshotId,
          selectedValue,
        })
      );
      return fetchEmployeeApi<{ message: string }>(
        "/api/employee/evaluations/submit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaignId: campaign.id,
            executiveId,
            answers: payload,
          }),
        }
      );
    },
    onSuccess: (data) => {
      toast({
        title: "تم بنجاح",
        description: data?.message ?? MESSAGES.submissionSuccess,
      });
      // Reset local exec answers + clear selected exec so the picker
      // refetches and the dropdown shows the remaining executives.
      setExecutiveAnswers({});
      setAnswersForExecId(null);
      setCurrentExecutive(null);
      invalidateAll();
    },
    onError: (err: Error) => {
      const status = err instanceof ApiError ? err.status : 0;
      toast({
        variant: "destructive",
        title: "تعذّر الإرسال",
        description: err.message,
      });
      if (status === 409) {
        // Already evaluated this exec → reset selection + refetch.
        setExecutiveAnswers({});
        setAnswersForExecId(null);
        setCurrentExecutive(null);
        invalidateAll();
      }
    },
  });

  // ─── Executive questions query (only when an exec is selected) ────────
  const execQuestionsQuery = useQuery<ExecutiveQuestionsResponse>({
    queryKey: ["employee-executive-questions", campaign.id, currentExecutiveId],
    queryFn: () =>
      fetchEmployeeApi<ExecutiveQuestionsResponse>(
        `/api/employee/executives/${encodeURIComponent(currentExecutiveId ?? "")}/questions`
      ),
    enabled: !!currentExecutiveId,
    retry: false,
  });

  // Reset local exec answers when the user picks a different exec. We do this
  // via a render-phase state adjustment (the React-idiomatic pattern for
  // "adjust state when a prop changes") so we avoid the
  // `setState-in-effect` lint warning and the cascading render that comes
  // with it.
  if (currentExecutiveId !== answersForExecId) {
    setExecutiveAnswers({});
    setAnswersForExecId(currentExecutiveId);
  }

  // ─── Derived state for navigation button enablement ──────────────────
  const executives = executivesQuery.data;
  const evaluatedIds = ps?.evaluatedExecutiveIds ?? [];
  const evaluatedSet = new Set(evaluatedIds);

  // Required-but-unanswered env questions.
  const envRequiredMissing = useMemo(() => {
    if (!envSectionEnabled(campaign)) return [];
    if (ps?.environmentSubmitted) return [];
    return campaign.environmentQuestions.filter(
      (q) => q.isRequired && !envAnswers[q.id]
    );
  }, [campaign, envAnswers, ps]);

  const envStepComplete =
    !envSectionEnabled(campaign) ||
    ps?.environmentSubmitted ||
    envRequiredMissing.length === 0;

  // Future: required single_choice needs ≥1, multi_choice needs ≥1.
  const futureRequiredMissing = useMemo(() => {
    if (!futureSectionEnabled(campaign)) return [];
    if (ps?.futureSubmitted) return [];
    return campaign.futureQuestions.filter((q) => {
      if (!q.isRequired) return false;
      const vals = futureAnswers[q.id] ?? [];
      return vals.length === 0;
    });
  }, [campaign, futureAnswers, ps]);

  const futureStepComplete =
    !futureSectionEnabled(campaign) ||
    ps?.futureSubmitted ||
    futureRequiredMissing.length === 0;

  // Executive step: picker + questions answered (only required when there
  // are executives to evaluate).
  const totalAssigned = executives?.executives.length ?? 0;
  const availableExecutives =
    executives?.executives.filter(
      (e) => !evaluatedSet.has(e.id)
    ) ?? [];
  const noExecsToEvaluate = totalAssigned === 0 || availableExecutives.length === 0;
  const singleEvalDone =
    !campaign.allowMultipleExecutiveEvaluations && evaluatedIds.length >= 1;

  // For the current executive eval form: are all required leadership
  // questions answered?
  const execQuestions = execQuestionsQuery.data?.questions ?? [];
  const execRequiredMissing = execQuestions.filter(
    (q) => q.isRequired && !executiveAnswers[q.id]
  );
  const execFormReady =
    !!currentExecutiveId &&
    !execQuestionsQuery.isLoading &&
    execQuestions.length > 0 &&
    execRequiredMissing.length === 0;

  const execStepReady =
    noExecsToEvaluate || singleEvalDone || evaluatedIds.length > 0;

  // ─── Step 4 "submit" gating ──────────────────────────────────────────
  const allDone = Boolean(
    (!envSectionEnabled(campaign) || ps?.environmentSubmitted) &&
      (!futureSectionEnabled(campaign) || ps?.futureSubmitted) &&
      (singleEvalDone ||
        noExecsToEvaluate ||
        (campaign.allowMultipleExecutiveEvaluations
          ? evaluatedIds.length >= (campaign.minExecutives ?? 1)
          : evaluatedIds.length >= 1))
  );
  const canFinish = allDone && confirmedFinal;

  // ─── Progress % for the Progress bar ────────────────────────────────
  const currentVisibleIndex = visibleIndex(step);
  const progressPct =
    ((currentVisibleIndex < 0 ? 0 : currentVisibleIndex) /
      Math.max(visibleSteps.length, 1)) *
    100;

  // ─── Handlers ────────────────────────────────────────────────────────
  const handleEnvSubmit = () => {
    if (envRequiredMissing.length > 0) {
      toast({
        variant: "destructive",
        title: "أسئلة مطلوبة",
        description: MESSAGES.incompleteAnswers,
      });
      return;
    }
    envMutation.mutate();
  };

  const handleFutureSubmit = () => {
    if (futureRequiredMissing.length > 0) {
      toast({
        variant: "destructive",
        title: "أسئلة مطلوبة",
        description: MESSAGES.incompleteAnswers,
      });
      return;
    }
    futureMutation.mutate();
  };

  const handleExecSubmit = () => {
    if (!currentExecutiveId) return;
    if (execRequiredMissing.length > 0) {
      toast({
        variant: "destructive",
        title: "أسئلة مطلوبة",
        description: MESSAGES.incompleteAnswers,
      });
      return;
    }
    evalMutation.mutate({
      executiveId: currentExecutiveId,
      answers: executiveAnswers,
    });
  };

  const handleFinalSubmit = () => {
    if (!allDone) {
      toast({
        variant: "destructive",
        title: "غير مكتمل",
        description: MESSAGES.incompleteAnswers,
      });
      return;
    }
    if (!confirmedFinal) {
      toast({
        variant: "destructive",
        title: "التأكيد مطلوب",
        description: "يرجى تأكيد الإقرار قبل الإرسال.",
      });
      return;
    }
    // No server call — all sections were already submitted in steps 1-3.
    // Just clear in-progress state and navigate to the success screen.
    resetWizard();
    onFinish();
  };

  // ─── Keyboard navigation (ArrowLeft = next, ArrowRight = back in RTL) ──
  // Only fires when the user is NOT focused in an input/textarea/select/radio
  // (so typing in those elements doesn't trigger navigation). We use the
  // document activeElement's tagName + role to check.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el) {
        const tag = el.tagName.toLowerCase();
        if (tag === "input" || tag === "select" || tag === "textarea") return;
        if (
          el.getAttribute("role") === "radio" ||
          el.getAttribute("type") === "radio" ||
          el.getAttribute("type") === "checkbox"
        )
          return;
      }
      if (e.key === "ArrowLeft") {
        // In RTL, ArrowLeft = forward.
        e.preventDefault();
        if (currentVisibleIndex > -1 && currentVisibleIndex < visibleSteps.length - 1) {
          if (step === 1) {
            if (ps?.environmentSubmitted || envStepComplete) {
              handleEnvSubmit();
            }
          } else if (step === 2) {
            if (!execStepReady && !singleEvalDone) return;
            goNext();
          } else if (step === 3) {
            if (ps?.futureSubmitted || futureStepComplete) {
              handleFutureSubmit();
            }
          }
        }
      } else if (e.key === "ArrowRight") {
        // In RTL, ArrowRight = back.
        e.preventDefault();
        if (currentVisibleIndex > 0) goBack();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    step,
    visibleSteps,
    currentVisibleIndex,
    ps,
    envStepComplete,
    execStepReady,
    singleEvalDone,
    futureStepComplete,
    // handleEnvSubmit + handleFutureSubmit are stable enough (they close
    // over the same state) — including them would cause re-subscribes on
    // every render. The dependency array above captures the gating state.
  ]);

  // ─── Loading / error UI helpers ──────────────────────────────────────
  if (participationStatusQuery.isLoading || executivesQuery.isLoading) {
    return <WizardSkeleton />;
  }
  if (participationStatusQuery.isError) {
    const err =
      participationStatusQuery.error instanceof ApiError
        ? participationStatusQuery.error
        : null;
    return (
      <WizardError
        message={
          err?.message ?? "تعذّر تحميل حالة المشاركة. حاول مرة أخرى."
        }
        status={err?.status}
        onRetry={() => participationStatusQuery.refetch()}
      />
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Progress indicator (spec §8.2) */}
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between gap-1 mb-3">
          {visibleSteps.map((s, i) => {
            const n = i + 1;
            const isCurrent = step === s.n;
            const isDone = step > s.n;
            const isUpcoming = !isCurrent && !isDone;
            return (
              <div
                key={s.key}
                className="flex items-center gap-2 flex-1 last:flex-none"
              >
                <div
                  className={
                    "flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold transition-all duration-200 " +
                    (isCurrent
                      ? "bg-primary text-primary-foreground shadow-sm ring-2 ring-primary/20 scale-105"
                      : isDone
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200 ring-1 ring-emerald-300/50"
                      : "bg-muted/60 text-muted-foreground/70 ring-1 ring-border")
                  }
                  aria-current={isCurrent ? "step" : undefined}
                >
                  <span
                    className={
                      "grid place-items-center h-5 w-5 rounded-full text-[10px] font-bold transition-colors " +
                      (isCurrent
                        ? "bg-background/30 text-primary-foreground"
                        : isDone
                        ? "bg-emerald-600 text-white dark:bg-emerald-500"
                        : "bg-background text-muted-foreground border border-border")
                    }
                  >
                    {isDone ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      n
                    )}
                  </span>
                  <span className="hidden sm:inline">{s.labelAr}</span>
                </div>
                {n < visibleSteps.length ? (
                  <div
                    className={
                      "h-0.5 flex-1 rounded-full transition-colors duration-300 " +
                      (isDone
                        ? "bg-emerald-400 dark:bg-emerald-600"
                        : "bg-border")
                    }
                  />
                ) : null}
              </div>
            );
          })}
        </div>
        <Progress value={progressPct} className="h-1.5 bg-muted" />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.2 }}
        >
          {step === 1 ? (
            <StepEnvironment
              campaign={campaign}
              envAnswers={envAnswers}
              onAnswer={setEnvAnswer}
              alreadySubmitted={!!ps?.environmentSubmitted}
              missingRequired={envRequiredMissing.length}
              onSubmit={handleEnvSubmit}
              onSkip={goNext}
              submitting={envMutation.isPending}
            />
          ) : null}

          {step === 2 ? (
            <StepExecutive
              campaign={campaign}
              executives={executives?.executives ?? []}
              evaluatedExecutiveIds={evaluatedIds}
              currentExecutiveId={currentExecutiveId}
              onSelect={setCurrentExecutive}
              questionsQuery={execQuestionsQuery}
              executiveAnswers={executiveAnswers}
              onAnswer={(qid, v) =>
                setExecutiveAnswers((prev) => ({ ...prev, [qid]: v }))
              }
              onSubmit={handleExecSubmit}
              submitting={evalMutation.isPending}
              missingRequired={execRequiredMissing.length}
              hasEvaluated={evaluatedIds.length > 0}
              singleEvalDone={singleEvalDone}
              noExecsToEvaluate={noExecsToEvaluate}
              onProceed={goNext}
            />
          ) : null}

          {step === 3 ? (
            <StepFuture
              campaign={campaign}
              futureAnswers={futureAnswers}
              onAnswer={setFutureAnswer}
              alreadySubmitted={!!ps?.futureSubmitted}
              missingRequired={futureRequiredMissing.length}
              onSubmit={handleFutureSubmit}
              onSkip={goNext}
              submitting={futureMutation.isPending}
            />
          ) : null}

          {step === 4 ? (
            <StepReview
              campaign={campaign}
              environmentSubmitted={!!ps?.environmentSubmitted}
              futureSubmitted={!!ps?.futureSubmitted}
              evaluatedExecutiveIds={evaluatedIds}
              executives={executives?.executives ?? []}
              confirmedFinal={confirmedFinal}
              onConfirm={setConfirmedFinal}
              onSubmit={handleFinalSubmit}
              onCancel={onCancel}
              allDone={allDone}
            />
          ) : null}
        </motion.div>
      </AnimatePresence>

      {/* Bottom navigation (steps before review) */}
      {currentVisibleIndex > -1 &&
      currentVisibleIndex < visibleSteps.length - 1 ? (
        <div className="flex items-center justify-between gap-3 mx-auto max-w-3xl pt-2">
          <Button
            variant="ghost"
            size="default"
            onClick={goBack}
            disabled={currentVisibleIndex === 0}
            className="gap-1.5 min-h-[44px]"
          >
            <ArrowRight className="h-4 w-4" />
            السابق
          </Button>
          {step === 1 ? (
            <Button
              onClick={handleEnvSubmit}
              disabled={
                !envStepComplete ||
                envMutation.isPending ||
                !!ps?.environmentSubmitted
              }
              className="gap-2 min-h-[44px]"
            >
              {envMutation.isPending ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {ps?.environmentSubmitted ? "تم الإرسال" : "إرسال ومتابعة"}
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : step === 2 ? (
            <Button
              onClick={goNext}
              disabled={!execStepReady && !singleEvalDone}
              className="gap-1.5 min-h-[44px]"
            >
              التالي
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : step === 3 ? (
            <Button
              onClick={handleFutureSubmit}
              disabled={
                !futureStepComplete ||
                futureMutation.isPending ||
                !!ps?.futureSubmitted
              }
              className="gap-2 min-h-[44px]"
            >
              {futureMutation.isPending ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {ps?.futureSubmitted ? "تم الإرسال" : "إرسال ومتابعة"}
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* Keyboard shortcuts hint — desktop only */}
      {step < 4 && (
        <div className="hidden md:flex items-center justify-center gap-4 mx-auto max-w-3xl pt-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Keyboard className="h-3.5 w-3.5" />
            اختصارات:
          </span>
          <span className="flex items-center gap-1">
            <kbd className="inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 font-mono text-[10px]">1-5</kbd>
            اختيار درجة
          </span>
          <span className="text-border">·</span>
          <span className="flex items-center gap-1">
            <kbd className="inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 font-mono text-[10px]">←</kbd>
            التالي
          </span>
          <span className="text-border">·</span>
          <span className="flex items-center gap-1">
            <kbd className="inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 font-mono text-[10px]">→</kbd>
            السابق
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Sub-step components (kept in this file for cohesion) ────────────────

function StepEnvironment({
  campaign,
  envAnswers,
  onAnswer,
  alreadySubmitted,
  missingRequired,
  onSubmit,
  onSkip,
  submitting,
}: {
  campaign: ActiveCampaign;
  envAnswers: Record<string, string>;
  onAnswer: (id: string, value: string) => void;
  alreadySubmitted: boolean;
  missingRequired: number;
  onSubmit: () => void;
  onSkip: () => void;
  submitting: boolean;
}) {
  if (!envSectionEnabled(campaign)) {
    return (
      <StepSkippedCard
        title="قسم بيئة العمل غير مُفعّل"
        body="لا تتضمن هذه الحملة قسم بيئة العمل. يمكنك الانتقال مباشرة إلى القسم التالي."
        onSkip={onSkip}
      />
    );
  }
  if (alreadySubmitted) {
    return (
      <StepSubmittedCard
        title="تم تقديم قسم بيئة العمل مسبقًا"
        body="لقد سجّلت إجاباتك لهذا القسم ضمن هذه الحملة. لا يمكن إرسال إجابات أخرى لقسم بيئة العمل."
        onSkip={onSkip}
      />
    );
  }
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader
        title="بيئة العمل العامة"
        description="يرجى تقييم بيئة العمل في المؤسسة بشكل عام بناءً على تجربتك المهنية."
        required={missingRequired}
      />
      {campaign.environmentQuestions.length === 0 ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>لا توجد أسئلة في هذا القسم</AlertTitle>
          <AlertDescription>
            لم تُضَف أي أسئلة لقسم بيئة العمل في هذه الحملة. يمكنك الانتقال
            إلى القسم التالي.
          </AlertDescription>
        </Alert>
      ) : (
        campaign.environmentQuestions.map((q, i) => (
          <QuestionCard
            key={q.id}
            question={q}
            index={i}
            value={envAnswers[q.id]}
            onValueChange={(v) => onAnswer(q.id, v)}
            disabled={submitting}
          />
        ))
      )}
    </div>
  );
}

function StepExecutive({
  campaign,
  executives,
  evaluatedExecutiveIds,
  currentExecutiveId,
  onSelect,
  questionsQuery,
  executiveAnswers,
  onAnswer,
  onSubmit,
  submitting,
  missingRequired,
  hasEvaluated,
  singleEvalDone,
  noExecsToEvaluate,
  onProceed,
}: {
  campaign: ActiveCampaign;
  executives: import("./types").ExecutiveRow[];
  evaluatedExecutiveIds: string[];
  currentExecutiveId: string | null;
  onSelect: (id: string | null) => void;
  questionsQuery: {
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    data?: ExecutiveQuestionsResponse;
    refetch: () => void;
  };
  executiveAnswers: Record<string, string>;
  onAnswer: (qid: string, v: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  missingRequired: number;
  hasEvaluated: boolean;
  singleEvalDone: boolean;
  noExecsToEvaluate: boolean;
  onProceed: () => void;
}) {
  if (singleEvalDone) {
    return (
      <StepSubmittedCard
        title="تم تقييم مسؤول واحد ضمن هذه الحملة"
        body="لا يُسمح بتقييم أكثر من مسؤول ضمن هذه الحملة. يمكنك الانتقال إلى القسم التالي."
        onSkip={onProceed}
      />
    );
  }
  if (noExecsToEvaluate && !hasEvaluated) {
    return (
      <StepSkippedCard
        title="لا يوجد مسؤولون مخصصون للتقييم"
        body="لم تُضِف هذه الحملة أي مسؤولين متاحين للتقييم بعد. يمكنك الانتقال إلى القسم التالي."
        onSkip={onProceed}
      />
    );
  }
  if (noExecsToEvaluate) {
    return (
      <StepSubmittedCard
        title="تم تقييم جميع المسؤولين المخصصين"
        body="لقد قيّمت جميع المسؤولين المخصصين لهذه الحملة. يمكنك الانتقال إلى القسم التالي."
        onSkip={onProceed}
      />
    );
  }
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader
        title="تقييم المسؤول"
        description="يرجى تقييم سلوك المسؤول الذي تختاره بناءً على تجربتك المهنية المباشرة معه."
        required={missingRequired}
      />

      <Card className="py-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">اختر مسؤولاً</CardTitle>
        </CardHeader>
        <CardContent>
          <ExecutivePicker
            executives={executives}
            evaluatedExecutiveIds={evaluatedExecutiveIds}
            currentExecutiveId={currentExecutiveId}
            onSelect={(id) => onSelect(id)}
            allowMultiple={campaign.allowMultipleExecutiveEvaluations}
          />
        </CardContent>
      </Card>

      {currentExecutiveId ? (
        <Card className="py-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {questionsQuery.data?.executive
                ? `${questionsQuery.data.executive.nameAr} — ${questionsQuery.data.executive.titleAr}`
                : "تحميل الأسئلة…"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {questionsQuery.isLoading ? (
              <QuestionSkeleton />
            ) : questionsQuery.isError ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>تعذّر تحميل أسئلة المسؤول</AlertTitle>
                <AlertDescription>
                  {(questionsQuery.error instanceof ApiError
                    ? questionsQuery.error.message
                    : null) ??
                    "تعذّر تحميل الأسئلة. حاول مرة أخرى."}
                </AlertDescription>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => questionsQuery.refetch()}
                  className="mt-2"
                >
                  إعادة المحاولة
                </Button>
              </Alert>
            ) : questionsQuery.data && questionsQuery.data.questions.length > 0 ? (
              <>
                {questionsQuery.data.questions.map((q, i) => (
                  <QuestionCard
                    key={q.id}
                    question={q}
                    index={i}
                    value={executiveAnswers[q.id]}
                    onValueChange={(v) => onAnswer(q.id, v)}
                    disabled={submitting}
                  />
                ))}
                <div className="flex items-center justify-end pt-2">
                  <Button
                    onClick={onSubmit}
                    disabled={submitting || missingRequired > 0}
                    className="gap-2 min-h-[44px]"
                  >
                    {submitting ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    إرسال تقييم المسؤول
                  </Button>
                </div>
              </>
            ) : (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>لا توجد أسئلة قيادية</AlertTitle>
                <AlertDescription>
                  لم تُضَف أي أسئلة قيادية مُجمّدة لهذه الحملة.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      ) : (
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>اختر مسؤولاً للبدء</AlertTitle>
          <AlertDescription>
            استخدم القائمة أعلاه لاختيار مسؤول لتقييمه. ستظهر أسئلة التقييم
            هنا تلقائياً.
          </AlertDescription>
        </Alert>
      )}

      {hasEvaluated ? (
        <Alert className="border-emerald-300/60 bg-emerald-50/60 dark:bg-emerald-950/15">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertTitle>تم تقييم {evaluatedExecutiveIds.length} مسؤول</AlertTitle>
          <AlertDescription>
            يمكنك متابعة تقييم مسؤول إضافي أو الانتقال إلى القسم التالي.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function StepFuture({
  campaign,
  futureAnswers,
  onAnswer,
  alreadySubmitted,
  missingRequired,
  onSubmit,
  onSkip,
  submitting,
}: {
  campaign: ActiveCampaign;
  futureAnswers: Record<string, string[]>;
  onAnswer: (id: string, values: string[]) => void;
  alreadySubmitted: boolean;
  missingRequired: number;
  onSubmit: () => void;
  onSkip: () => void;
  submitting: boolean;
}) {
  if (!futureSectionEnabled(campaign)) {
    return (
      <StepSkippedCard
        title="قسم البيئة المستقبلية غير مُفعّل"
        body="لا تتضمن هذه الحملة قسم البيئة المستقبلية. يمكنك الانتقال مباشرة إلى المراجعة والإرسال."
        onSkip={onSkip}
      />
    );
  }
  if (alreadySubmitted) {
    return (
      <StepSubmittedCard
        title="تم تقديم قسم البيئة المستقبلية مسبقًا"
        body="لقد سجّلت إجاباتك لهذا القسم ضمن هذه الحملة. لا يمكن إرسال إجابات أخرى لقسم البيئة المستقبلية."
        onSkip={onSkip}
      />
    );
  }
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader
        title="أولويات التحسين المستقبلية"
        description="يرجى تحديد الجوانب التي ترغب في تحسينها خلال الفترة القادمة."
        required={missingRequired}
      />
      {campaign.futureQuestions.length === 0 ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>لا توجد أسئلة في هذا القسم</AlertTitle>
          <AlertDescription>
            لم تُضَف أي أسئلة لقسم البيئة المستقبلية في هذه الحملة.
          </AlertDescription>
        </Alert>
      ) : (
        campaign.futureQuestions.map((q, i) => (
          <QuestionCard
            key={q.id}
            question={q}
            index={i}
            values={futureAnswers[q.id] ?? []}
            onValuesChange={(vals) => onAnswer(q.id, vals)}
            disabled={submitting}
          />
        ))
      )}
    </div>
  );
}

function StepReview({
  campaign,
  environmentSubmitted,
  futureSubmitted,
  evaluatedExecutiveIds,
  executives,
  confirmedFinal,
  onConfirm,
  onSubmit,
  onCancel,
  allDone,
}: {
  campaign: ActiveCampaign;
  environmentSubmitted: boolean;
  futureSubmitted: boolean;
  evaluatedExecutiveIds: string[];
  executives: import("./types").ExecutiveRow[];
  confirmedFinal: boolean;
  onConfirm: (v: boolean) => void;
  onSubmit: () => void;
  onCancel: () => void;
  allDone: boolean;
}) {
  const evaluatedExecutives = executives.filter((e) =>
    evaluatedExecutiveIds.includes(e.id)
  );
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader
        title="المراجعة والإرسال"
        description="راجع حالة مشاركتك قبل الإرسال النهائي."
        required={0}
      />

      <Card className="py-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">حالة الأقسام</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {envSectionEnabled(campaign) ? (
            <ReviewRow
              label="بيئة العمل"
              state={
                environmentSubmitted ? "done" : "pending"
              }
            />
          ) : null}
          <ReviewRow
            label={
              campaign.allowMultipleExecutiveEvaluations
                ? `تقييم القيادات (${evaluatedExecutives.length} مقيَّم)`
                : `تقييم قيادة واحدة (${evaluatedExecutives.length} مقيَّم)`
            }
            state={
              evaluatedExecutives.length > 0
                ? "done"
                : executives.length === 0
                ? "skipped"
                : "pending"
            }
          />
          {evaluatedExecutives.length > 0 ? (
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2">
                المقيَّمون:
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {evaluatedExecutives.map((e) => (
                  <li key={e.id}>
                    <Badge variant="secondary" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      {e.nameAr}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {futureSectionEnabled(campaign) ? (
            <ReviewRow
              label="البيئة المستقبلية"
              state={futureSubmitted ? "done" : "pending"}
            />
          ) : null}
        </CardContent>
      </Card>

      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>تنبيه نهائي</AlertTitle>
        <AlertDescription>
          <p className="leading-relaxed">{MESSAGES.submitFinalWarning}</p>
        </AlertDescription>
      </Alert>

      <Card className="py-4">
        <CardContent className="space-y-4">
          <Label
            htmlFor="confirm-final"
            className="flex items-start gap-3 cursor-pointer min-h-[44px] py-2"
          >
            <Checkbox
              id="confirm-final"
              checked={confirmedFinal}
              onCheckedChange={(c) => onConfirm(Boolean(c))}
              className="mt-0.5"
            />
            <span className="text-sm leading-relaxed">
              {MESSAGES.confirmCheckbox}
            </span>
          </Label>

          <p className="text-xs leading-relaxed text-muted-foreground">
            {MESSAGES.anonymityNotice}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
            <Button
              variant="ghost"
              size="default"
              onClick={onCancel}
              className="gap-1.5 min-h-[44px]"
            >
              <ChevronLeft className="h-4 w-4" />
              العودة للمراجعة
            </Button>
            <Button
              size="lg"
              onClick={onSubmit}
              disabled={!allDone || !confirmedFinal}
              className="gap-2 min-h-[44px]"
            >
              <Send className="h-5 w-5" />
              {MESSAGES.reviewSubmit}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tiny presentation helpers ───────────────────────────────────────────

function SectionHeader({
  title,
  description,
  required,
}: {
  title: string;
  description: string;
  required: number;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-lg sm:text-xl font-bold leading-tight">{title}</h2>
        <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
          {description}
        </p>
      </div>
      {required > 0 ? (
        <Badge variant="outline" className="text-[10px] font-normal shrink-0">
          {required} أسئلة مطلوبة
        </Badge>
      ) : null}
    </div>
  );
}

function ReviewRow({
  label,
  state,
}: {
  label: string;
  state: "done" | "pending" | "skipped";
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border last:border-b-0">
      <span className="text-sm font-medium">{label}</span>
      {state === "done" ? (
        <Badge variant="secondary" className="gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <CheckCircle2 className="h-3 w-3" />
          مكتمل
        </Badge>
      ) : state === "skipped" ? (
        <Badge variant="outline" className="gap-1">
          <Lock className="h-3 w-3" />
          غير مُفعّل
        </Badge>
      ) : (
        <Badge variant="outline" className="gap-1 text-amber-700 dark:text-amber-300">
          <AlertCircle className="h-3 w-3" />
          غير مكتمل
        </Badge>
      )}
    </div>
  );
}

function StepSubmittedCard({
  title,
  body,
  onSkip,
}: {
  title: string;
  body: string;
  onSkip: () => void;
}) {
  return (
    <Card className="mx-auto max-w-3xl">
      <CardHeader className="items-start gap-2">
        <div className="h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-950 grid place-items-center">
          <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <CardTitle className="text-xl">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
        <Button onClick={onSkip} className="gap-1.5 min-h-[44px]">
          المتابعة إلى القسم التالي
          <ArrowLeft className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

function StepSkippedCard({
  title,
  body,
  onSkip,
}: {
  title: string;
  body: string;
  onSkip: () => void;
}) {
  return (
    <Card className="mx-auto max-w-3xl">
      <CardHeader className="items-start gap-2">
        <div className="h-10 w-10 rounded-full bg-muted grid place-items-center">
          <Lock className="h-6 w-6 text-muted-foreground" />
        </div>
        <CardTitle className="text-xl">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
        <Button variant="outline" onClick={onSkip} className="gap-1.5 min-h-[44px]">
          المتابعة إلى القسم التالي
          <ArrowLeft className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

function WizardSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-2 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function QuestionSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function WizardError({
  message,
  status,
  onRetry,
}: {
  message: string;
  status?: number;
  onRetry: () => void;
}) {
  return (
    <Alert variant="destructive" className="mx-auto max-w-3xl">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>تعذّر تحميل الاستبيان</AlertTitle>
      <AlertDescription className="space-y-3">
        <p className="leading-relaxed">{message}</p>
        {status ? (
          <p className="text-xs text-muted-foreground">
            رمز الحالة: {status}
          </p>
        ) : null}
        <div>
          <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            إعادة المحاولة
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
