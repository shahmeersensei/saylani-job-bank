import { BRANCH_SCOPED_ROLES } from '@jobbank/shared';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { userRoles } from '../src/schema/rbac';

/**
 * Renders a drizzle SQL fragment to plain text (literal parts and column
 * names). A check's value is an SQL object, not a string, so the literal
 * role names have to be pulled out of its query chunks.
 */
function chunkText(chunk: unknown): string {
  if (chunk === undefined || chunk === null) return '';
  if (typeof chunk === 'string') return chunk;
  if (Array.isArray(chunk)) return chunk.map(chunkText).join('');
  if (typeof chunk === 'object') {
    const record = chunk as {
      queryChunks?: unknown;
      value?: unknown;
      name?: unknown;
    };
    if (Array.isArray(record.queryChunks)) return record.queryChunks.map(chunkText).join('');
    if (Array.isArray(record.value)) return record.value.map(String).join('');
    if (typeof record.name === 'string') return record.name;
  }
  return '';
}

describe('user_roles_branch_scope', () => {
  it('lists every branch-scoped role, so inviting one to a branch cannot fail in Postgres', () => {
    // Regression: INTERVIEWER_SCHEDULER was added to BRANCH_SCOPED_ROLES
    // but left out of this check, so inviting one passed canGrantRole and
    // then failed on INSERT with 23514, surfaced as "Scope is not allowed.".
    const check = getTableConfig(userRoles).checks.find(
      (c) => c.name === 'user_roles_branch_scope',
    );
    expect(check).toBeDefined();
    const sqlText = chunkText(check!.value);
    for (const role of BRANCH_SCOPED_ROLES) {
      expect(sqlText, `user_roles_branch_scope is missing ${role}`).toContain(`'${role}'`);
    }
  });
});
