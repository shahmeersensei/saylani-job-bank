/** Public API of the auth domain (route handlers and server components import from here). */
export {
  acceptInvitation,
  hashAccountToken,
  INVITE_TTL_DAYS,
  InvalidLinkError,
  invitationUrl,
  issueAccountToken,
  pendingInvitation,
  previewInvitation,
  requestPasswordReset,
  resetPassword,
  RESET_TTL_MINUTES,
  sendInvitationEmail,
  type InvitationPreview,
  voidAccountTokens,
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
export { issueOtp, OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS, verifyOtpCode, type OtpCheck } from './otp';
export { getAuthSecret } from './secret';
export {
  requestEmployerSignupCode,
  signUpEmployer,
  SIGNUP_CODE_TTL_SECONDS,
} from './employer-signup';
export { getServerAuthState, requireRole, requireSignedIn } from './server-session';
export {
  getCurrentSessionId,
  listMySessions,
  revokeAllMySessions,
  revokeMySession,
  sessionListSchema,
  sessionViewSchema,
  type SessionView,
} from './sessions';
export { clearTrustedDevices } from './service';
export {
  AccountBlockedError,
  describeMe,
  loginWithPassword,
  logout,
  requestOtp,
  RESEND_AFTER_SECONDS,
  revokeAllSessions,
  switchActiveBranch,
  toSessionUser,
  verifyOtp,
  verifySecondFactor,
  type MeView,
  type SignInResult,
  type TwoFactorChallenge,
  type TwoFactorSetupRequired,
} from './service';
export {
  confirmTwoFactorEnrollment,
  disableTwoFactor,
  startTwoFactorEnrollment,
  startTwoFactorEnrollmentWithSetupToken,
  type EnrollmentStart,
} from './two-factor';
