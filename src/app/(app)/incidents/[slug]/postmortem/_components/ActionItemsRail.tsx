'use client';

import { useState, useTransition } from 'react';
import {
  createActionItemAction,
  deleteActionItemAction,
  updateActionItemAction,
} from '../actions';
import type { ActionItem, ActionItemStatus } from '@/lib/db/schema/action-items';
import { ACTION_ITEM_STATUS_VALUES } from '@/lib/db/schema/action-items';

interface TeamMember {
  id: string;
  name: string | null;
}

interface Props {
  postmortemId: string;
  slug: string;
  items: ActionItem[];
  teamMembers: TeamMember[];
}

export function ActionItemsRail({ postmortemId, slug, items, teamMembers }: Props) {
  const [pending, startTransition] = useTransition();
  const [draftTitle, setDraftTitle] = useState('');

  const onAdd = (formData: FormData) => {
    startTransition(async () => {
      await createActionItemAction(postmortemId, slug, formData);
      setDraftTitle('');
    });
  };

  return (
    <section className="rounded border border-neutral-200 bg-white p-3">
      <h2 className="mb-2 text-sm font-medium text-neutral-500">Action items</h2>

      <form
        action={onAdd}
        className="mb-3 flex flex-col gap-2"
      >
        <input
          name="title"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          placeholder="New action item"
          className="rounded border px-2 py-1 text-sm"
          required
          maxLength={200}
        />
        <div className="flex gap-2">
          <select
            name="assigneeUserId"
            defaultValue=""
            className="flex-1 rounded border px-2 py-1 text-sm"
          >
            <option value="">Unassigned</option>
            {teamMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name ?? '(no name)'}
              </option>
            ))}
          </select>
          <input
            name="dueDate"
            type="date"
            className="rounded border px-2 py-1 text-sm"
          />
        </div>
        <input
          name="externalUrl"
          type="url"
          placeholder="https://linear.app/…"
          className="rounded border px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={pending || draftTitle.length === 0}
          className="self-start rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          {pending ? 'Adding…' : '+ Add'}
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <ActionItemRow
            key={item.id}
            item={item}
            slug={slug}
            teamMembers={teamMembers}
          />
        ))}
        {items.length === 0 ? (
          <li className="text-xs text-neutral-500">No action items yet.</li>
        ) : null}
      </ul>
    </section>
  );
}

function ActionItemRow({
  item,
  slug,
  teamMembers,
}: {
  item: ActionItem;
  slug: string;
  teamMembers: TeamMember[];
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);

  const update = (patch: Parameters<typeof updateActionItemAction>[2]) => {
    startTransition(async () => {
      await updateActionItemAction(item.id, slug, patch);
    });
  };

  const onDelete = () => {
    if (!confirm('Delete this action item?')) return;
    startTransition(async () => {
      await deleteActionItemAction(item.id, slug);
    });
  };

  if (!editing) {
    return (
      <li className="rounded border p-2 text-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="font-medium">{item.title}</div>
            <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-neutral-500">
              <span>
                Status:{' '}
                <select
                  value={item.status}
                  disabled={pending}
                  onChange={(e) => update({ status: e.target.value as ActionItemStatus })}
                  className="rounded border px-1 py-0.5"
                >
                  {ACTION_ITEM_STATUS_VALUES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </span>
              {item.assigneeUserId ? (
                <span>
                  Assignee:{' '}
                  {teamMembers.find((m) => m.id === item.assigneeUserId)?.name ?? '(removed)'}
                </span>
              ) : null}
              {item.dueDate ? <span>Due: {item.dueDate}</span> : null}
              {item.externalUrl ? (
                <a
                  href={item.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  link
                </a>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded border px-2 py-0.5 text-xs"
            >
              edit
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="rounded border px-2 py-0.5 text-xs text-red-600"
            >
              delete
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="rounded border p-2 text-sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          update({
            title: String(fd.get('title') ?? ''),
            assigneeUserId: (fd.get('assigneeUserId') as string) || null,
            dueDate: (fd.get('dueDate') as string) || null,
            externalUrl: (fd.get('externalUrl') as string) || null,
          });
          setEditing(false);
        }}
        className="flex flex-col gap-2"
      >
        <input
          name="title"
          defaultValue={item.title}
          className="rounded border px-2 py-1"
          required
          maxLength={200}
        />
        <div className="flex gap-2">
          <select
            name="assigneeUserId"
            defaultValue={item.assigneeUserId ?? ''}
            className="flex-1 rounded border px-2 py-1"
          >
            <option value="">Unassigned</option>
            {teamMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name ?? '(no name)'}
              </option>
            ))}
          </select>
          <input
            name="dueDate"
            type="date"
            defaultValue={item.dueDate ?? ''}
            className="rounded border px-2 py-1"
          />
        </div>
        <input
          name="externalUrl"
          type="url"
          defaultValue={item.externalUrl ?? ''}
          placeholder="https://…"
          className="rounded border px-2 py-1"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-neutral-900 px-3 py-1 text-white"
          >
            save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded border px-3 py-1"
          >
            cancel
          </button>
        </div>
      </form>
    </li>
  );
}
