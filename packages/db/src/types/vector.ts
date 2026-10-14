import { customType } from 'drizzle-orm/pg-core';

/** pgvector column (migration 0014). Driver data arrives as "[0.1,0.2,…]". */
export function vectorColumn(dimensions: number) {
  return customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    toDriver(value: number[]) {
      return `[${value.join(',')}]`;
    },
    fromDriver(value: string) {
      return value.slice(1, -1).split(',').map(Number);
    },
  });
}
