import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { authConfig } from './config';
import { db } from '@/lib/db/client';
import { env } from '@/lib/env';
import { provisionUserOnSignIn } from './provision';

const providers: NextAuthConfig['providers'] =
  env.AUTH_PROVIDER === 'dev'
    ? [
        Credentials({
          name: 'Dev offline',
          credentials: {
            email: { label: 'Email', type: 'email' },
          },
          authorize(raw) {
            const email = typeof raw?.email === 'string' ? raw.email.trim().toLowerCase() : '';
            if (!email || !email.includes('@')) return null;
            // Placeholder role — the signIn callback overwrites it with the
            // value returned by provisionUserOnSignIn (which honours ADMIN_EMAILS).
            return {
              id: `dev:${email}`,
              email,
              name: email,
              role: 'member',
            };
          },
        }),
      ]
    : [
        Google({
          clientId: env.AUTH_GOOGLE_CLIENT_ID!,
          clientSecret: env.AUTH_GOOGLE_CLIENT_SECRET!,
        }),
      ];

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      if (!user.email || !account?.providerAccountId) return false;
      const provisioned = await provisionUserOnSignIn(db, {
        email: user.email,
        name: user.name ?? user.email,
        ssoSubject: account.providerAccountId,
        adminEmails: env.ADMIN_EMAILS,
      });
      user.id = provisioned.id;
      (user as { role?: 'admin' | 'member' }).role = provisioned.role;
      return true;
    },
  },
});
