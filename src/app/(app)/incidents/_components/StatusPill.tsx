import { type IncidentStatus } from '@/lib/db/schema/incidents';

const STYLES: Record<IncidentStatus, string> = {
  triaging: 'bg-purple-100 text-purple-800 ring-purple-200',
  investigating: 'bg-yellow-100 text-yellow-800 ring-yellow-200',
  identified: 'bg-blue-100 text-blue-800 ring-blue-200',
  monitoring: 'bg-cyan-100 text-cyan-800 ring-cyan-200',
  resolved: 'bg-green-100 text-green-800 ring-green-200',
};

export function StatusPill({ value }: { value: IncidentStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[value]}`}
    >
      {value}
    </span>
  );
}
