import type { StatusSnapshotPayload } from '@/lib/status/payload';

export function StatusBanner({
  payload,
}: {
  payload: StatusSnapshotPayload;
}): React.JSX.Element {
  let level: 'green' | 'yellow' | 'red' = 'green';
  for (const s of payload.services) {
    if (s.status === 'major_outage') {
      level = 'red';
      break;
    }
    if (s.status === 'partial_outage' || s.status === 'degraded') {
      level = 'yellow';
    }
  }

  const label =
    level === 'red'
      ? 'Major outage'
      : level === 'yellow'
        ? 'Some systems degraded'
        : 'All systems operational';

  const klass =
    level === 'red'
      ? 'bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-100'
      : level === 'yellow'
        ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100'
        : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100';

  return (
    <section
      className={`mb-6 rounded-md px-4 py-3 text-sm font-medium ${klass}`}
      role="status"
    >
      {label}
    </section>
  );
}
