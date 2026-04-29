# incident_app — Contexto para Claude Code

> Web-first incident coordination tool, single org, multi-team, SSO. **Plan 1 (Foundation) shipped 2026-04-28.** Repo público em https://github.com/DiogoHSM/incident_app.

## Documentação canônica

A documentação técnica vive em **dois lugares** neste projeto (não nos `.claude/docs/*.md` padrão):

| Doc | Onde | O que cobre |
|---|---|---|
| Design spec (escopo + arquitetura + decisões) | `docs/superpowers/specs/2026-04-28-incident-tracker-design.md` | Substitui PROJECT-SUMMARY + ARCHITECTURE + STACK + CONSTRAINTS + DECISIONS para v1 |
| Plano de implementação Foundation | `docs/superpowers/plans/2026-04-28-foundation.md` | Os 13 tasks do Plan 1 (Foundation) que produziram o estado atual |
| README | `README.md` | Setup local, gates, layout, checklist de aceitação manual |
| Follow-ups deferidos | `.claude/memory/foundation_followups.md` | Itens flagados por code reviews que ficaram para v1.1 |
| Guardrails (lazy loading) | `.claude/GUARDRAILS.md` | Mapa "antes de tocar em X, leia Y" |

**Não criar `.claude/docs/PROJECT-SUMMARY.md` etc.** — o design spec acima cobre. Criar apenas se a divisão por arquivo se justificar (UI-UX, INFRASTRUCTURE específicos de prod, etc.).

## Stack atual

Next.js 16 (App Router) · TypeScript strict + `noUncheckedIndexedAccess` · Tailwind v4 (CSS-first, sem `tailwind.config.ts`) · ESLint flat config (`eslint.config.mjs`) · Prettier · pnpm · Drizzle ORM 0.45 + Postgres 16 (docker-compose, port 5433) · NextAuth v5 beta com Edge/Node split + Google OIDC · Vitest 4 + testcontainers (real Postgres, sem mocks de DB) · zod em todos os boundaries.

## Convenções locais

- **Layering boundary**: `src/lib/db/queries/*.ts` é o único lugar que chama Drizzle direto. Routes, Server Actions e components importam de lá. Aplicado pelo plan e revalidado no review final do Plan 1.
- **Authz boundary**: `src/lib/authz/index.ts` (`requireAdmin`, `requireTeamMember`, `ForbiddenError`) é a fronteira de segurança. Chamada nas queries, não nas rotas.
- **Edge/Node split (NextAuth v5)**: `src/lib/auth/config.ts` é Edge-safe — proibido importar `pg`, `postgres`, `drizzle-orm`, `@/lib/db/*`, `node:*`. Aplicado por regra do ESLint (`eslint.config.mjs:17-34`, `no-restricted-imports`). `src/lib/auth/index.ts` é Node, faz o trabalho real.
- **Strict mode + Drizzle `.returning()`**: sempre `const [row] = await ...returning(); if (!row) throw new Error(...);` antes de retornar como tipo não-nulo. Padrão repetido em todas as queries.
- **Erros de DB nos testes**: Drizzle 0.45 embrulha erros em `DrizzleQueryError`. Use `expectDbError(DB_ERR_UNIQUE)` de `tests/setup/db.ts` (anda na chain `cause`) — não use `.toThrow(/duplicate/)` direto.
- **Migrations forward-only**, geradas via `pnpm db:generate`, aplicadas via `pnpm db:migrate` (passa `dotenv -e .env.local`). Migrations atuais: `0000` users/teams/team_memberships, `0001` services/runbooks.
- **Co-author trailer obrigatório** em todos os commits: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

## Pontos de atenção

- **`.env.local` carrega placeholders** para `AUTH_GOOGLE_CLIENT_ID/SECRET` (necessário para `pnpm build` passar com a refinement do env schema). Trocar por credenciais reais antes de tentar sign-in. Documentado no `.env.example` como item deferido.
- **Aviso de deprecation do middleware**: Next 16 quer `proxy.ts`, mas `middleware.ts` ainda funciona. Rename está nos follow-ups.
- **`/incidents` e `/metrics` no sidebar dão 404 hoje** — rotas ainda não existem (chegam no Plan 2/7). Decidir entre placeholder routes ou link disabled antes de mostrar para usuários.
- **Plan 2 prerequisites**: o reviewer final pediu 3 fixes antes do Plan 2 — testcontainer scaling, admin-sees-all consistency, `provisionUserOnSignIn` ON CONFLICT. Estão em `foundation_followups.md`.

## Histórico de atualizações

- 2026-04-28: Estrutura inicial (`.claude/`, `CLAUDE.md`, `GUARDRAILS.md`, `MEMORY.md`).
- 2026-04-28: **Plan 1 (Foundation) implementado e merged em main**. 26 commits, 31 testes integration passando. Repo público criado em https://github.com/DiogoHSM/incident_app. CLAUDE.md + GUARDRAILS.md atualizados para refletir stack real.
