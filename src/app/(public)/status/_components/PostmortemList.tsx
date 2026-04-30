import Link from 'next/link';
import type { PublicPostmortemListItem } from '@/lib/db/queries/status-snapshot';

export function PostmortemList({
  items,
}: {
  items: PublicPostmortemListItem[];
}): React.JSX.Element {
  if (items.length === 0) return <></>;
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-semibold">Recent postmortems</h2>
      <ul className="space-y-2">
        {items.map((p) => (
          <li key={p.id} className="text-sm">
            <Link
              href={`/status/postmortems/${p.id}`}
              className="underline-offset-2 hover:underline"
            >
              {p.incidentTitle}
            </Link>
            <span className="ml-2 text-xs text-zinc-500">
              {p.publishedAt.toISOString().slice(0, 10)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
