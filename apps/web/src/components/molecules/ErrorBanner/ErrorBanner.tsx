'use client';

import { messageNamesField, type FieldIssue } from '@jobbank/shared';
import { AlertTriangle, CircleAlert, CircleCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { describeApiError, humanizePath } from '@/lib/api/client';

export type ErrorBannerVariant = 'system' | 'validation' | 'success';

export interface ErrorBannerProps {
  /**
   * The caught error. When given, the banner is built from
   * `describeApiError`: 422 issues become the validation list, a network
   * failure becomes the red system banner, and anything else shows the
   * message with its code, status and correlation id.
   */
  error?: unknown;
  /** What was being attempted, e.g. "Create account" — used in the title. */
  operation?: string;
  /** Explicit variant when no `error` is passed. */
  variant?: ErrorBannerVariant;
  title?: string;
  message?: string;
  issues?: readonly FieldIssue[];
  code?: string;
  status?: number;
  correlationId?: string;
  /** Called with the field path when a validation item is clicked. */
  onIssueClick?: (path: string) => void;
  children?: ReactNode;
}

const STYLES: Record<ErrorBannerVariant, { box: string; icon: typeof AlertTriangle }> = {
  system: { box: 'bg-danger-soft text-danger-soft-fg', icon: AlertTriangle },
  validation: { box: 'bg-warning-soft text-warning-soft-fg', icon: CircleAlert },
  success: { box: 'bg-success-soft text-success-soft-fg', icon: CircleCheck },
};

/** Field label plus the reason, without repeating a label the message already starts with. */
function issueLine(path: string, message: string): string {
  if (path === '(root)' || path === 'root') return message;
  if (messageNamesField(path, message)) return message;
  return `${label(path)} — ${message}`;
}

/** "salary min" → "Salary min". */
function label(path: string): string {
  if (path === '(root)' || path === 'root') return 'Form';
  const text = humanizePath(path);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * One shared error/success banner for the whole app.
 *
 * - system (red): technical failures — what happened, which operation,
 *   error code + HTTP status, and the correlation id as `Ref: …` so a
 *   developer can find the request in the server log. Never a stack trace,
 *   SQL, or secret.
 * - validation (amber): one line per field issue — field name, what is
 *   wrong, and the message that says how to fix it. Items are buttons
 *   that jump to the field when `onIssueClick` is given.
 * - success (green): what completed, in words — not a bare "Done".
 */
export function ErrorBanner({
  error,
  operation,
  variant,
  title,
  message,
  issues,
  code,
  status,
  correlationId,
  onIssueClick,
  children,
}: ErrorBannerProps) {
  const described = error !== undefined ? describeApiError(error, operation) : undefined;
  const resolvedVariant: ErrorBannerVariant =
    variant ?? (described?.kind === 'validation' ? 'validation' : 'system');
  const resolvedTitle =
    title ?? described?.title ?? (resolvedVariant === 'success' ? 'Success' : undefined);
  const resolvedMessage = message ?? described?.message;
  const resolvedIssues = issues ?? described?.issues ?? [];
  const resolvedCode = code ?? described?.code;
  const resolvedStatus = status ?? described?.status;
  const resolvedCorrelationId = correlationId ?? described?.correlationId;

  if (!resolvedMessage && resolvedIssues.length === 0 && !children) return null;

  const { box, icon: Icon } = STYLES[resolvedVariant];
  const isSystem = resolvedVariant === 'system';

  return (
    <div
      role={resolvedVariant === 'success' ? 'status' : 'alert'}
      className={`${box} rounded-lg px-4 py-3 text-sm`}
    >
      <p className="flex items-start gap-2 font-semibold">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{resolvedTitle}</span>
      </p>

      {resolvedVariant === 'validation' && resolvedIssues.length > 0 ? (
        <ul className="mt-2 grid gap-1 pl-6">
          {resolvedIssues.map((issue) => (
            <li key={`${issue.path}:${issue.message}`}>
              {onIssueClick && issue.path !== '(root)' && issue.path !== 'root' ? (
                <button
                  type="button"
                  className="cursor-pointer text-left underline underline-offset-2 hover:opacity-80"
                  onClick={() => onIssueClick(issue.path)}
                >
                  {issueLine(issue.path, issue.message)}
                </button>
              ) : (
                <span>{issueLine(issue.path, issue.message)}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        resolvedMessage && <p className="mt-1 pl-6">{resolvedMessage}</p>
      )}

      {isSystem && (resolvedCode || resolvedStatus) && (
        <p className="mt-2 pl-6 text-xs opacity-80">
          {resolvedCode ? `Code: ${resolvedCode}` : ''}
          {resolvedCode && resolvedStatus ? ' · ' : ''}
          {resolvedStatus ? `Status: ${resolvedStatus}` : ''}
        </p>
      )}
      {isSystem && resolvedCorrelationId && (
        <p className="mt-1 pl-6 font-mono text-xs opacity-80">Ref: {resolvedCorrelationId}</p>
      )}
      {isSystem && (
        <p className="mt-1 pl-6 text-xs opacity-80">
          Try again. If it keeps happening, share the reference above with support.
        </p>
      )}
      {children && <div className="mt-2 pl-6">{children}</div>}
    </div>
  );
}
