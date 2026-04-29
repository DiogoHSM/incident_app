'use client';

import { useRef } from 'react';
import { addNoteAction } from '../actions';

export function NoteForm({ slug }: { slug: string }) {
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData): Promise<void> {
    await addNoteAction(formData);
    formRef.current?.reset();
  }

  return (
    <form ref={formRef} action={handleSubmit} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <textarea
        name="markdown"
        required
        maxLength={50_000}
        rows={3}
        placeholder="Post a note (markdown supported)…"
        className="w-full rounded border border-neutral-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
      />
      <div className="flex justify-end">
        <button
          type="submit"
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Post note
        </button>
      </div>
    </form>
  );
}
