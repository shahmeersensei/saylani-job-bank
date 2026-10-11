import type { Role } from '@jobbank/shared';
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import type { Database } from '../client';
import { accounts, branches, twoFactors, userRoles, users } from '../schema';
import type { SeedStep } from '../scripts/seed';

/**
 * Local development data — NEVER seeded in production (see seed.ts).
 * These are throwaway test credentials for the local dev database only.
 */
export const DEV_PASSWORD = 'JobBank-Dev-2026!';

export const DEV_BRANCHES = [
  {
    code: 'KHI-GULSHAN',
    name: 'Karachi — Gulshan-e-Iqbal',
    city: 'Karachi',
    address: 'Block 13-D, Gulshan-e-Iqbal, Karachi',
    location: { lat: 24.9204, lng: 67.0932 },
  },
  {
    code: 'LHR-JOHAR',
    name: 'Lahore — Johar Town',
    city: 'Lahore',
    address: 'Block G1, Johar Town, Lahore',
    location: { lat: 31.4697, lng: 74.2728 },
  },
] as const;

type BranchCode = (typeof DEV_BRANCHES)[number]['code'];

interface DevUser {
  email: string;
  name: string;
  roles: { role: Role; branch?: BranchCode }[];
  phone?: string;
  password?: boolean;
  status?: 'ACTIVE' | 'DISABLED';
}

export const DEV_USERS: DevUser[] = [
  {
    email: 'superadmin@jobbank.local',
    name: 'Saima Super Admin',
    roles: [{ role: 'SUPER_ADMIN' }],
    password: true,
  },
  {
    email: 'branchadmin.khi@jobbank.local',
    name: 'Bilal Branch Admin',
    roles: [{ role: 'BRANCH_ADMIN', branch: 'KHI-GULSHAN' }],
    password: true,
  },
  {
    email: 'verifier.khi@jobbank.local',
    name: 'Ayesha Verifier',
    roles: [{ role: 'VERIFIER', branch: 'KHI-GULSHAN' }],
    password: true,
  },
  {
    email: 'staff.khi@jobbank.local',
    name: 'Sana Staff (Karachi)',
    roles: [{ role: 'STAFF', branch: 'KHI-GULSHAN' }],
    password: true,
  },
  {
    email: 'staff.lhr@jobbank.local',
    name: 'Usman Staff (Lahore)',
    roles: [{ role: 'STAFF', branch: 'LHR-JOHAR' }],
    password: true,
  },
  {
    email: 'employer@jobbank.local',
    name: 'Hamza Employer',
    roles: [{ role: 'EMPLOYER' }],
    password: true,
  },
  {
    email: 'disabled.staff@jobbank.local',
    name: 'Danish Disabled',
    roles: [{ role: 'STAFF', branch: 'KHI-GULSHAN' }],
    password: true,
    status: 'DISABLED',
  },
  // Applicants sign in with phone + SMS code (the code is printed in the dev server log).
  {
    email: '923001234567@phone.jobbank.invalid',
    name: 'Ahmed Applicant',
    phone: '+923001234567',
    roles: [{ role: 'APPLICANT' }],
  },
];

export const devData: SeedStep = {
  name: 'dev branches & users',
  async run(db: Database) {
    const passwordHash = await hashPassword(DEV_PASSWORD);

    await db.transaction(async (tx) => {
      const branchIds = new Map<string, string>();
      for (const branch of DEV_BRANCHES) {
        const [row] = await tx
          .insert(branches)
          .values({ ...branch, location: { ...branch.location } })
          .onConflictDoUpdate({
            target: branches.code,
            set: { name: branch.name, city: branch.city, address: branch.address, isActive: true },
          })
          .returning({ id: branches.id });
        branchIds.set(branch.code, row!.id);
      }

      for (const user of DEV_USERS) {
        const [row] = await tx
          .insert(users)
          .values({
            email: user.email,
            name: user.name,
            emailVerified: Boolean(user.password),
            phoneNumber: user.phone ?? null,
            phoneNumberVerified: Boolean(user.phone),
            status: user.status ?? 'ACTIVE',
          })
          .onConflictDoUpdate({
            target: users.email,
            set: { name: user.name, status: user.status ?? 'ACTIVE', twoFactorEnabled: false },
          })
          .returning({ id: users.id });
        const userId = row!.id;

        // Clear any enrolled TOTP secret so the account starts without 2FA on every seed.
        await tx.delete(twoFactors).where(eq(twoFactors.userId, userId));

        if (user.password) {
          await tx
            .insert(accounts)
            .values({ userId, providerId: 'credential', accountId: userId, password: passwordHash })
            .onConflictDoUpdate({
              target: [accounts.providerId, accounts.accountId],
              set: { password: passwordHash },
            });
        }

        // Reset this user's roles to exactly what is declared above.
        await tx.delete(userRoles).where(eq(userRoles.userId, userId));
        await tx.insert(userRoles).values(
          user.roles.map(({ role, branch }) => ({
            userId,
            roleCode: role,
            branchId: branch ? branchIds.get(branch)! : null,
          })),
        );
      }
    });
  },
};
