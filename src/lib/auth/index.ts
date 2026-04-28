import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { authConfig } from './config';
import { db } from '@/lib/db/client';
import { env } from '@/lib/env';
import { provisionUserOnSignIn } from './provision';

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    Google({
      clientId: env.AUTH_GOOGLE_CLIENT_ID!,
      clientSecret: env.AUTH_GOOGLE_CLIENT_SECRET!,
    }),
  ],
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
