import type { ReactNode } from 'react';
import { CustomersSubNav } from '../../../components/common/sub-nav';

export default function CustomersLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <CustomersSubNav />
      {children}
    </>
  );
}
