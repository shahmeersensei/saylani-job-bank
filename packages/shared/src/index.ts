// Install the plain-language Zod error map before any schema module is parsed.
import './zod-error';

// Contracts shared between the UI and the API (zod schemas, enums, DTO types).
export { fieldLabel, messageNamesField } from './field-label';
export { installZodErrorMap, zodIssueMessage } from './zod-error';
export * from './api';
export * from './applicant';
export * from './auth';
export * from './company';
export * from './job';
export * from './health';
export * from './master-data';
export * from './permissions';
export * from './phone';
export * from './roles';
export * from './settings';
