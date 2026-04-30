'use client';

import { useState } from 'react';
import { dismissTriagingIncidentAction } from '../actions';

interface Props {
  incidentId: string;
  slug: string;
}

export function DismissTriagingButton({ incidentId, slug }: Props) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-red-700 hover:underline"
      >
        Dismiss as false positive
      </button>
    );
  }
  return (
    <form action={dismissTriagingIncidentAction} className="inline">
      <input type="hidden" name="incidentId" value={incidentId} />
      <input type="hidden" name="slug" value={slug} />
      <button type="submit" className="text-xs text-red-700 font-semibold">
        Confirm dismiss
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-xs ml-2"
      >
        Cancel
      </button>
    </form>
  );
}
