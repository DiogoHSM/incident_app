import Link from 'next/link';
import { INCIDENT_STATUS_VALUES } from '@/lib/db/schema/incidents';
import { SEVERITY_VALUES } from '@/lib/db/schema/services';

interface Props {
  current: { status?: string; severity?: string; days?: string };
}

function chip(label: string, href: string, active: boolean) {
  return (
    <Link
      key={label + href}
      href={href}
      className={`rounded-full border px-3 py-1 text-xs ${
        active
          ? 'border-neutral-900 bg-neutral-900 text-white'
          : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100'
      }`}
    >
      {label}
    </Link>
  );
}

function buildHref(curr: Props['current'], patch: Record<string, string | undefined>): string {
  const merged: Record<string, string | undefined> = { ...curr, ...patch };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `/incidents?${qs}` : '/incidents';
}

export function FilterChips({ current }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-neutral-200 pb-3">
      <div className="flex items-center gap-1">
        <span className="text-xs text-neutral-500">Status:</span>
        {chip('all', buildHref(current, { status: undefined }), !current.status)}
        {INCIDENT_STATUS_VALUES.map((s) =>
          chip(s, buildHref(current, { status: s }), current.status === s),
        )}
      </div>
      <div className="flex items-center gap-1">
        <span className="text-xs text-neutral-500">Severity:</span>
        {chip('all', buildHref(current, { severity: undefined }), !current.severity)}
        {SEVERITY_VALUES.map((s) =>
          chip(s, buildHref(current, { severity: s }), current.severity === s),
        )}
      </div>
      <div className="flex items-center gap-1">
        <span className="text-xs text-neutral-500">Window:</span>
        {(
          [
            ['7d', '7'],
            ['30d', '30'],
            ['90d', '90'],
          ] as const
        ).map(([label, days]) =>
          chip(label, buildHref(current, { days }), (current.days ?? '30') === days),
        )}
      </div>
    </div>
  );
}
