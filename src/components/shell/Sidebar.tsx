import Link from 'next/link';

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
  return (
    <aside className="w-56 shrink-0 border-r border-neutral-200 bg-neutral-50 p-4">
      <div className="mb-6 text-sm font-semibold">incident_app</div>
      <nav className="flex flex-col gap-1 text-sm">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="rounded px-2 py-1.5 hover:bg-white">
            {item.label}
          </Link>
        ))}
        {role === 'admin' && (
          <Link href="/settings/teams" className="rounded px-2 py-1.5 hover:bg-white">
            Settings
          </Link>
        )}
      </nav>
    </aside>
  );
}
