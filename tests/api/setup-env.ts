import { config } from 'dotenv';
import path from 'node:path';

// One .env at the monorepo root serves the app, the db scripts and the tests.
config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

// Validation deliberately runs (no SKIP_ENV_VALIDATION): zod coerces values like
// S3_FORCE_PATH_STYLE to a real boolean, which the AWS SDK endpoint rules require.
process.env.LOG_LEVEL ??= 'silent';
// Deterministic auth secret (mirrors the Vitest integration project).
process.env.BETTER_AUTH_SECRET ??= 'jest-secret-jest-secret-jest-secret-jest';
