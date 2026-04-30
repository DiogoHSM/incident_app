import { signIn } from '@/lib/auth';
import { env } from '@/lib/env';

export default function SignIn() {
  if (env.AUTH_PROVIDER === 'dev') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-50">
        <form
          action={async (formData: FormData) => {
            'use server';
            const email = String(formData.get('email') ?? '').trim();
            await signIn('credentials', { email, redirectTo: '/dashboard' });
          }}
          className="w-full max-w-sm space-y-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
        >
          <div>
            <h1 className="text-lg font-semibold">Dev sign-in</h1>
            <p className="mt-1 text-xs text-neutral-500">
              Offline mode. Any email works; emails listed in <code>ADMIN_EMAILS</code> get the
              admin role on first sign-in.
            </p>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-neutral-700">Email</span>
            <input
              name="email"
              type="email"
              required
              autoFocus
              defaultValue="dev-admin@local"
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-neutral-500 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded border border-neutral-900 bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Sign in
          </button>
        </form>
      </main>
    );
  }

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
