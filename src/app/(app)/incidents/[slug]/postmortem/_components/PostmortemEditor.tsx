'use client';

interface Props {
  postmortemId: string;
  initialMarkdown: string;
  initialUpdatedAtIso: string;
}

// Stub: real autosave + collaboration lands in Task 10.
export function PostmortemEditor(props: Props) {
  return (
    <textarea
      defaultValue={props.initialMarkdown}
      data-pm-id={props.postmortemId}
      data-saved-at={props.initialUpdatedAtIso}
      className="h-96 w-full rounded border border-neutral-200 bg-white p-3 font-mono text-sm"
    />
  );
}
