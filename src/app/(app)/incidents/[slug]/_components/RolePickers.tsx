'use client';

import { ROLE_VALUES, type IncidentRole } from '@/lib/timeline/body';
import { assignRoleAction } from '../actions';

const LABELS: Record<IncidentRole, string> = {
  ic: 'Incident Commander',
  scribe: 'Scribe',
  comms: 'Comms',
};

export interface RolePickersProps {
  slug: string;
  assignments: Record<IncidentRole, string | null>;
  teamMembers: Array<{ id: string; name: string }>;
}

export function RolePickers({ slug, assignments, teamMembers }: RolePickersProps) {
  return (
    <div className="space-y-3">
      {ROLE_VALUES.map((role) => (
        <form key={role} action={assignRoleAction} className="space-y-1">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="role" value={role} />
          <label className="block text-xs font-medium text-neutral-600">{LABELS[role]}</label>
          <div className="flex gap-1">
            <select
              name="toUserId"
              defaultValue={assignments[role] ?? ''}
              className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm"
            >
              <option value="">— unassigned —</option>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs font-medium hover:bg-neutral-50"
            >
              Set
            </button>
          </div>
        </form>
      ))}
    </div>
  );
}
