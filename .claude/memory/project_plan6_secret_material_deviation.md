---
name: Plan 6 spec deviation — secret_material jsonb (shipped)
description: Plan 6 webhooks shipped 2026-04-29 with the secret_material jsonb deviation accepted (PR #1). Spec §4.1 secret_hash is replaced by secret_material in code AND in the spec amendment recorded in the plan.
type: project
---

Plan 6 (webhooks, drafted 2026-04-29) replaces spec §4.1's `webhook_sources.secret_hash text` with `secret_material jsonb` carrying one of two shapes.

**Why:** Generic / Sentry / Datadog all verify inbound webhooks via HMAC SHA-256 over the raw request body. Computing the HMAC requires the plaintext secret server-side at verify time. Bcrypt is a one-way hash — once you bcrypt the secret, you can never re-derive plaintext to compute HMAC, and you'd be reduced to bcrypt-comparing the inbound HMAC against a stored bcrypt of the *expected HMAC* per request, which is incoherent. Grafana is the lone exception — its webhook auth is a bearer token in `Authorization: Bearer <secret>`, which IS bcrypt-comparable directly.

**Resolution:** `secret_material` is jsonb with discriminator `kind`:
- `{ kind: 'aes', ciphertextB64, ivB64, tagB64 }` — for HMAC sources (generic / sentry / datadog). Encrypted with AES-256-GCM using `WEBHOOK_SECRET_ENCRYPTION_KEY` (new env var, 32-byte base64). Decrypted in memory at verify time, never persisted in plaintext.
- `{ kind: 'bcrypt', hash }` — for Grafana bearer tokens. Direct bcrypt compare.

**How to apply:**
- If the secret_material approach gets approved on PER-38, no further edits to the plan are needed — the deviation is already coded into Tasks 1, 5, 10 of the plan.
- If user prefers per-source columns (`secret_aes_ct`, `secret_bcrypt_hash`), edit the schema task and the queries task; the adapters don't care about storage shape.
- Do NOT regress to plain `secret_hash` (bcrypt-only) without changing the adapter contract — HMAC verification will silently fail on every inbound webhook.

**Linear:** PER-38 (https://linear.app/data4ward/issue/PER-38).
