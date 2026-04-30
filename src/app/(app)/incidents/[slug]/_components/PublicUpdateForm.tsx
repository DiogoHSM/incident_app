'use client';

import { useState, useTransition } from 'react';
import { postPublicUpdateAction } from '../actions';

interface Props {
  slug: string;
}

export function PublicUpdateForm({ slug }: Props): React.JSX.Element {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      try {
        await postPublicUpdateAction(slug, formData);
        setMessage('');
      } catch (e) {
        setError((e as Error).message ?? 'Failed to post');
      }
    });
  };

  return (
    <form action={onSubmit} className="space-y-2">
      <label className="block text-xs font-medium text-neutral-600">
        Post update to /status
      </label>
      <textarea
        name="message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={5000}
        required
        rows={3}
        placeholder="Public-facing message (no internal jargon — appears on /status)"
        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending || message.trim().length === 0}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          {pending ? 'Posting…' : 'Post to /status'}
        </button>
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>
    </form>
  );
}
