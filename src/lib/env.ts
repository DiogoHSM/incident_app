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
    AUTH_PROVIDER: z.enum(['google', 'dev']),
    AUTH_GOOGLE_CLIENT_ID: z.string().optional(),
    AUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),
    WEBHOOK_SECRET_ENCRYPTION_KEY: z
      .string()
      .min(1)
      .refine(
        (v) => {
          try {
            return Buffer.from(v, 'base64').length === 32;
          } catch {
            return false;
          }
        },
        { message: 'WEBHOOK_SECRET_ENCRYPTION_KEY must be base64-encoded 32 bytes' },
      ),
  })
  .refine(
    (v) => v.AUTH_PROVIDER !== 'google' || (v.AUTH_GOOGLE_CLIENT_ID && v.AUTH_GOOGLE_CLIENT_SECRET),
    {
      message:
        'AUTH_GOOGLE_CLIENT_ID and AUTH_GOOGLE_CLIENT_SECRET required when AUTH_PROVIDER=google',
    },
  );

export const env = schema.parse(process.env);
