import 'server-only';
import { schema } from '@jobbank/db';
import { eq } from 'drizzle-orm';
import type { RequestContext } from '@/domains/shared/audit';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { sendMail, type MailMessage } from '@/lib/mail/mailer';

const appUrl = (path: string) => new URL(path, env.NEXT_PUBLIC_APP_URL).toString();

/**
 * Emails the company's employer accounts (owner decision 14; M16 replaces this with the
 * notification system). Sent after the change committed; a mail failure is logged, never
 * undoes the change.
 */
export async function emailEmployers(
  ctx: RequestContext,
  companyId: string,
  build: (input: { name: string; url: string }) => Omit<MailMessage, 'to'>,
): Promise<void> {
  const recipients = await db
    .select({ name: schema.users.name, email: schema.users.email })
    .from(schema.companyMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.companyMembers.userId))
    .where(eq(schema.companyMembers.companyId, companyId));
  for (const recipient of recipients) {
    try {
      await sendMail({
        to: recipient.email,
        ...build({ name: recipient.name, url: appUrl('/employer') }),
      });
    } catch (err) {
      ctx.log.error('company email failed', { companyId, err });
    }
  }
}
