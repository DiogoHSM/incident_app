'use client';

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { MeanDurationPoint } from '@/lib/metrics/types';

interface Props {
  data: MeanDurationPoint[];
}

function formatMinutes(ms: number | null): string {
  if (ms === null) return '—';
  return `${Math.round(ms / 60000)}m`;
}

export function MTTRChart({ data }: Props) {
  const allEmpty = data.every((d) => d.meanMs === null);
  if (allEmpty) {
    return (
      <div className="flex h-64 items-center justify-center rounded border border-dashed border-neutral-200 text-sm text-neutral-500">
        No resolved incidents in window.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="date" fontSize={11} />
        <YAxis fontSize={11} domain={[0, 'dataMax']} tickFormatter={(v) => formatMinutes(v)} />
        <Tooltip formatter={(value) => [formatMinutes(value as number), 'MTTR']} />
        <Line
          type="monotone"
          dataKey="meanMs"
          stroke="#0ea5e9"
          strokeWidth={2}
          dot={{ r: 3 }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
