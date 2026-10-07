import { JOB_STATUSES, type JobStatus, type Role } from '@jobbank/shared';
import { defineMachine } from '@/domains/shared/state-machine';

export const jobMachine = defineMachine<JobStatus, string, Record<never, never>, Role>({
  name: 'job',
  states: JOB_STATUSES,
  terminal: ['FILLED', 'CLOSED', 'EXPIRED'],
  transitions: [
    { from: 'DRAFT', event: 'PUBLISH', to: 'OPEN', actors: ['EMPLOYER'] },
    { from: 'OPEN', event: 'PAUSE', to: 'PAUSED', actors: ['EMPLOYER'] },
    { from: ['OPEN', 'PAUSED'], event: 'CLOSE', to: 'CLOSED', actors: ['EMPLOYER'] },
    { from: 'PAUSED', event: 'RESUME', to: 'OPEN', actors: ['EMPLOYER'] },
    // System events (filled by matching, expired by scheduler)
    { from: 'OPEN', event: 'FILL', to: 'FILLED' },
    { from: ['OPEN', 'PAUSED'], event: 'EXPIRE', to: 'EXPIRED' },
  ],
});
