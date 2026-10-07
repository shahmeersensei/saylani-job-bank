/** Jobs domain (M8): posting, status transitions, staff board. */

export {
  createJob,
  deleteJob,
  getMyJob,
  listMyJobs,
  saveJobRequirements,
  saveJobSkills,
  setJobLocation,
  transitionJobStatus,
  updateJob,
} from './profile';
export type { JobLocationView, JobRequirementsView, JobSkillView, JobView } from './repository';
export {
  allowedTransitions,
  jobEditability,
  type JobEditability,
  type JobStatusTransition,
} from './rules';
export {
  forceCloseJob,
  getJobDetail,
  JOB_SORTABLE,
  jobFilters,
  listJobs,
  staffCreateJob,
  type JobListItem,
} from './staff';
