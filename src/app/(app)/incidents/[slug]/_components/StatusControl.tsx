'use client';

import { useState } from 'react';
import {
  INCIDENT_STATUS_VALUES,
  type IncidentStatus,
} from '@/lib/db/schema/incidents';
import { changeStatusAction } from '../actions';

const ALLOWED: Record<IncidentStatus, IncidentStatus[]> = {
  triaging: ['investigating', 'resolved'],
  investigating: ['identified', 'monitoring', 'resolved'],
  identified: ['monitoring', 'investigating', 'resolved'],
  monitoring: ['investigating', 'resolved'],
  resolved: ['investigating'],
};

export interface StatusControlProps {
  slug: string;
  current: IncidentStatus;
  hasIc: boolean;
  teamMembers: Array<{ id: string; name: string }>;
}

export function StatusControl({ slug, current, hasIc, teamMembers }: StatusControlProps) {
  const [next, setNext] = useState<IncidentStatus>(current);
  const options = ALLOWED[current];
  const leavingTriaging = current === 'triaging' && next !== 'triaging' && next !== 'resolved';
  const needsIcPick = leavingTriaging && !hasIc;

  if (options.length === 0) return null;

  return (
    <form action={changeStatusAction} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <label className="block text-xs font-medium text-neutral-600">Update status</label>
      <select
        name="toStatus"
        value={next}
        onChange={(e) => setNext(e.target.value as IncidentStatus)}
        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
      >
        <option value={current} disabled>
          (currently {current})
        </option>
        {options.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      {needsIcPick ? (
        <select
          name="assignIcUserId"
          required
          defaultValue=""
          className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
        >
          <option value="" disabled>
            Assign Incident Commander…
          </option>
          {teamMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      ) : (
        <input type="hidden" name="assignIcUserId" value="" />
      )}
      <input
        type="text"
        name="reason"
        placeholder="Reason (optional)"
        maxLength={500}
        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
      />
      <button
        type="submit"
        disabled={next === current}
        className="w-full rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
      >
        Apply
      </button>
    </form>
  );
}

export const STATUS_OPTIONS_FOR_TEST = INCIDENT_STATUS_VALUES;
