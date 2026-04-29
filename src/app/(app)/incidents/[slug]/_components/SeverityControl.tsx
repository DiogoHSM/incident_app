'use client';

import { SEVERITY_VALUES, type Severity } from '@/lib/db/schema/services';
import { changeSeverityAction } from '../actions';

export interface SeverityControlProps {
  slug: string;
  current: Severity;
}

export function SeverityControl({ slug, current }: SeverityControlProps) {
  return (
    <form action={changeSeverityAction} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <label className="block text-xs font-medium text-neutral-600">Change severity</label>
      <select
        name="toSeverity"
        defaultValue={current}
        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
      >
        {SEVERITY_VALUES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="w-full rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
      >
        Apply
      </button>
    </form>
  );
}
