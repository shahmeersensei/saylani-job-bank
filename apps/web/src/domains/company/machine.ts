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
 * Since 2026-11-14 verification belongs to the Branch Admin of the company's
 * branch — not the Verifier, who only registers companies. The Branch Admin
 * reviews a company straight from DRAFT (field-visit companies never leave
 * DRAFT before review) as well as from SUBMITTED / UNDER_VERIFICATION /
 * RESUBMITTED (employer-submitted companies). There is no claim step for
 * Branch Admin review; branch scope is enforced in the service.
 * The CLAIM / RELEASE / ASSIGN transitions below are legacy Verifier-queue
 * mechanics, kept for in-flight rounds; they are not part of the new flow.
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
      // Staff submit on behalf of a company they onboarded (verified & signed first);
      // employers submit their own company. Verifiers submit companies they
      // onboarded the same way (verifiers may verify companies they created
      // themselves — owner decision 2026-11-08; only the email/phone
      // contact-conflict check still bars a verifier). The submission guard
      // still applies.
      actors: ['EMPLOYER', 'STAFF', 'BRANCH_ADMIN', 'SUPER_ADMIN', 'VERIFIER'],
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
      from: ['DRAFT', 'SUBMITTED', 'UNDER_VERIFICATION', 'RESUBMITTED'],
      event: 'REQUEST_INFO',
      to: 'INFO_REQUESTED',
      actors: ['BRANCH_ADMIN'],
    },
    {
      from: 'INFO_REQUESTED',
      event: 'RESUBMIT',
      to: 'RESUBMITTED',
      // The employer sends their own company back; a field-visit onboarder
      // (staff, branch admin, super admin, or the verifier who onboarded
      // it) sends back a company they onboarded — the employer has no
      // account for those, and without this the company could never leave
      // INFO_REQUESTED. The submission guard still applies to both.
      actors: ['EMPLOYER', 'STAFF', 'BRANCH_ADMIN', 'SUPER_ADMIN', 'VERIFIER'],
      guard: submissionGuard,
    },
    {
      from: ['DRAFT', 'SUBMITTED', 'UNDER_VERIFICATION', 'RESUBMITTED'],
      event: 'VERIFY',
      to: 'VERIFIED',
      actors: ['BRANCH_ADMIN'],
      guard: ({ documentsNotAccepted, submissionMissing }) =>
        documentsNotAccepted.length === 0 && submissionMissing.length === 0
          ? true
          : documentsNotAccepted.length > 0
            ? `Accept every required document first (${documentsNotAccepted.join(', ')})`
            : `Complete the submission first (${submissionMissing.join(', ')})`,
    },
    {
      // M24: REJECT is not allowed from INFO_REQUESTED — the reviewer is
      // waiting for the employer's reply; they request info or wait, they
      // do not reject mid-wait. (VERIFY is blocked there for the same reason.)
      from: ['DRAFT', 'SUBMITTED', 'UNDER_VERIFICATION', 'RESUBMITTED'],
      event: 'REJECT',
      to: 'REJECTED',
      actors: ['BRANCH_ADMIN'],
    },
    // H20: Super Admin can suspend/reinstate too (company:suspend is on
    // SUPER_ADMIN permissions since round 1); previously BRANCH_ADMIN only.
    {
      from: 'VERIFIED',
      event: 'SUSPEND',
      to: 'SUSPENDED',
      actors: ['BRANCH_ADMIN', 'SUPER_ADMIN'],
    },
    {
      from: 'SUSPENDED',
      event: 'REINSTATE',
      to: 'VERIFIED',
      actors: ['BRANCH_ADMIN', 'SUPER_ADMIN'],
    },
  ],
});
