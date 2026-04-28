import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { findServiceBySlugForUser } from '@/lib/db/queries/services';

const severities = ['SEV1', 'SEV2', 'SEV3', 'SEV4'] as const;

export default async function ServiceDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user) return null;
  const service = await findServiceBySlugForUser(db, session.user.id, slug);
  if (!service) notFound();

  return (
    <div>
      <h1 className="text-xl font-semibold">{service.name}</h1>
      <p className="mt-1 text-sm text-neutral-500">{service.description || 'No description.'}</p>

      <h2 className="mt-6 mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Runbooks
      </h2>
      <ul className="divide-y divide-neutral-200 rounded border border-neutral-200 bg-white">
        {severities.map((sev) => (
          <li key={sev}>
            <Link
              href={`/services/${slug}/runbooks/${sev}`}
              className="flex items-center justify-between px-4 py-3 hover:bg-neutral-50"
            >
              <span className="font-medium">{sev}</span>
              <span className="text-xs text-neutral-500">edit →</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
