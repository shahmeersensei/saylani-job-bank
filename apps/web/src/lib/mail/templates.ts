/** Plain, accessible transactional emails (text + simple HTML). */

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

function layout(
  title: string,
  paragraphs: string[],
  action?: { label: string; url: string },
): string {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(p)}</p>`)
    .join('');
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#0f7a3d;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(action.label)}</a></p><p style="margin:0 0 16px;font-size:13px;color:#46544f">Or open this link: ${escapeHtml(action.url)}</p>`
    : '';
  return `<!doctype html><html lang="en"><body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f1a16;background:#f6f8f7;padding:24px"><div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px"><h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>${body}${button}<p style="margin:24px 0 0;font-size:12px;color:#5f6d68">Saylani Job Bank · This is an automated message.</p></div></body></html>`;
}

export function invitationEmail(input: {
  name: string;
  invitedBy: string;
  roleLabel: string;
  branchName: string | null;
  url: string;
  expiresDays: number;
}) {
  const where = input.branchName ? ` at ${input.branchName}` : '';
  const lines = [
    `Assalam-o-Alaikum ${input.name},`,
    `${input.invitedBy} has invited you to join the Saylani Job Bank as ${input.roleLabel}${where}.`,
    `Set your password to activate your account. This link expires in ${input.expiresDays} days and can be used once.`,
  ];
  return {
    subject: 'You are invited to Saylani Job Bank',
    text: `${lines.join('\n\n')}\n\n${input.url}\n`,
    html: layout('Activate your account', lines, { label: 'Set your password', url: input.url }),
  };
}

export function passwordResetEmail(input: { name: string; url: string; expiresMinutes: number }) {
  const lines = [
    `Assalam-o-Alaikum ${input.name},`,
    `We received a request to reset your Saylani Job Bank password. This link expires in ${input.expiresMinutes} minutes and can be used once.`,
    'If you did not ask for this, you can ignore this email — your password will not change.',
  ];
  return {
    subject: 'Reset your Saylani Job Bank password',
    text: `${lines.join('\n\n')}\n\n${input.url}\n`,
    html: layout('Reset your password', lines, { label: 'Choose a new password', url: input.url }),
  };
}

export function signInCodeEmail(input: { code: string; expiresMinutes: number }) {
  const lines = [
    `Your Saylani Job Bank sign-in code is ${input.code}.`,
    `It expires in ${input.expiresMinutes} minutes. Never share this code with anyone — Job Bank staff will never ask for it.`,
  ];
  return {
    subject: `${input.code} is your Saylani Job Bank sign-in code`,
    text: lines.join('\n\n'),
    html: layout('Your sign-in code', lines),
  };
}

// ─── Employers (M7) ────────────────────────────────────────────────────

export function signupCodeEmail(input: { code: string; expiresMinutes: number }) {
  const lines = [
    `Your code to create a Saylani Job Bank employer account is ${input.code}.`,
    `It expires in ${input.expiresMinutes} minutes. If you did not start registering, you can ignore this email.`,
  ];
  return {
    subject: `${input.code} is your Saylani Job Bank confirmation code`,
    text: lines.join('\n\n'),
    html: layout('Confirm your email', lines),
  };
}

/** Sent instead of a code when the email already has an account (no account discovery). */
export function signupExistingAccountEmail(input: { url: string }) {
  const lines = [
    'Someone tried to create a Saylani Job Bank employer account with this email address, but it already has an account.',
    'If that was you, sign in instead — you can reset your password from the sign-in page. If not, you can ignore this email.',
  ];
  return {
    subject: 'You already have a Saylani Job Bank account',
    text: `${lines.join('\n\n')}\n\n${input.url}\n`,
    html: layout('You already have an account', lines, { label: 'Sign in', url: input.url }),
  };
}

export function companySubmittedEmail(input: {
  name: string;
  companyName: string;
  dueDate: string;
  url: string;
}) {
  const lines = [
    `Assalam-o-Alaikum ${input.name},`,
    `Thank you — we received ${input.companyName}'s registration. A verification officer will review it, usually by ${input.dueDate}.`,
    'We will email you if we need anything else. You can follow the progress on your company page.',
  ];
  return {
    subject: `${input.companyName}: registration received`,
    text: `${lines.join('\n\n')}\n\n${input.url}\n`,
    html: layout('Registration received', lines, { label: 'View status', url: input.url }),
  };
}

export function companyInfoRequestedEmail(input: {
  name: string;
  companyName: string;
  request: string;
  url: string;
}) {
  const lines = [
    `Assalam-o-Alaikum ${input.name},`,
    `Our verification officer needs more information before ${input.companyName} can be verified:`,
    input.request,
    'Please update your registration and press "Send for review" when done.',
  ];
  return {
    subject: `${input.companyName}: more information needed`,
    text: `${lines.join('\n\n')}\n\n${input.url}\n`,
    html: layout('More information needed', lines, {
      label: 'Update registration',
      url: input.url,
    }),
  };
}

export function companyVerifiedEmail(input: { name: string; companyName: string; url: string }) {
  const lines = [
    `Assalam-o-Alaikum ${input.name},`,
    `Good news: ${input.companyName} is now verified with the Saylani Job Bank.`,
    'You can now post jobs, and our branch team will refer suitable candidates to you.',
  ];
  return {
    subject: `${input.companyName} is verified`,
    text: `${lines.join('\n\n')}\n\n${input.url}\n`,
    html: layout('Your company is verified', lines, {
      label: 'Go to your dashboard',
      url: input.url,
    }),
  };
}

export function companyRejectedEmail(input: {
  name: string;
  companyName: string;
  reason: string;
  note: string;
  url: string;
}) {
  const lines = [
    `Assalam-o-Alaikum ${input.name},`,
    `We could not verify ${input.companyName}. Reason: ${input.reason}.`,
    input.note,
    'You can correct your registration and submit it again, or contact your Job Bank branch.',
  ];
  return {
    subject: `${input.companyName}: registration not approved`,
    text: `${lines.join('\n\n')}\n\n${input.url}\n`,
    html: layout('Registration not approved', lines, { label: 'View details', url: input.url }),
  };
}
