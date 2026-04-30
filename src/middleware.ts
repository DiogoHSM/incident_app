// Edge-safe: imports must stay Edge-runtime compatible. Do not import from @/lib/auth (Node).
import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth/config';

const { auth } = NextAuth(authConfig);

export { auth as middleware };

export const config = {
  matcher: [
    // Skip auth on Next internals, favicon, AND any /status/* (public status page).
    '/((?!_next/static|_next/image|favicon.ico|status).*)',
  ],
};
