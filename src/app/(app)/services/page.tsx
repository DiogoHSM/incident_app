import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { listServicesForUser } from '@/lib/db/queries/services';

export default async function ServicesPage() {
  const session = await auth();
  if (!session?.user) return null;
  const list = await listServicesForUser(db, session.user.id);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Services</h1>
        <Link
          href="/services/new"
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white"
        >
          New service
        </Link>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-neutral-500">No services yet. Create one to get started.</p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded border border-neutral-200 bg-white">
          {list.map((s) => (
            <li key={s.id}>
              <Link
                href={`/services/${s.slug}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-neutral-50"
              >
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-neutral-500">{s.slug}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
