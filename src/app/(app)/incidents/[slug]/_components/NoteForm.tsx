'use client';

import { useRef, useState } from 'react';
import { addNoteAction } from '../actions';
import { useIncidentLive } from './IncidentLiveProvider';

export interface NoteFormProps {
  slug: string;
  currentUserId: string;
}

export function NoteForm({ slug, currentUserId }: NoteFormProps): React.JSX.Element {
  const { addOptimisticNote, markOptimisticError, events } = useIncidentLive();
  const [pending, setPending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  async function onSubmit(form: FormData) {
    const markdown = String(form.get('markdown') ?? '').trim();
    if (!markdown) return;

    const optimisticId = addOptimisticNote({ markdown, authorUserId: currentUserId });
    setPending(true);
    if (textareaRef.current) textareaRef.current.value = '';

    // Fail-safe: if no canonical event echoes in 5 s, mark the optimistic
    // entry as errored. The provider's reconcileOptimistic clears the
    // pending entry on echo, so this will only ever fire when the round-trip
    // genuinely failed.
    const timeout = setTimeout(() => {
      const stillPending = events.some((e) => e.source === 'optimistic' && e.id === optimisticId);
      if (stillPending) markOptimisticError(optimisticId, 'Server did not confirm — try again.');
    }, 5_000);

    try {
      await addNoteAction(form);
    } catch (err) {
      markOptimisticError(optimisticId, err instanceof Error ? err.message : 'Failed to post.');
    } finally {
      clearTimeout(timeout);
      setPending(false);
    }
  }

  return (
    <form action={onSubmit} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <textarea
        ref={textareaRef}
        name="markdown"
        rows={3}
        required
        maxLength={50_000}
        className="w-full rounded border border-neutral-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
        placeholder="Post a note (markdown supported)…"
      />
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-neutral-300"
        >
          {pending ? 'Posting…' : 'Post note'}
        </button>
      </div>
    </form>
  );
}
