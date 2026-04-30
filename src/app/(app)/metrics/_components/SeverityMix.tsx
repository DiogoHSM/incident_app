'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { SeverityMixRow } from '@/lib/metrics/types';

interface Props {
  data: SeverityMixRow[];
}

const SEV_COLOR: Record<'SEV1' | 'SEV2' | 'SEV3' | 'SEV4', string> = {
  SEV1: '#ef4444',
  SEV2: '#f97316',
  SEV3: '#eab308',
  SEV4: '#84cc16',
};

export function SeverityMix({ data }: Props) {
  const total = data.reduce((s, r) => s + r.count, 0);
  if (total === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded border border-dashed border-neutral-200 text-sm text-neutral-500">
        No incidents in window.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="severity"
          innerRadius={50}
          outerRadius={90}
          isAnimationActive={false}
        >
          {data.map((row) => (
            <Cell key={row.severity} fill={SEV_COLOR[row.severity]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
