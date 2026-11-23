import { schema } from '@jobbank/db';
import { eq } from 'drizzle-orm';
import { NotFoundError } from '@/domains/shared/errors';
import { defineMachine } from '@/domains/shared/state-machine';
import type { Transaction } from '@/lib/db';
import type { ApplicationStatus } from './index';

export type ApplicationEvent =
  | 'SCHEDULE_INTERVIEW'
  | 'RESCHEDULE_INTERVIEW'
  | 'POSTPONE_INTERVIEW'
  | 'CANCEL_INTERVIEW'
  | 'RECORD_INTERVIEW_PASS'
  | 'RECORD_INTERVIEW_FAIL'
  | 'REFER'
  | 'SCHEDULE_EMPLOYER_INTERVIEW'
  | 'RESCHEDULE_EMPLOYER_INTERVIEW'
  | 'POSTPONE_EMPLOYER_INTERVIEW'
  | 'CANCEL_EMPLOYER_INTERVIEW'
  | 'EMPLOYER_DECIDE_HOLD'
  | 'EMPLOYER_DECIDE_ACCEPT'
  | 'EMPLOYER_DECIDE_REJECT'
  | 'APPLICANT_REFUSE'
  | 'APPLICANT_ACCEPT'
  | 'OFFER_DECLINED_AFTER_HIRE';

const INTERVIEW_STATES: readonly ApplicationStatus[] = [
  'INTERVIEW_SCHEDULED',
  'INTERVIEW_POSTPONED',
  'INTERVIEW_CANCELLED',
];

const EMPLOYER_INTERVIEW_STATES: readonly ApplicationStatus[] = [
  'EMPLOYER_INTERVIEW_SCHEDULED',
  'EMPLOYER_INTERVIEW_POSTPONED',
  'EMPLOYER_INTERVIEW_CANCELLED',
];

const DECIDABLE_STATES: readonly ApplicationStatus[] = [
  'FORWARDED',
  ...EMPLOYER_INTERVIEW_STATES,
  'ON_HOLD',
];

/**
 * Placement state machine. Until now every transition was an ad-hoc status
 * allowlist (or none at all) checked outside the transaction, so a decision
 * could resurrect a closed application and two concurrent writers could
 * both pass and both notify. The machine is the single source of truth for
 * which moves are legal; commands fire it on a row locked FOR UPDATE
 * inside the transaction (see lockAndTransitionApplication). Role and
 * permission gating stays in the command functions, as before.
 */
export const applicationMachine = defineMachine<
  ApplicationStatus,
  ApplicationEvent,
  Record<never, never>
>({
  name: 'application',
  states: schema.APPLICATION_STATUSES,
  // H19 (2026-11-08): HIRED is no longer terminal — a match-HIRED
  // application whose applicant declines the match offer mirrors back to
  // APPLICANT_REFUSED (OFFER_DECLINED_AFTER_HIRE), because placement owns
  // the offer truth and the match row is only a mirror. The only way out of
  // HIRED is that decline; nothing else resurrects or re-decides a hire.
  // INTERVIEW_FAILED is terminal for the interview stage: a failed (or
  // no-show) interview cannot be rescheduled or referred. INTERVIEW_PASSED
  // is NOT terminal — it is the only state an interviewer-only actor may
  // refer from (see REFER below and the guard in referApplicantToEmployer).
  terminal: ['REJECTED', 'EMPLOYER_REJECTED', 'APPLICANT_REFUSED', 'INTERVIEW_FAILED'],
  transitions: [
    {
      from: ['SHORTLISTED', ...INTERVIEW_STATES],
      event: 'SCHEDULE_INTERVIEW',
      to: 'INTERVIEW_SCHEDULED',
    },
    { from: INTERVIEW_STATES, event: 'RESCHEDULE_INTERVIEW', to: 'INTERVIEW_SCHEDULED' },
    { from: INTERVIEW_STATES, event: 'POSTPONE_INTERVIEW', to: 'INTERVIEW_POSTPONED' },
    { from: INTERVIEW_STATES, event: 'CANCEL_INTERVIEW', to: 'INTERVIEW_CANCELLED' },
    {
      // 0052 — outcome is recorded only from a scheduled (or postponed)
      // interview, never from SHORTLISTED or a cancelled one.
      from: ['INTERVIEW_SCHEDULED', 'INTERVIEW_POSTPONED'],
      event: 'RECORD_INTERVIEW_PASS',
      to: 'INTERVIEW_PASSED',
    },
    {
      from: ['INTERVIEW_SCHEDULED', 'INTERVIEW_POSTPONED'],
      event: 'RECORD_INTERVIEW_FAIL',
      to: 'INTERVIEW_FAILED',
    },
    {
      from: ['SHORTLISTED', 'INTERVIEW_SCHEDULED', 'INTERVIEW_POSTPONED', 'INTERVIEW_PASSED'],
      event: 'REFER',
      to: 'FORWARDED',
    },
    {
      from: ['FORWARDED', 'EMPLOYER_INTERVIEW_POSTPONED', 'EMPLOYER_INTERVIEW_CANCELLED'],
      event: 'SCHEDULE_EMPLOYER_INTERVIEW',
      to: 'EMPLOYER_INTERVIEW_SCHEDULED',
    },
    {
      from: EMPLOYER_INTERVIEW_STATES,
      event: 'RESCHEDULE_EMPLOYER_INTERVIEW',
      to: 'EMPLOYER_INTERVIEW_SCHEDULED',
    },
    {
      from: EMPLOYER_INTERVIEW_STATES,
      event: 'POSTPONE_EMPLOYER_INTERVIEW',
      to: 'EMPLOYER_INTERVIEW_POSTPONED',
    },
    {
      from: EMPLOYER_INTERVIEW_STATES,
      event: 'CANCEL_EMPLOYER_INTERVIEW',
      to: 'EMPLOYER_INTERVIEW_CANCELLED',
    },
    { from: DECIDABLE_STATES, event: 'EMPLOYER_DECIDE_HOLD', to: 'ON_HOLD' },
    { from: DECIDABLE_STATES, event: 'EMPLOYER_DECIDE_ACCEPT', to: 'OFFER_EXTENDED' },
    { from: DECIDABLE_STATES, event: 'EMPLOYER_DECIDE_REJECT', to: 'EMPLOYER_REJECTED' },
    { from: ['OFFER_EXTENDED'], event: 'APPLICANT_REFUSE', to: 'APPLICANT_REFUSED' },
    { from: ['OFFER_EXTENDED'], event: 'APPLICANT_ACCEPT', to: 'HIRED' },
    // H19/C3: the applicant declined a match offer after the match-HIRED
    // decision had already hired them here (syncMatchHire). Placement owns
    // the offer, so the decline mirrors back onto the application instead
    // of leaving it HIRED while the match says declined.
    { from: ['HIRED'], event: 'OFFER_DECLINED_AFTER_HIRE', to: 'APPLICANT_REFUSED' },
  ],
});

/**
 * Re-load an application under a row lock and fire a machine event on it.
 * Call inside runCommand, before the update: the lock serialises concurrent
 * writers, and the in-transaction check means a stale read outside the
 * transaction can no longer push a closed application forward.
 */
export async function lockAndTransitionApplication(
  tx: Transaction,
  applicationId: string,
  event: ApplicationEvent,
): Promise<{ row: typeof schema.applications.$inferSelect; to: ApplicationStatus }> {
  const [row] = await tx
    .select()
    .from(schema.applications)
    .where(eq(schema.applications.id, applicationId))
    .for('update');
  if (!row) throw new NotFoundError('Application', applicationId);
  const to = applicationMachine.transition(row.status, event, {}, []);
  return { row, to };
}
