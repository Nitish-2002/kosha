import { DbScriptStatus } from './db-script-state.entity';

// Why a script ends up in the state it does after a DB refresh.
export type RefreshRule =
  | 'not_applicable' // the restored environment doesn't need this script
  | 'rerun_after_restore' // e.g. anonymisation: always runs again
  | 'in_source' // the dump already contains it
  | 'not_in_source'; // the dump doesn't, so it has to be run

export interface RefreshOutcome {
  status: DbScriptStatus;
  rule: RefreshRule;
  // Carried over from the source's state when the dump already has it.
  appliedBy: string | null;
  appliedAt: Date | null;
}

type StateLike = {
  status: DbScriptStatus;
  appliedBy: string | null;
  appliedAt: Date | null;
};

// PRD Feature 12 — "Environment restored from a dump": the restored
// environment takes the source's state, except that N/A stays N/A and
// re-run-after-restore scripts always go back to pending. A missing state
// row means pending.
export function refreshOutcome(
  rerunAfterRestore: boolean,
  targetState: StateLike | undefined,
  sourceState: StateLike | undefined,
): RefreshOutcome {
  const pending = { appliedBy: null, appliedAt: null };
  if (targetState?.status === 'not_applicable') {
    return { status: 'not_applicable', rule: 'not_applicable', ...pending };
  }
  if (rerunAfterRestore) {
    return { status: 'pending', rule: 'rerun_after_restore', ...pending };
  }
  if (sourceState?.status === 'applied') {
    return {
      status: 'applied',
      rule: 'in_source',
      appliedBy: sourceState.appliedBy,
      appliedAt: sourceState.appliedAt,
    };
  }
  return { status: 'pending', rule: 'not_in_source', ...pending };
}
