-- INTERVIEWER_SCHEDULER is a branch-scoped role (packages/shared/src/roles.ts
-- BRANCH_SCOPED_ROLES), but the user_roles_branch_scope check still listed only
-- BRANCH_ADMIN, VERIFIER and STAFF. Inviting an Interviewer and Scheduler to a
-- branch therefore passed the permission check and then failed in Postgres
-- with 23514, surfaced on the live site as "Scope is not allowed.".
-- Drop and re-add the check with the role included. Before applying on the
-- live database, run:
--   SELECT * FROM user_roles WHERE role_code = 'INTERVIEWER_SCHEDULER' AND branch_id IS NULL;
-- The old check let a branch-less INTERVIEWER_SCHEDULER row through (both
-- sides false), so if that query returns rows, give those users a branch
-- first — otherwise ADD CONSTRAINT fails. No seeded or test data creates
-- such a row, and every live invite with a branch was rejected, so in
-- practice the table should be clean for this role.
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_branch_scope";
--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_branch_scope" CHECK (("user_roles"."role_code" in ('BRANCH_ADMIN', 'VERIFIER', 'INTERVIEWER_SCHEDULER', 'STAFF')) = ("user_roles"."branch_id" is not null));
