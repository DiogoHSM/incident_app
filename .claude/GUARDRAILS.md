# Guardrails — incident_app

> **Sempre carregado.** Mapa "antes de tocar em X, leia Y" — para Claude saber qual contexto buscar antes de cada edição.

**Última revisão**: 2026-04-28 (após merge do Plan 1)

---

## Antes de editar

Antes de modificar um arquivo que se encaixe numa categoria, **leia o(s) doc(s) correspondente(s)**. Se o doc não existir, crie a partir do template indicado.

| Ao tocar em… | Leia antes | Por quê |
|---|---|---|
| Escopo, modelo de domínio, decisões de v1 | `docs/superpowers/specs/2026-04-28-incident-tracker-design.md` | Spec é a fonte de verdade — todas as decisões de Plan 1 vieram dela |
| Plano de implementação atual ou follow-ups | `docs/superpowers/plans/2026-04-28-foundation.md`, `.claude/memory/foundation_followups.md` | Itens deferidos de v1.1 já estão mapeados — não recriar |
| Schema do DB (`src/lib/db/schema/*.ts`), migrations (`drizzle/*`), seeds | spec §4.1 + `foundation_followups.md` | Mudança de dados é irreversível; várias decisões (severity tiers, FK cascade vs restrict, citext) já discutidas |
| Camada de queries (`src/lib/db/queries/*.ts`) | `CLAUDE.md` (boundary rules) + `src/lib/authz/index.ts` | Único lugar que chama Drizzle direto. Toda query que aceita `userId` precisa passar por `requireAdmin` ou `requireTeamMember` |
| Auth — `src/lib/auth/config.ts` ou `src/middleware.ts` | spec §3.4 + `eslint.config.mjs` (no-restricted-imports rule) | Edge-safe boundary. **PROIBIDO** importar `pg`, `postgres`, `drizzle-orm`, `@/lib/db/*`, `node:*`. Lint vai bloquear mesmo se você esquecer |
| Auth — `src/lib/auth/index.ts`, `src/lib/auth/provision.ts` | spec §3.4 + `foundation_followups.md` (Task 7 race condition deferred) | Lógica Node-side, faz DB lookups |
| Server Actions (`src/app/**/actions.ts`) | `foundation_followups.md` (Task 10/11 error UX gap) | Padrão atual `throw new Error(...)` cai no `error.tsx`. v1.1 vai migrar para `useFormState` retornando `{ ok: false, errors }` |
| Variáveis de ambiente, `.env.example`, `src/lib/env.ts` | `README.md` setup section + spec §3.4 | `.env.local` carrega placeholders Google em dev; `.env.example` deve refletir a forma exata. Sempre validar via zod antes de exportar |
| Componentes UI (`src/app/**/*.tsx`, `src/components/**`) | `CLAUDE.md` boundary rules | Não chamar Drizzle direto — sempre via `queries/*.ts`. Não compor authz nas rotas — confiar nos guards das queries |
| Testes integration (`tests/integration/*.test.ts`), setup (`tests/setup/db.ts`) | `CLAUDE.md` (`expectDbError`, strict-mode pattern) + `foundation_followups.md` (testcontainer scaling) | Container por arquivo hoje; precisa virar shared+savepoint antes do Plan 2 |
| Deploy, CI, GitHub Actions | (criar `.claude/docs/DEPLOYMENT.md` quando houver) | Sem CI ainda. Quando criar workflow, preencher `DEPLOYMENT.md` a partir do template |
| Stack: novas dependências em `package.json` | `CLAUDE.md` Stack section + spec §10 | Manter alinhado com Next 16 / Drizzle 0.45 / NextAuth v5 beta / Vitest 4 / pnpm |

---

## Antes de executar ações destrutivas ou irreversíveis

Pare e confirme se qualquer item abaixo falhar:

- [ ] `bash ~/.claude/scripts/check-context.sh` sem 🔴
- [ ] Se DB: backup recente; migration testada via `pnpm test` (testcontainers já valida apply); o usuário autorizou aplicar em prod
- [ ] Se push em main: tests passam (31/31); reviewer aprovou (per-task) ou usuário autorizou explicitamente
- [ ] Se publicar repo / criar resource cloud: o usuário autorizou nome e visibilidade

Destrutivas: `rm -rf`, `DROP TABLE`, `git push --force`, `git reset --hard`, apagar branches publicados, amend em commits pushed, deploy em produção, criar repo público, deletar containers/volumes Postgres com dados.

---

## Atualização contínua

- **A cada doc criado/removido** em `docs/superpowers/specs|plans/` ou `.claude/docs/`: atualize a tabela.
- **Sempre que descobrir nova área de risco** não coberta: adicione uma linha.
- **Mantenha curto**: este arquivo é carregado em toda sessão.
