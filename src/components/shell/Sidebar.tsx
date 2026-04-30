'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Props {
  role: 'admin' | 'member';
}

const items: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/incidents', label: 'Incidents' },
  { href: '/services', label: 'Services' },
  { href: '/metrics', label: 'Metrics' },
];

export function Sidebar({ role }: Props) {
  const pathname = usePathname();
  return (
    <aside className="w-56 shrink-0 border-r border-neutral-200 bg-neutral-50 p-4">
      <div className="mb-6 text-sm font-semibold">incident_app</div>
      <nav className="flex flex-col gap-1 text-sm">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              data-active={active || undefined}
              className={
                active
                  ? 'rounded bg-white px-2 py-1.5 font-medium'
                  : 'rounded px-2 py-1.5 hover:bg-white'
              }
            >
              {item.label}
            </Link>
          );
        })}
        {role === 'admin' && (
          <>
            <Link
              href="/settings/teams"
              data-active={pathname.startsWith('/settings') || undefined}
              className={
                pathname.startsWith('/settings')
                  ? 'rounded bg-white px-2 py-1.5 font-medium'
                  : 'rounded px-2 py-1.5 hover:bg-white'
              }
            >
              Settings
            </Link>
            <Link
              href="/settings/webhooks"
              data-active={pathname === '/settings/webhooks' || undefined}
              className={
                pathname === '/settings/webhooks'
                  ? 'rounded bg-white px-2 py-1.5 font-medium'
                  : 'rounded px-2 py-1.5 hover:bg-white'
              }
            >
              Webhooks
            </Link>
          </>
        )}
      </nav>
    </aside>
  );
}
