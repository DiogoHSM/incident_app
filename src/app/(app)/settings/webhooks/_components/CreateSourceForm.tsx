'use client';

import { createSourceAction } from '../actions';

interface Props {
  teams: Array<{ id: string; name: string }>;
  servicesByTeam: Record<string, Array<{ id: string; name: string }>>;
}

export function CreateSourceForm({ teams, servicesByTeam }: Props) {
  return (
    <form action={createSourceAction} className="border rounded p-4 space-y-3 max-w-xl">
      <h3 className="font-semibold">Create webhook source</h3>

      <label className="block">
        <span className="text-sm">Team</span>
        <select name="teamId" required className="block w-full border rounded px-2 py-1">
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm">Type</span>
        <select name="type" required className="block w-full border rounded px-2 py-1">
          <option value="generic">Generic (HMAC SHA-256)</option>
          <option value="sentry">Sentry</option>
          <option value="datadog">Datadog</option>
          <option value="grafana">Grafana</option>
        </select>
      </label>

      <label className="block">
        <span className="text-sm">Name</span>
        <input
          type="text"
          name="name"
          required
          maxLength={200}
          className="block w-full border rounded px-2 py-1"
          placeholder="e.g. sentry-prod"
        />
      </label>

      <label className="block">
        <span className="text-sm">Default severity</span>
        <select
          name="defaultSeverity"
          required
          defaultValue="SEV3"
          className="block w-full border rounded px-2 py-1"
        >
          <option value="SEV1">SEV1</option>
          <option value="SEV2">SEV2</option>
          <option value="SEV3">SEV3</option>
          <option value="SEV4">SEV4</option>
        </select>
      </label>

      <label className="block">
        <span className="text-sm">Default service (fallback when payload identifies none)</span>
        <select name="defaultServiceId" className="block w-full border rounded px-2 py-1">
          <option value="">— none —</option>
          {Object.entries(servicesByTeam).flatMap(([tid, list]) =>
            list.map((s) => (
              <option key={s.id} value={s.id} data-team-id={tid}>
                {s.name}
              </option>
            )),
          )}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm">Auto-promote threshold</span>
          <input
            type="number"
            name="autoPromoteThreshold"
            defaultValue={3}
            min={1}
            max={100}
            className="block w-full border rounded px-2 py-1"
          />
        </label>
        <label className="block">
          <span className="text-sm">Auto-promote window (seconds)</span>
          <input
            type="number"
            name="autoPromoteWindowSeconds"
            defaultValue={600}
            min={60}
            max={86_400}
            className="block w-full border rounded px-2 py-1"
          />
        </label>
      </div>

      <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded text-sm">
        Create
      </button>
    </form>
  );
}
