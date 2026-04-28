process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5433/test';
process.env.AUTH_SECRET ||= 'a'.repeat(32);
process.env.AUTH_URL ||= 'http://localhost:3000';
process.env.AUTH_PROVIDER ||= 'google';
