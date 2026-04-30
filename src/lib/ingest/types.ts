import type { Severity } from '@/lib/db/schema/services';
import type { WebhookSource, WebhookSourceType } from '@/lib/db/schema/webhook-sources';

export type NormalizedAlert = {
  /** Short summary, used as incident title when creating. */
  title: string;
  /** Provider-specific stable identity for the alert. See spec §7.2. */
  fingerprint: string;
  /** Mapped severity, or null if the provider didn't supply one (caller falls back to source.default_severity). */
  severity: Severity | null;
  /** Service slugs derived from the payload (joined against services where team_id = source.team_id). */
  serviceSlugs: string[];
  /** Deep link back to the provider's UI for this alert, if any. */
  sourceUrl: string | null;
  /** The full payload, retained verbatim for dead-letter forensics + future replay. */
  raw: unknown;
};

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export interface Adapter {
  readonly type: WebhookSourceType;
  /**
   * Called with the raw `Request` (body NOT yet consumed) and the source row.
   * Returns ok=true if the signature/bearer matches; ok=false with a reason
   * suitable for logging (NEVER include in the HTTP response body).
   *
   * Implementations MUST NOT consume `req.body` — the route reads it as text
   * once, then passes the cloned text to `normalize`. `verify` reads only
   * headers (and, for HMAC, recomputes HMAC against the rawBody passed in).
   */
  verify(input: { headers: Headers; rawBody: string; source: WebhookSource }): Promise<VerifyResult>;
  /**
   * Pure transformation. Throws if the payload is unrecognizable.
   * The route catches the throw and writes to dead_letter_webhooks.
   */
  normalize(payload: unknown): NormalizedAlert;
}
