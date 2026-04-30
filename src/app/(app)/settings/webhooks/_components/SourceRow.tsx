'use client';

import { useState } from 'react';
import { rotateSecretAction, deleteSourceAction } from '../actions';

interface Props {
  source: {
    id: string;
    type: string;
    name: string;
    defaultSeverity: string;
    autoPromoteThreshold: number;
    autoPromoteWindowSeconds: number;
    createdAt: Date;
  };
  webhookUrl: string;
}

export function SourceRow({ source, webhookUrl }: Props) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <tr className="border-b">
      <td className="px-3 py-2 font-mono text-xs">{source.type}</td>
      <td className="px-3 py-2">{source.name}</td>
      <td className="px-3 py-2">{source.defaultSeverity}</td>
      <td className="px-3 py-2 text-xs text-gray-600">
        {source.autoPromoteThreshold} alerts / {source.autoPromoteWindowSeconds}s
      </td>
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(webhookUrl);
          }}
          className="text-xs text-blue-600 hover:underline"
        >
          Copy URL
        </button>
      </td>
      <td className="px-3 py-2">
        <form action={rotateSecretAction} className="inline">
          <input type="hidden" name="sourceId" value={source.id} />
          <button type="submit" className="text-xs text-amber-700 hover:underline">
            Rotate secret
          </button>
        </form>
      </td>
      <td className="px-3 py-2">
        {confirmingDelete ? (
          <form action={deleteSourceAction} className="inline">
            <input type="hidden" name="sourceId" value={source.id} />
            <button type="submit" className="text-xs text-red-700 font-semibold">
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="text-xs ml-2"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="text-xs text-red-600 hover:underline"
          >
            Delete
          </button>
        )}
      </td>
    </tr>
  );
}
