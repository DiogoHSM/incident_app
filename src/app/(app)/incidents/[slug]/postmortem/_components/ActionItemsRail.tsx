'use client';

interface Props {
  postmortemId: string;
  slug: string;
  items: { id: string; title: string }[];
  teamMembers: { id: string; name: string | null }[];
}

// Stub: real form + per-row mutations land in Task 11. Other props are part of
// the contract but unused at this stage; full destructure happens in Task 11.
export function ActionItemsRail({ items }: Props) {
  if (items.length === 0) {
    return <p className="text-sm text-neutral-500">No action items yet.</p>;
  }
  return (
    <ul className="space-y-1 text-sm">
      {items.map((i) => (
        <li key={i.id}>{i.title}</li>
      ))}
    </ul>
  );
}
