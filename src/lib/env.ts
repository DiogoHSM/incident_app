import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  ADMIN_EMAILS: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  AUTH_SECRET: z.string().min(32),
  AUTH_URL: z.string().url(),
  AUTH_PROVIDER: z.enum(['google']),
  AUTH_GOOGLE_CLIENT_ID: z.string().optional(),
  AUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),
});

export const env = schema.parse(process.env);
