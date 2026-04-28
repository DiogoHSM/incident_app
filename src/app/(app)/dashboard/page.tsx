import { auth } from '@/lib/auth';

export default async function Dashboard() {
  const session = await auth();
  return (
    <div>
      <h1 className="text-2xl font-semibold">
        Welcome, {session?.user.name ?? session?.user.email}
      </h1>
      <p className="mt-2 text-sm text-neutral-500">Foundation phase. No incidents yet.</p>
    </div>
  );
}
