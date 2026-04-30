interface Props {
  label: string;
  value: string;
  hint?: string;
}

export function StatCard({ label, value, hint }: Props) {
  return (
    <div className="rounded border border-neutral-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-xs text-neutral-400">{hint}</div> : null}
    </div>
  );
}
