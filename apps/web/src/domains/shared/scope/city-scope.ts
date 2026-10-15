'server-only';
import { schema } from '@jobbank/db';
import { alias } from 'drizzle-orm/pg-core';
import { and, exists, inArray, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '@/lib/db';
import { ScopeViolationError } from '../errors';
import { isSuperAdmin, type Actor } from './scope';

const itemBranch = alias(schema.branches, 'item_branch');
const actorBranch = alias(schema.branches, 'actor_branch');

/**
 * City-level scope: staff see all items whose branch city matches the city
 * of ANY branch in the actor's assigned branches.
 *
 * Use in place of branchScope() wherever the new city-wide visibility rule applies
 * (companies, jobs, applicants).
 */
export function cityScope(actor: Actor, branchIdColumn: AnyPgColumn): SQL | undefined {
  if (isSuperAdmin(actor)) return undefined;
  if (actor.branchIds.length === 0) return sql`false`;

  return exists(
    db
      .select({ one: sql`1` })
      .from(itemBranch)
      .innerJoin(actorBranch, sql`upper(${actorBranch.city}) = upper(${itemBranch.city})`)
      .where(
        and(
          sql`${itemBranch.id} = ${branchIdColumn}`,
          inArray(actorBranch.id, [...actor.branchIds]),
        ),
      ),
  );
}

/**
 * Async city-level access check for individual record actions.
 * Throws ScopeViolationError when none of the actor's branches share a city
 * with the item's branch.
 */
export async function assertCityAccess(
  actor: Actor,
  itemBranchId: string | null | undefined,
  target: { entityType: string; entityId?: string } = { entityType: 'item' },
): Promise<void> {
  if (isSuperAdmin(actor)) return;
  if (!itemBranchId || actor.branchIds.length === 0) {
    throw new ScopeViolationError(undefined, { ...target, branchId: itemBranchId ?? null });
  }

  const match = await db
    .select({ one: sql`1` })
    .from(itemBranch)
    .innerJoin(actorBranch, sql`upper(${actorBranch.city}) = upper(${itemBranch.city})`)
    .where(
      and(sql`${itemBranch.id} = ${itemBranchId}`, inArray(actorBranch.id, [...actor.branchIds])),
    )
    .limit(1);

  if (match.length === 0) {
    throw new ScopeViolationError(undefined, { ...target, branchId: itemBranchId });
  }
}
