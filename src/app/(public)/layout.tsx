import type { ReactNode } from 'react';
import Link from 'next/link';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div className="mx-auto max-w-4xl">
          <Link href="/status" className="text-base font-semibold tracking-tight">
            Status
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
      <footer className="border-t border-zinc-200 px-6 py-4 text-xs text-zinc-500 dark:border-zinc-800">
        <div className="mx-auto max-w-4xl">
          Last refreshed at the time shown on each section. Auto-refreshes every 15 seconds.
        </div>
      </footer>
    </div>
  );
}
