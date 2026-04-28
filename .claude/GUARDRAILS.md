# Guardrails — incident_app

> **Sempre carregado.** Único contrato de *lazy loading* do projeto: diz a Claude quais docs ler antes de tocar em cada área. Docs não listados aqui só são lidos quando Claude os abrir explicitamente.

**Última revisão**: 2026-04-28

> ⚠️ Projeto recém-iniciado — sem código ainda. A tabela abaixo deve ser podada e adaptada assim que a stack for definida (frontend/backend, cloud provider, banco, etc.).

---

## Antes de editar

Antes de modificar um arquivo que se encaixe numa categoria, **leia o(s) doc(s) correspondente(s)** — mesmo que pareça óbvio.

**Se o doc não existir ainda**: leia `~/.claude/templates/docs/<NOME>.md`, crie `.claude/docs/<NOME>.md` preenchendo com conhecimento real do projeto, e **só depois** prossiga com a edição.

| Ao tocar em… | Leia antes | Por quê |
|---|---|---|
| Escopo, objetivo, problema que o app resolve | `PROJECT-SUMMARY.md` | alinhamento de visão antes de codificar |
| Escolha de stack, framework, deps iniciais (`package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, etc.) | `STACK.md`, `DECISIONS.md` | registrar a escolha como ADR |
| Decisão arquitetural (estrutura de módulos, padrão de comunicação, persistência) | `DECISIONS.md`, `ARCHITECTURE.md` | rastreabilidade desde o dia zero |
| Variáveis de ambiente, secrets, arquivos `.env*` | `SECRETS.md` | garantir consistência entre ambientes |
| Migrations, schema, índices, seeds | `DECISIONS.md`, `CONSTRAINTS.md`, `ARCHITECTURE.md` | mudanças de dados são irreversíveis |
| Deploy, CI, workflows | `DEPLOYMENT.md`, `INFRASTRUCTURE.md` | evitar deploy no ambiente errado |
| Design system, componentes UI (se houver frontend) | `UI-UX.md` | coerência visual |

---

## Antes de executar ações destrutivas ou irreversíveis

Pare e confirme com o usuário se qualquer item abaixo falhar:

- [ ] `bash ~/.claude/scripts/check-context.sh` sem 🔴
- [ ] Se cloud (deploy, delete, drop): projeto/org ativo bate com `INFRASTRUCTURE.md`
- [ ] Se banco: backup recente + migration testada localmente
- [ ] Se branch protegida ou remoto compartilhado: usuário autorizou esta operação específica

Ações destrutivas: `rm -rf`, `DROP TABLE`, `gcloud * delete`, `supabase * delete`, `vercel * rm`, `firebase * delete`, `git push --force`, `git reset --hard`, apagar branches, amend em commits publicados, deploy em produção.

---

## Atualização contínua

- **A cada doc criado/removido** em `.claude/docs/`: atualize a tabela acima.
- **Sempre que descobrir nova área de risco** não coberta: adicione uma linha.
- **Mantenha curto**: este arquivo é carregado em toda sessão.
