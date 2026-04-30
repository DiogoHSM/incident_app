'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import type { BucketRow } from '@/lib/metrics/types';

interface Props {
  data: BucketRow[];
}

const SEV_COLOR: Record<'SEV1' | 'SEV2' | 'SEV3' | 'SEV4', string> = {
  SEV1: '#ef4444',
  SEV2: '#f97316',
  SEV3: '#eab308',
  SEV4: '#84cc16',
};

export function FrequencyChart({ data }: Props) {
  const total = data.reduce((s, d) => s + d.total, 0);
  if (total === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded border border-dashed border-neutral-200 text-sm text-neutral-500">
        No incidents in window.
      </div>
    );
  }
  const flat = data.map((d) => ({
    date: d.date,
    SEV1: d.bySeverity.SEV1,
    SEV2: d.bySeverity.SEV2,
    SEV3: d.bySeverity.SEV3,
    SEV4: d.bySeverity.SEV4,
  }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={flat} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="date" fontSize={11} />
        <YAxis fontSize={11} domain={[0, 'dataMax']} allowDecimals={false} />
        <Tooltip />
        <Legend />
        <Bar dataKey="SEV1" stackId="s" fill={SEV_COLOR.SEV1} isAnimationActive={false} />
        <Bar dataKey="SEV2" stackId="s" fill={SEV_COLOR.SEV2} isAnimationActive={false} />
        <Bar dataKey="SEV3" stackId="s" fill={SEV_COLOR.SEV3} isAnimationActive={false} />
        <Bar dataKey="SEV4" stackId="s" fill={SEV_COLOR.SEV4} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
