import type { ReactNode } from 'react';
import { TitleBlock } from './TitleBlock';

// Landing, sign-up and login: title block centered above a full-screen form (phone)
// or a 420 px card (desktop).
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))] sm:justify-center">
      <TitleBlock variant="auth" />
      <main className="mt-8 w-full max-w-[420px] sm:rounded-2xl sm:border sm:border-border sm:bg-surface sm:p-6">
        {children}
      </main>
    </div>
  );
}
