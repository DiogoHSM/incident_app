export const dynamic = 'force-static';
export const revalidate = false;

export default function StatusMaintenancePage(): React.JSX.Element {
  return (
    <article className="text-center">
      <h1 className="mb-3 text-2xl font-semibold">We&apos;re working on it</h1>
      <p className="mx-auto max-w-md text-sm text-zinc-500">
        We&apos;re temporarily unable to display live status. Updates are still
        being recorded internally; please check back shortly.
      </p>
    </article>
  );
}
