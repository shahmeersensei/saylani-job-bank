/** Public API of the auth domain (route handlers and server components import from here). */
export {
  acceptInvitation,
  INVITE_TTL_DAYS,
  InvalidLinkError,
  issueAccountToken,
  pendingInvitation,
  previewInvitation,
  requestPasswordReset,
  resetPassword,
  RESET_TTL_MINUTES,
  sendInvitationEmail,
  type InvitationPreview,
} from './account-tokens';
export {
  ACTIVE_BRANCH_COOKIE,
  getAuthState,
  loadActor,
  requiresTwoFactor,
  type AuthState,
  type SessionUser,
} from './actor';
export { getAuth, isPlaceholderEmail, placeholderEmailFor, SESSION_COOKIE_PREFIX } from './auth';
export {
  requestEmployerSignupCode,
  signUpEmployer,
  SIGNUP_CODE_TTL_SECONDS,
} from './employer-signup';
export { getServerAuthState, requireRole, requireSignedIn } from './server-session';
export {
  AccountBlockedError,
  describeMe,
  loginWithPassword,
  logout,
  requestEmailCode,
  requestOtp,
  RESEND_AFTER_SECONDS,
  revokeAllSessions,
  switchActiveBranch,
  toSessionUser,
  verifyEmailCode,
  verifyOtp,
  verifySecondFactor,
  type MeView,
  type SignInResult,
  type TwoFactorChallenge,
} from './service';
export {
  confirmTwoFactorEnrollment,
  disableTwoFactor,
  startTwoFactorEnrollment,
  type EnrollmentStart,
} from './two-factor';
