import { createHash, randomInt } from 'node:crypto';
import { schema } from '@jobbank/db';
import { and, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { ConflictError, isUniqueViolation } from '@/domains/shared/errors';
import type { DbExecutor } from '@/lib/db';

/**
 * Applicant IDs are 8 characters from this alphabet: uppercase letters and
 * digits, without the look-alikes 0, O, 1, I and L. 31^8 possibilities.
 */
export const REGISTRATION_REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REGISTRATION_REFERENCE_LENGTH = 8;

const ALLOCATION_ATTEMPTS = 8;
const APPLICANT_REFERENCE_CONSTRAINT = 'applicants_registration_reference_unique';

const applicants = schema.applicants;
const tokens = schema.branchApplicantTokens;

/** Cryptographically random 8-character applicant ID. Unbiased (`randomInt`). */
export function createRegistrationReference(): string {
  let reference = '';
  for (let index = 0; index < REGISTRATION_REFERENCE_LENGTH; index++) {
    reference +=
      REGISTRATION_REFERENCE_ALPHABET[randomInt(REGISTRATION_REFERENCE_ALPHABET.length)]!;
  }
  return reference;
}

function lockReference(tx: DbExecutor, key: string) {
  const hash = createHash('sha256').update(key).digest();
  return tx.execute(
    sql`select pg_advisory_xact_lock(${hash.readInt32BE(0)}, ${hash.readInt32BE(4)})`,
  );
}

/** True when this ID is already an applicant or reserved on any token. */
export async function registrationReferenceTaken(
  tx: DbExecutor,
  reference: string,
): Promise<boolean> {
  const [applicant] = await tx
    .select({ id: applicants.id })
    .from(applicants)
    .where(eq(applicants.registrationReference, reference))
    .limit(1);
  if (applicant) return true;
  const [token] = await tx
    .select({ id: tokens.id })
    .from(tokens)
    .where(eq(tokens.registrationReference, reference))
    .limit(1);
  return Boolean(token);
}

/**
 * Mint an ID that is not on an applicant and not reserved on a token.
 * The advisory lock serializes two issuers who draw the same candidate;
 * a unique-constraint miss on insert is retried by the caller.
 */
export async function allocateRegistrationReference(
  tx: DbExecutor,
  generate: () => string = createRegistrationReference,
): Promise<string> {
  for (let attempt = 0; attempt < ALLOCATION_ATTEMPTS; attempt++) {
    const reference = generate();
    await lockReference(tx, `registration-reference:${reference}`);
    if (!(await registrationReferenceTaken(tx, reference))) return reference;
  }
  throw new ConflictError('Could not assign an applicant ID. Please try again.');
}

/**
 * The applicant ID follows the CNIC, including a token issued at another
 * branch. A repeat visit reuses the ID from the latest token for that CNIC
 * that was never registered, so the slip and the later profile match.
 * Token numbers stay per branch; the applicant ID does not.
 */
export async function registrationReferenceForToken(tx: DbExecutor, cnic: string): Promise<string> {
  await lockReference(tx, `cnic-applicant-id:${cnic}`);
  const [row] = await tx
    .select({ registrationReference: tokens.registrationReference })
    .from(tokens)
    .where(
      and(
        eq(tokens.cnic, cnic),
        isNotNull(tokens.registrationReference),
        isNull(tokens.applicantId),
        ne(tokens.status, 'COMPLETED'),
      ),
    )
    .orderBy(desc(tokens.issuedAt))
    .limit(1);
  const existing = row?.registrationReference ?? null;
  if (existing) {
    const [applicant] = await tx
      .select({ id: applicants.id })
      .from(applicants)
      .where(eq(applicants.registrationReference, existing))
      .limit(1);
    const [otherPerson] = await tx
      .select({ id: tokens.id })
      .from(tokens)
      .where(and(eq(tokens.registrationReference, existing), ne(tokens.cnic, cnic)))
      .limit(1);
    if (!applicant && !otherPerson) return existing;
  }
  return allocateRegistrationReference(tx);
}

/**
 * Insert with a registration reference. A fresh ID is retried when the
 * applicants unique constraint loses a race; a reserved token ID is never
 * replaced — that collision fails the registration.
 */
export async function withRegistrationReference<T>(
  tx: DbExecutor,
  options: { reserved?: string | null; generate?: () => string },
  run: (reference: string) => Promise<T>,
): Promise<T> {
  const reserved = options.reserved ?? null;
  const attempts = reserved ? 1 : ALLOCATION_ATTEMPTS;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const reference = reserved ?? (await allocateRegistrationReference(tx, options.generate));
    const savepoint = `reg_ref_${attempt}`;
    await tx.execute(sql.raw(`SAVEPOINT ${savepoint}`));
    try {
      const result = await run(reference);
      await tx.execute(sql.raw(`RELEASE SAVEPOINT ${savepoint}`));
      return result;
    } catch (error) {
      await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${savepoint}`));
      if (!reserved && isUniqueViolation(error, APPLICANT_REFERENCE_CONSTRAINT)) continue;
      throw error;
    }
  }
  throw new ConflictError('Could not assign an applicant ID. Please try again.');
}
