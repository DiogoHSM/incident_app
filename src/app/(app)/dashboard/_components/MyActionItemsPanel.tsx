import type { ActionItem } from '@/lib/db/schema/action-items';

interface Props {
  rows: ActionItem[];
}

export function MyActionItemsPanel({ rows }: Props) {
  return (
    <section className="rounded border border-neutral-200 bg-white">
      <header className="border-b border-neutral-100 px-4 py-2.5 text-sm font-medium">
        My open action items
      </header>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-neutral-500">No open items. Nothing on your plate.</div>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">{r.status}</span>
              <span className="flex-1 truncate text-neutral-800">{r.title}</span>
              {r.dueDate ? <span className="text-xs text-neutral-500">due {r.dueDate}</span> : null}
              {r.externalUrl ? (
                <a href={r.externalUrl} className="text-xs text-blue-600 hover:underline" target="_blank" rel="noreferrer">
                  link
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
