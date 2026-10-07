/** Company domain events (declaration merging into the shared event registry). */
declare module '@/domains/shared/events' {
  interface DomainEventMap {
    /** A company may now post jobs (M8) and appears to Branch Admin. */
    'company.verified': { companyId: string; branchId: string };
    /** A verified company can no longer post jobs or receive referrals (M8/M10). */
    'company.suspended': { companyId: string; branchId: string };
  }
}

export {};
