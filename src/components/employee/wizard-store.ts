/**
 * Client-side wizard state store (Task 3-a).
 *
 * Stores ONLY in-progress answer state — what the user has selected so far in
 * steps 1 and 3 (and which executive is selected in step 2). The actual
 * answer rows are persisted server-side via the three
 * `/api/employee/{environment,future,evaluations}/submit` endpoints; this
 * store is NEVER POSTed anywhere.
 *
 * Persisted to `sessionStorage` (NOT `localStorage`) so the answers survive
 * a page refresh within the same browser tab but are dropped when the tab
 * closes — a privacy-conscious default per the worklog's "draft / resume"
 * decision (no server-side draft storage that would re-couple identity to
 * answer content).
 *
 * The current `step` is intentionally NOT persisted — the wizard derives the
 * starting step from `participation-status` on every mount so the wizard
 * survives a refresh even if the user clears sessionStorage.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface WizardState {
  /** Whether the user has clicked "ابدأ الاستبيان" on the intro card. */
  started: boolean;
  /** Whether the user has clicked the final submit on step 4 → success screen. */
  finished: boolean;
  /** In-progress answers for environment (single-select): snapshotId → value. */
  envAnswers: Record<string, string>;
  /** In-progress answers for future (multi-select): snapshotId → value[]. */
  futureAnswers: Record<string, string[]>;
  /** The executive currently selected in step 2 (for the dropdown). */
  currentExecutiveId: string | null;
  /** Whether the user has checked the final confirmation checkbox (step 4). */
  confirmedFinal: boolean;

  // mutations
  setStarted: (v: boolean) => void;
  setFinished: (v: boolean) => void;
  setEnvAnswer: (snapshotId: string, value: string) => void;
  setFutureAnswer: (snapshotId: string, values: string[]) => void;
  setCurrentExecutive: (id: string | null) => void;
  setConfirmedFinal: (v: boolean) => void;
  /** Hard-reset the in-progress answers (called when entering the success screen). */
  reset: () => void;
}

export const useWizardStore = create<WizardState>()(
  persist(
    (set) => ({
      started: false,
      finished: false,
      envAnswers: {},
      futureAnswers: {},
      currentExecutiveId: null,
      confirmedFinal: false,
      setStarted: (v) => set({ started: v }),
      setFinished: (v) => set({ finished: v }),
      setEnvAnswer: (snapshotId, value) =>
        set((s) => ({
          envAnswers: { ...s.envAnswers, [snapshotId]: value },
        })),
      setFutureAnswer: (snapshotId, values) =>
        set((s) => ({
          futureAnswers: { ...s.futureAnswers, [snapshotId]: values },
        })),
      setCurrentExecutive: (id) => set({ currentExecutiveId: id }),
      setConfirmedFinal: (v) => set({ confirmedFinal: v }),
      reset: () =>
        set({
          started: false,
          finished: false,
          envAnswers: {},
          futureAnswers: {},
          currentExecutiveId: null,
          confirmedFinal: false,
        }),
    }),
    {
      // sessionStorage = clears on tab close (privacy). Survives refresh.
      name: "almrshd-employee-wizard",
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? (undefined as unknown as Storage)
          : window.sessionStorage
      ),
      partialize: (s) => ({
        // Persist only the in-progress answer state. `started`, `finished`,
        // `confirmedFinal` are ephemeral — the wizard re-derives them from
        // server state on every mount so a refresh can't "fake" success.
        envAnswers: s.envAnswers,
        futureAnswers: s.futureAnswers,
        currentExecutiveId: s.currentExecutiveId,
      }),
    }
  )
);
