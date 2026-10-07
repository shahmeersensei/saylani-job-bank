import {
  COMPANY_STATUSES,
  type CompanyStatus,
  type Role,
  type VerificationEvent,
} from '@jobbank/shared';
import { defineMachine } from '@/domains/shared/state-machine';

export interface CompanyMachineContext {
  /** What still blocks (re)submission, in the employer's words. */
  submissionMissing: readonly string[];
  /** Required documents not yet accepted by the verifier (labels). */
  documentsNotAccepted: readonly string[];
}

export const READY: CompanyMachineContext = { submissionMissing: [], documentsNotAccepted: [] };

const submissionGuard = ({ submissionMissing }: CompanyMachineContext) =>
  submissionMissing.length === 0 || `Add ${submissionMissing.join(', ')} first`;

/**
 * Company verification (PRD §6.1, plan M7):
 * DRAFT → SUBMITTED → UNDER_VERIFICATION → (INFO_REQUESTED ⇄ RESUBMITTED) → VERIFIED | REJECTED.
 * A rejected company may correct its details and submit a new round (owner decision 10).
 * VERIFIED ⇄ SUSPENDED by Branch Admin (blacklist-driven suspension arrives in M14).
 * The verifier-only rules that need data (assigned verifier, conflict of interest, branch
 * scope) are checked in the service before firing an event.
 */
export const companyMachine = defineMachine<
  CompanyStatus,
  VerificationEvent,
  CompanyMachineContext,
  Role
>({
  name: 'company',
  states: COMPANY_STATUSES,
  transitions: [
    {
      from: ['DRAFT', 'REJECTED'],
      event: 'SUBMIT',
      to: 'SUBMITTED',
      actors: ['EMPLOYER'],
      guard: submissionGuard,
    },
    { from: 'SUBMITTED', event: 'CLAIM', to: 'UNDER_VERIFICATION', actors: ['VERIFIER'] },
    {
      from: ['UNDER_VERIFICATION', 'RESUBMITTED'],
      event: 'RELEASE',
      to: 'SUBMITTED',
      actors: ['VERIFIER'],
    },
    {
      from: ['UNDER_VERIFICATION', 'RESUBMITTED'],
      event: 'DECLARE_CONFLICT',
      to: 'SUBMITTED',
      actors: ['VERIFIER'],
    },
    // Super Admin (re)assigns; the status only changes when nobody had picked it up yet.
    { from: 'SUBMITTED', event: 'ASSIGN', to: 'UNDER_VERIFICATION', actors: ['SUPER_ADMIN'] },
    {
      from: 'UNDER_VERIFICATION',
      event: 'ASSIGN',
      to: 'UNDER_VERIFICATION',
      actors: ['SUPER_ADMIN'],
    },
    { from: 'RESUBMITTED', event: 'ASSIGN', to: 'RESUBMITTED', actors: ['SUPER_ADMIN'] },
    { from: 'INFO_REQUESTED', event: 'ASSIGN', to: 'INFO_REQUESTED', actors: ['SUPER_ADMIN'] },
    {
      from: ['UNDER_VERIFICATION', 'RESUBMITTED'],
      event: 'REQUEST_INFO',
      to: 'INFO_REQUESTED',
      actors: ['VERIFIER'],
    },
    {
      from: 'INFO_REQUESTED',
      event: 'RESUBMIT',
      to: 'RESUBMITTED',
      actors: ['EMPLOYER'],
      guard: submissionGuard,
    },
    {
      from: ['UNDER_VERIFICATION', 'RESUBMITTED'],
      event: 'VERIFY',
      to: 'VERIFIED',
      actors: ['VERIFIER'],
      guard: ({ documentsNotAccepted }) =>
        documentsNotAccepted.length === 0 ||
        `Accept every required document first (${documentsNotAccepted.join(', ')})`,
    },
    {
      from: ['UNDER_VERIFICATION', 'RESUBMITTED', 'INFO_REQUESTED'],
      event: 'REJECT',
      to: 'REJECTED',
      actors: ['VERIFIER'],
    },
    { from: 'VERIFIED', event: 'SUSPEND', to: 'SUSPENDED', actors: ['BRANCH_ADMIN'] },
    { from: 'SUSPENDED', event: 'REINSTATE', to: 'VERIFIED', actors: ['BRANCH_ADMIN'] },
  ],
});
