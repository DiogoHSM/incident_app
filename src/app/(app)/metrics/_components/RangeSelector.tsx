'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';

const PRESETS = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
] as const;

export function RangeSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const current = sp.get('range') ?? '30d';

  function pick(value: string) {
    const next = new URLSearchParams(sp.toString());
    next.set('range', value);
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
    });
  }

  return (
    <div className="inline-flex items-center gap-1 rounded border border-neutral-200 bg-white p-1 text-xs">
      {PRESETS.map((p) => {
        const selected = current === p.value;
        return (
          <button
            key={p.value}
            type="button"
            onClick={() => pick(p.value)}
            aria-pressed={selected}
            className={
              selected
                ? 'rounded bg-neutral-900 px-2.5 py-1 text-white'
                : 'rounded px-2.5 py-1 text-neutral-700 hover:bg-neutral-100'
            }
            disabled={isPending}
          >
            {p.label}
          </button>
        );
      })}
      <button
        type="button"
        disabled
        className="rounded px-2.5 py-1 text-neutral-400"
        title="Custom range arrives in v1.1"
      >
        Custom
      </button>
    </div>
  );
}
