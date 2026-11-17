import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import QRCode from 'qrcode';
import { schema } from '@jobbank/db';
import { and, eq } from 'drizzle-orm';
import { getApplicantForStaff } from './staff';
import { currentDocuments, PRESENT_DOCUMENT_STATUSES } from './repository';
import {
  assertBranchAccess,
  assertCityAccess,
  assertPermission,
  type Actor,
} from '@/domains/shared/scope';
import { downloadDocument } from '@/domains/shared/documents';
import { runCommand, type RequestContext } from '@/domains/shared/audit';
import { NotFoundError } from '@/domains/shared/errors';
import { masterDataLabels } from '@/domains/settings';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { getAuthSecret } from '@/domains/auth';
import type { PublicApplicantVerification, RegistrationFormData } from './registration-form.types';

type SignedIn = RequestContext & { actor: Actor };
const tokens = schema.applicantVerificationTokens;
const applicants = schema.applicants;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function encryptionKey(): Buffer {
  return createHmac('sha256', getAuthSecret())
    .update('saylani-job-bank:applicant-verification-token:v1')
    .digest();
}

function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${ciphertext.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}`;
}

function decryptToken(ciphertext: string, expectedHash: string): string {
  const [version, ivText, encryptedText, tagText, ...extra] = ciphertext.split(':');
  if (version !== 'v1' || !ivText || !encryptedText || !tagText || extra.length > 0) {
    throw new Error('Stored applicant verification token is invalid');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivText, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  const token = Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
  const actualHash = Buffer.from(hashToken(token), 'hex');
  const storedHash = Buffer.from(expectedHash, 'hex');
  if (
    !TOKEN_PATTERN.test(token) ||
    actualHash.length !== storedHash.length ||
    !timingSafeEqual(actualHash, storedHash)
  ) {
    throw new Error('Stored applicant verification token is invalid');
  }
  return token;
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Reuses the active credential unless explicitly rotated by an authorized manager.
 * Scope rule (audit 2026-11-11, M-23): reads are city-scoped, branch-bound
 * writes stay exact-branch. The registration-form print flow passes 'city'
 * (it must match the city-scoped profile read); the rotate-credential route
 * keeps the default 'branch'.
 */
export async function ensureApplicantVerificationToken(
  ctx: SignedIn,
  applicantId: string,
  regenerate = false,
  scope: 'branch' | 'city' = 'branch',
): Promise<string> {
  assertPermission(ctx.actor, 'applicant:manage');
  return runCommand(
    ctx,
    async ({ tx, audit }) => {
      const [applicant] = await tx
        .select({ id: applicants.id, branchId: applicants.branchId })
        .from(applicants)
        .where(eq(applicants.id, applicantId))
        .for('update');
      if (!applicant) throw new NotFoundError('Applicant');
      if (scope === 'city') {
        await assertCityAccess(ctx.actor, applicant.branchId, {
          entityType: 'applicant',
          entityId: applicant.id,
        });
      } else {
        assertBranchAccess(ctx.actor, applicant.branchId, {
          entityType: 'applicant',
          entityId: applicant.id,
        });
      }

      const [active] = await tx
        .select()
        .from(tokens)
        .where(and(eq(tokens.applicantId, applicantId), eq(tokens.isActive, true)))
        .for('update');
      const current = active ?? null;

      if (!regenerate && current) return decryptToken(current.tokenCiphertext, current.tokenHash);

      if (current) {
        await tx
          .update(tokens)
          .set({
            isActive: false,
            revokedAt: new Date(),
            revokedBy: ctx.actor.userId,
          })
          .where(eq(tokens.id, current.id));
        audit({
          action: 'applicant.verification_token.revoke',
          entityType: 'applicant',
          entityId: applicantId,
          branchId: applicant.branchId,
          metadata: { tokenId: current.id },
        });
      }

      const token = newToken();
      const [created] = await tx
        .insert(tokens)
        .values({
          applicantId,
          tokenHash: hashToken(token),
          tokenCiphertext: encryptToken(token),
          createdBy: ctx.actor.userId,
        })
        .returning({ id: tokens.id });
      audit({
        action: regenerate
          ? 'applicant.verification_token.regenerate'
          : 'applicant.verification_token.create',
        entityType: 'applicant',
        entityId: applicantId,
        branchId: applicant.branchId,
        metadata: { tokenId: created!.id },
      });
      return token;
    },
    { audited: false },
  );
}

export async function createApplicantRegistrationForm(
  ctx: SignedIn,
  applicantId: string,
): Promise<RegistrationFormData> {
  const profile = await getApplicantForStaff(ctx.actor, applicantId);
  const [registration] = await db
    .select({ registeredByName: schema.users.name })
    .from(applicants)
    .leftJoin(schema.users, eq(schema.users.id, applicants.registeredBy))
    .where(eq(applicants.id, applicantId));
  if (!registration) throw new NotFoundError('Applicant');

  const [labels, token, photo] = await Promise.all([
    masterDataLabels(['EDUCATION_LEVEL', 'SKILL', 'LANGUAGE', 'CITY', 'AREA', 'JOB_CATEGORY']),
    ensureApplicantVerificationToken(ctx, applicantId, false, 'city'),
    applicantPhoto(applicantId),
  ]);
  // The applicant's current passport-size photo, if one was captured and
  // confirmed: the newest current PHOTO document that is usable (uploaded
  // or accepted — rejected and virus-flagged photos never print). Only the
  // document id travels in the form payload; the client fetches a fresh
  // short-lived view link when printing.
  const photoDocuments = await currentDocuments(db, applicantId);
  const photoDocument = photoDocuments.find(
    (doc) => doc.typeCode === 'PHOTO' && doc.status !== 'REJECTED' && doc.scanResult !== 'infected',
  );
  const label = (type: keyof typeof labels, code: string | null) =>
    code ? (labels[type]?.[code] ?? 'Not available') : null;
  const verificationUrl = new URL(`/verify/applicant/${token}`, env.NEXT_PUBLIC_APP_URL).toString();
  const verificationQrDataUrl = await QRCode.toDataURL(verificationUrl, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 256,
  });

  return {
    registrationReference: profile.registrationReference,
    registeredAt: profile.registeredAt,
    registrationSource:
      profile.registrationSource === 'STAFF_ASSISTED'
        ? 'Staff-assisted registration'
        : 'Self-service registration',
    status: profile.status,
    branchName: profile.branch?.name ?? null,
    registeredByName: registration.registeredByName,
    personal: {
      ...profile.personal,
      gender: profile.personal.gender,
    },
    address: profile.address
      ? {
          addressLine: profile.address.addressLine,
          area: label('AREA', profile.address.areaCode),
          city: label('CITY', profile.address.cityCode),
        }
      : null,
    education: profile.education.map((item) => ({
      ...item,
      level: label('EDUCATION_LEVEL', item.levelCode) ?? 'Not available',
    })),
    experience: profile.experience.map((item) => ({
      employerName: item.employerName,
      jobTitle: item.jobTitle,
      category: label('JOB_CATEGORY', item.categoryCode),
      startMonth: item.startMonth,
      endMonth: item.endMonth,
      isCurrent: item.isCurrent,
      description: item.description,
    })),
    hasNoExperience: profile.hasNoExperience,
    skills: profile.skills.map((item) => ({
      name: label('SKILL', item.skillCode) ?? 'Not available',
      level: item.level,
      years: item.years,
    })),
    languages: profile.languages.map((item) => ({
      name: label('LANGUAGE', item.languageCode) ?? 'Not available',
      proficiency: item.proficiency,
    })),
    certifications: profile.certifications,
    preferences: profile.preferences
      ? {
          ...profile.preferences,
          categories: profile.preferences.categoryCodes.map(
            (code) => label('JOB_CATEGORY', code) ?? 'Not available',
          ),
          shifts: profile.preferences.shifts,
          jobTypes: profile.preferences.jobTypes,
          // Merge (2026-11-10): willingRadiusM was dropped by HEAD
          // migration 0036, so the print view always gets null here.
          willingRadiusM: null,
        }
      : null,
    verificationQrDataUrl,
    photoDataUrl: photo.dataUrl,
    photoUrl: photo.viewUrl,
    canRegenerate: profile.can.manage,
    photoDocumentId: photoDocument?.id ?? null,
  };
}

/**
 * The applicant's passport photo for the printed form. The primary copy is
 * embedded as a data URL, like the verification QR — the printout must be
 * self-contained. `viewUrl` is the same-origin download route the profile
 * page views the photo through, kept as a fallback for the print client
 * when the embedded copy cannot be read or rendered. A missing or
 * unreadable photo must never block the form itself — but unlike before,
 * a failed read is now logged (no photo on file stays silent, as expected),
 * so a photo that exists yet never shows up can be traced from the server
 * log instead of silently rendering "No photo on file".
 */
async function applicantPhoto(
  applicantId: string,
): Promise<{ dataUrl: string | null; viewUrl: string | null }> {
  let photo: Awaited<ReturnType<typeof currentDocuments>>[number] | undefined;
  try {
    const documents = await currentDocuments(db, applicantId);
    photo = documents.find((doc) => doc.typeCode === 'PHOTO');
  } catch (error) {
    console.warn(
      `[registration-form] could not list documents for applicant ${applicantId}:`,
      error instanceof Error ? error.message : 'unknown error',
    );
    return { dataUrl: null, viewUrl: null };
  }
  if (!photo) return { dataUrl: null, viewUrl: null };
  const viewUrl = `/api/v1/applicants/${applicantId}/documents/${photo.id}/download`;
  try {
    const stored = await downloadDocument(photo, PRESENT_DOCUMENT_STATUSES);
    const bytes = new Uint8Array(await new Response(stored.body).arrayBuffer());
    if (bytes.length === 0) {
      console.warn(
        `[registration-form] PHOTO document ${photo.id} for applicant ${applicantId} is empty; the print form will use the download link instead.`,
      );
      return { dataUrl: null, viewUrl };
    }
    const contentType = photo.contentType || stored.contentType || 'image/jpeg';
    return {
      dataUrl: `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`,
      viewUrl,
    };
  } catch (error) {
    console.warn(
      `[registration-form] could not embed PHOTO document ${photo.id} for applicant ${applicantId}; the print form will use the download link instead:`,
      error instanceof Error ? error.message : 'unknown error',
    );
    return { dataUrl: null, viewUrl };
  }
}

export async function resolveApplicantVerification(
  token: string,
): Promise<{ applicantId: string; verification: PublicApplicantVerification } | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const [row] = await db
    .select({
      applicantId: applicants.id,
      registrationReference: applicants.registrationReference,
      registeredAt: applicants.registeredAt,
      fullName: applicants.fullName,
      branchName: schema.branches.name,
    })
    .from(tokens)
    .innerJoin(applicants, eq(applicants.id, tokens.applicantId))
    .leftJoin(schema.branches, eq(schema.branches.id, applicants.branchId))
    .where(and(eq(tokens.tokenHash, hashToken(token)), eq(tokens.isActive, true)))
    .limit(1);
  if (!row) return null;

  return {
    applicantId: row.applicantId,
    verification: {
      registrationReference: row.registrationReference,
      registeredAt: row.registeredAt.toISOString(),
      maskedApplicantName: row.fullName
        .trim()
        .split(/\s+/)
        .map((part) => `${part.slice(0, 1)}••••`)
        .join(' '),
      branchName: row.branchName,
    },
  };
}

export async function getPublicApplicantVerification(
  token: string,
): Promise<PublicApplicantVerification | null> {
  return (await resolveApplicantVerification(token))?.verification ?? null;
}
