import { signIn } from '@/lib/auth';

export default function SignIn() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <form
        action={async () => {
          'use server';
          await signIn('google', { redirectTo: '/dashboard' });
        }}
      >
        <button
          type="submit"
          className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm shadow-sm hover:bg-neutral-50"
        >
          Sign in with Google
        </button>
      </form>
    </main>
  );
}
