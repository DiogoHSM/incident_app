'use client';

import { useIncidentLive } from './IncidentLiveProvider';

export function ConnectionBanner(): React.JSX.Element | null {
  const { connection } = useIncidentLive();
  if (connection !== 'reconnecting') return null;
  return (
    <div
      role="status"
      className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
    >
      Reconnecting…
    </div>
  );
}
