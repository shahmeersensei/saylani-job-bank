import type { ReactNode } from 'react';
import { AccountLayout } from '../_components/role-layout';

export default function Layout({ children }: { children: ReactNode }) {
  return <AccountLayout>{children}</AccountLayout>;
}
