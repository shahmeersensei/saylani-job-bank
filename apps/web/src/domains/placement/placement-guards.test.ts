import { describe, expect, it } from 'vitest';
import { InvalidTransitionError, NotFoundError, ValidationError } from '@/domains/shared/errors';
import { makeActor } from '@/test/factories';
import {
  applicationMachine,
  assertFutureInterviewAt,
  isInterviewerOnlyReferrer,
  recordInterviewOutcomeSchema,
  referableStatusesFor,
  scheduleInterviewSchema,
  updateInterviewStatusSchema,
} from './index';
import { EMPLOYER_VISIBLE_STATUSES, assertEmployerCanView, refuseJobOfferSchema } from './employer';

// H11 — interviews must be in the future (5-minute grace for clock skew).
// Pure schema/helper checks; no DB needed.
describe('H11 future interview dates', () => {
  const past = new Date(Date.now() - 60 * 60_000).toISOString();
  const future = new Date(Date.now() + 60 * 60_000).toISOString();
  const justNow = new Date(Date.now() - 60_000).toISOString();

  it('staff schedule schema rejects a past interviewAt', () => {
    expect(scheduleInterviewSchema.safeParse({ interviewAt: past }).success).toBe(false);
    expect(scheduleInterviewSchema.safeParse({ interviewAt: future }).success).toBe(true);
  });

  it('staff update schema rejects a past interviewAt when one is supplied', () => {
    expect(
      updateInterviewStatusSchema.safeParse({ status: 'INTERVIEW_SCHEDULED', interviewAt: past })
        .success,
    ).toBe(false);
    expect(
      updateInterviewStatusSchema.safeParse({
        status: 'INTERVIEW_POSTPONED',
        interviewAt: future,
      }).success,
    ).toBe(true);
  });

  it('a date a minute ago passes (clock-skew grace)', () => {
    expect(scheduleInterviewSchema.safeParse({ interviewAt: justNow }).success).toBe(true);
  });

  it('assertFutureInterviewAt throws on the past and accepts the future', () => {
    try {
      assertFutureInterviewAt(past);
      expect.unreachable('past date should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).issues[0]?.message).toContain('in the future');
    }
    expect(() => assertFutureInterviewAt(future)).not.toThrow();
    expect(() => assertFutureInterviewAt(new Date(Date.now() + 10_000))).not.toThrow();
  });
});

// H18 — employer visibility guards (pure helpers).
describe('H18 employer visibility guards', () => {
  it('pre-referral states are invisible to employers', () => {
    for (const status of [
      'SHORTLISTED',
      'INTERVIEW_SCHEDULED',
      'INTERVIEW_POSTPONED',
      'INTERVIEW_CANCELLED',
      'REJECTED',
    ] as const) {
      expect(() => assertEmployerCanView(status, 'app-1')).toThrow(NotFoundError);
    }
    expect(EMPLOYER_VISIBLE_STATUSES).toContain('FORWARDED');
    expect(() => assertEmployerCanView('FORWARDED', 'app-1')).not.toThrow();
    expect(() => assertEmployerCanView('HIRED', 'app-1')).not.toThrow();
  });
});

// H19 — reschedule dates and refusal reason codes.
describe('H19 reschedule + refusal guards', () => {
  const future = new Date(Date.now() + 60 * 60_000).toISOString();

  it('rescheduling back to SCHEDULED requires a new interviewAt (staff)', () => {
    expect(updateInterviewStatusSchema.safeParse({ status: 'INTERVIEW_SCHEDULED' }).success).toBe(
      false,
    );
    expect(
      updateInterviewStatusSchema.safeParse({ status: 'INTERVIEW_SCHEDULED', interviewAt: future })
        .success,
    ).toBe(true);
    expect(updateInterviewStatusSchema.safeParse({ status: 'INTERVIEW_POSTPONED' }).success).toBe(
      true,
    );
  });

  it('refusing an offer needs a REFUSAL_REASON code, not free text', () => {
    expect(refuseJobOfferSchema.safeParse({ reasonCode: 'LOW_SALARY' }).success).toBe(true);
    expect(refuseJobOfferSchema.safeParse({ reason: 'Salary is too low' }).success).toBe(false);
    expect(refuseJobOfferSchema.safeParse({}).success).toBe(false);
  });
});

// 0052 — interview outcome recording (Option B). Pure schema + machine
// checks; no DB needed. The DB-backed refer guard is exercised by the
// same pure helpers below (referableStatusesFor) plus the integration test
// in staff-management.integration.test.ts — see the note there.
describe('0052 recordInterviewOutcomeSchema', () => {
  it('attended + passed needs no feedback', () => {
    expect(
      recordInterviewOutcomeSchema.safeParse({ attendance: 'ATTENDED', result: 'PASSED' }).success,
    ).toBe(true);
  });

  it('attended + failed needs feedback of at least 5 characters', () => {
    expect(
      recordInterviewOutcomeSchema.safeParse({ attendance: 'ATTENDED', result: 'FAILED' }).success,
    ).toBe(false);
    expect(
      recordInterviewOutcomeSchema.safeParse({
        attendance: 'ATTENDED',
        result: 'FAILED',
        feedback: 'weak',
      }).success,
    ).toBe(false);
    expect(
      recordInterviewOutcomeSchema.safeParse({
        attendance: 'ATTENDED',
        result: 'FAILED',
        feedback: 'Weak communication',
      }).success,
    ).toBe(true);
  });

  it('a no-show is always a fail, never a pass', () => {
    expect(
      recordInterviewOutcomeSchema.safeParse({
        attendance: 'NO_SHOW',
        result: 'PASSED',
        feedback: 'Did not attend',
      }).success,
    ).toBe(false);
    expect(
      recordInterviewOutcomeSchema.safeParse({
        attendance: 'NO_SHOW',
        result: 'FAILED',
        feedback: 'Did not attend',
      }).success,
    ).toBe(true);
  });

  it('feedback over 500 characters is rejected', () => {
    expect(
      recordInterviewOutcomeSchema.safeParse({
        attendance: 'ATTENDED',
        result: 'PASSED',
        feedback: 'x'.repeat(501),
      }).success,
    ).toBe(false);
  });
});

describe('0052 interview outcome state machine', () => {
  const transition = (from: string, event: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applicationMachine.transition(from as never, event as never, {}, [] as never);

  it('a scheduled interview can be passed or failed', () => {
    expect(transition('INTERVIEW_SCHEDULED', 'RECORD_INTERVIEW_PASS')).toBe('INTERVIEW_PASSED');
    expect(transition('INTERVIEW_SCHEDULED', 'RECORD_INTERVIEW_FAIL')).toBe('INTERVIEW_FAILED');
    expect(transition('INTERVIEW_POSTPONED', 'RECORD_INTERVIEW_PASS')).toBe('INTERVIEW_PASSED');
  });

  it('no outcome can be recorded on a shortlisted or cancelled interview', () => {
    expect(() => transition('SHORTLISTED', 'RECORD_INTERVIEW_PASS')).toThrow(
      InvalidTransitionError,
    );
    expect(() => transition('INTERVIEW_CANCELLED', 'RECORD_INTERVIEW_FAIL')).toThrow(
      InvalidTransitionError,
    );
  });

  it('a passed interview can be referred, a failed one cannot be referred or rescheduled', () => {
    expect(transition('INTERVIEW_PASSED', 'REFER')).toBe('FORWARDED');
    expect(() => transition('INTERVIEW_FAILED', 'REFER')).toThrow(InvalidTransitionError);
    expect(() => transition('INTERVIEW_FAILED', 'SCHEDULE_INTERVIEW')).toThrow(
      InvalidTransitionError,
    );
    expect(() => transition('INTERVIEW_PASSED', 'SCHEDULE_INTERVIEW')).toThrow(
      InvalidTransitionError,
    );
  });

  it('staff can still refer a shortlisted candidate (unchanged)', () => {
    expect(transition('SHORTLISTED', 'REFER')).toBe('FORWARDED');
    expect(transition('INTERVIEW_SCHEDULED', 'REFER')).toBe('FORWARDED');
  });
});

describe('0052 pass-only referral guard (pure helpers)', () => {
  const interviewer = makeActor({ roles: ['INTERVIEWER_SCHEDULER'], branchIds: ['b-1'] });
  const staff = makeActor({ roles: ['STAFF'], branchIds: ['b-1'] });
  const branchAdmin = makeActor({ roles: ['BRANCH_ADMIN'], branchIds: ['b-1'] });
  const dual = makeActor({ roles: ['BRANCH_ADMIN', 'INTERVIEWER_SCHEDULER'], branchIds: ['b-1'] });

  it('an interviewer-only actor may refer only from INTERVIEW_PASSED', () => {
    expect(isInterviewerOnlyReferrer(interviewer)).toBe(true);
    expect(referableStatusesFor(interviewer)).toEqual(['INTERVIEW_PASSED']);
  });

  it('staff and branch admins keep their existing referable range, plus PASSED', () => {
    expect(isInterviewerOnlyReferrer(staff)).toBe(false);
    expect(isInterviewerOnlyReferrer(branchAdmin)).toBe(false);
    expect(referableStatusesFor(staff)).toEqual([
      'SHORTLISTED',
      'INTERVIEW_SCHEDULED',
      'INTERVIEW_POSTPONED',
      'INTERVIEW_PASSED',
    ]);
    expect(referableStatusesFor(branchAdmin)).toEqual(referableStatusesFor(staff));
  });

  it('a dual-role Branch Admin + Interviewer is treated as Staff/BA, not interviewer-only', () => {
    expect(isInterviewerOnlyReferrer(dual)).toBe(false);
    expect(referableStatusesFor(dual)).toEqual(referableStatusesFor(staff));
  });
});

describe('0052 outcome states stay invisible to employers until referral', () => {
  it('INTERVIEW_PASSED and INTERVIEW_FAILED are pre-referral states', () => {
    expect(EMPLOYER_VISIBLE_STATUSES).not.toContain('INTERVIEW_PASSED');
    expect(EMPLOYER_VISIBLE_STATUSES).not.toContain('INTERVIEW_FAILED');
    expect(() => assertEmployerCanView('INTERVIEW_PASSED', 'app-1')).toThrow(NotFoundError);
    expect(() => assertEmployerCanView('INTERVIEW_FAILED', 'app-1')).toThrow(NotFoundError);
  });
});
