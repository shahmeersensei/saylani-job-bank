import type { JobStatus } from '@jobbank/shared';

export type JobEditability = 'editable' | 'read_only';

export function jobEditability(status: JobStatus): JobEditability {
  return status === 'DRAFT' || status === 'OPEN' || status === 'PAUSED' ? 'editable' : 'read_only';
}

/** Transitions the employer is allowed to trigger. */
export type JobStatusTransition = 'publish' | 'pause' | 'resume' | 'close' | 'reopen';

export function allowedTransitions(status: JobStatus): JobStatusTransition[] {
  switch (status) {
    case 'DRAFT':
      return ['publish'];
    case 'OPEN':
      return ['pause', 'close'];
    case 'PAUSED':
      return ['resume', 'close'];
    case 'CLOSED':
      return ['reopen'];
    case 'FILLED':
    case 'EXPIRED':
      return [];
  }
}
