import { z } from 'zod';

export const adminEmailsSchema = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );

const schema = z
  .object({
    DATABASE_URL: z.string().url(),
    ADMIN_EMAILS: adminEmailsSchema,
    AUTH_SECRET: z.string().min(32),
    AUTH_URL: z.string().url(),
    AUTH_PROVIDER: z.enum(['google']),
    AUTH_GOOGLE_CLIENT_ID: z.string().optional(),
    AUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),
  })
  .refine(
    (v) => v.AUTH_PROVIDER !== 'google' || (v.AUTH_GOOGLE_CLIENT_ID && v.AUTH_GOOGLE_CLIENT_SECRET),
    {
      message:
        'AUTH_GOOGLE_CLIENT_ID and AUTH_GOOGLE_CLIENT_SECRET required when AUTH_PROVIDER=google',
    },
  );

export const env = schema.parse(process.env);
