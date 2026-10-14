/** Auto matching engine integration (services/matching, Python). */

export {
  enqueueJobMatch,
  getLatestJobMatches,
  type JobMatchFactorView,
  type JobMatchView,
  type MatchesPage,
  type MatchRunSummary,
  type MatchTrigger,
} from './queries';
export {
  getJobMatches,
  getMyPendingOffers,
  listMatchedJobs,
  listRejectionReasons,
  listRefusalReasons,
  requestJobMatchesRefresh,
  respondToJobOffer,
  setJobMatchReviewStatus,
  MATCH_REVIEW_STATUSES,
  OFFER_RESPONSES,
  type MatchDecisionInput,
  type MatchedJob,
  type MatchReviewStatus,
  type MatchStrength,
  type OfferResponse,
  type OfferResponseInput,
  type PendingOffer,
} from './service';
