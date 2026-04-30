'use client';

import type { ServiceHeatmap } from '@/lib/metrics/types';

interface Props {
  data: ServiceHeatmap;
}

export function ServiceHeatmap({ data }: Props) {
  if (data.services.length === 0 || data.max === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded border border-dashed border-neutral-200 text-sm text-neutral-500">
        No service-tagged incidents in window.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="text-left text-neutral-500">
            <th className="px-2 py-1.5">Service</th>
            {data.severities.map((sev) => (
              <th key={sev} className="px-2 py-1.5 text-center font-medium">
                {sev}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.services.map((svc, i) => (
            <tr key={svc.id} className="border-t border-neutral-100">
              <td className="px-2 py-1.5 font-medium text-neutral-700">{svc.name}</td>
              {data.severities.map((sev, j) => {
                const cell = data.matrix[i]?.[j] ?? 0;
                const intensity = data.max === 0 ? 0 : cell / data.max;
                const bg = `rgba(239, 68, 68, ${intensity.toFixed(2)})`;
                return (
                  <td
                    key={sev}
                    className="px-2 py-1.5 text-center"
                    style={{ backgroundColor: bg }}
                    title={`${svc.name} × ${sev}: ${cell}`}
                    aria-label={`${svc.name} ${sev}: ${cell} incidents`}
                  >
                    {cell || ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
