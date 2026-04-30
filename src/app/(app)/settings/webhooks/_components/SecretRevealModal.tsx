'use client';

import { useState } from 'react';

interface Props {
  sourceId: string;
  plaintextSecret: string;
  webhookUrl: string;
}

export function SecretRevealModal({ sourceId, plaintextSecret, webhookUrl }: Props) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState<'secret' | 'url' | null>(null);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
        <h2 className="text-lg font-semibold">Webhook secret created</h2>
        <p className="text-sm text-gray-600 mt-1">
          This is the only time the secret will be displayed. Copy it now and store it in your
          provider&apos;s webhook configuration.
        </p>

        <label className="block mt-4 text-sm font-medium">Webhook URL</label>
        <div className="flex gap-2 mt-1">
          <input
            type="text"
            readOnly
            value={webhookUrl}
            className="flex-1 border rounded px-2 py-1 font-mono text-xs"
          />
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(webhookUrl);
              setCopied('url');
            }}
            className="px-3 py-1 bg-gray-200 rounded text-sm"
          >
            {copied === 'url' ? 'Copied' : 'Copy'}
          </button>
        </div>

        <label className="block mt-4 text-sm font-medium">Secret</label>
        <div className="flex gap-2 mt-1">
          <input
            type="text"
            readOnly
            value={plaintextSecret}
            className="flex-1 border rounded px-2 py-1 font-mono text-xs"
          />
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(plaintextSecret);
              setCopied('secret');
            }}
            className="px-3 py-1 bg-gray-200 rounded text-sm"
          >
            {copied === 'secret' ? 'Copied' : 'Copy'}
          </button>
        </div>

        <div className="flex justify-end mt-6">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm"
            data-source-id={sourceId}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
