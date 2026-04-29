import { type Severity } from '@/lib/db/schema/services';

const STYLES: Record<Severity, string> = {
  SEV1: 'bg-red-100 text-red-800 ring-red-200',
  SEV2: 'bg-orange-100 text-orange-800 ring-orange-200',
  SEV3: 'bg-amber-100 text-amber-800 ring-amber-200',
  SEV4: 'bg-neutral-100 text-neutral-700 ring-neutral-200',
};

export function SeverityPill({ value }: { value: Severity }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[value]}`}
    >
      {value}
    </span>
  );
}
