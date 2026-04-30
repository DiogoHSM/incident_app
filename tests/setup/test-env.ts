// Prefer the testcontainer URL (set by global.ts) so that the global `db`
// singleton in @/lib/db/client connects to the same DB as test helpers.
process.env.DATABASE_URL ||=
  process.env.TEST_DATABASE_URL ?? 'postgres://test:test@localhost:5433/test';
process.env.AUTH_SECRET ||= 'a'.repeat(32);
process.env.AUTH_URL ||= 'http://localhost:3000';
process.env.AUTH_PROVIDER ||= 'google';
process.env.AUTH_GOOGLE_CLIENT_ID ||= 'test-google-client-id';
process.env.AUTH_GOOGLE_CLIENT_SECRET ||= 'test-google-client-secret';
