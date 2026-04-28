import { signOut } from '@/lib/auth';

interface Props {
  user: { name: string; email: string };
}

export function Header({ user }: Props) {
  return (
    <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3">
      <div className="text-sm text-neutral-600">{user.email}</div>
      <form
        action={async () => {
          'use server';
          await signOut({ redirectTo: '/signin' });
        }}
      >
        <button type="submit" className="text-sm text-neutral-500 hover:text-neutral-900">
          Sign out
        </button>
      </form>
    </header>
  );
}
