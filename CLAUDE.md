# incident_app — Contexto para Claude Code

> Projeto recém-criado em 2026-04-28. Diretório ainda vazio — sem stack definida, sem repositório git inicializado. Antes de codificar, alinhar escopo em `.claude/docs/PROJECT-SUMMARY.md` e stack em `.claude/docs/STACK.md`.

## Documentação
A documentação completa fica em `.claude/docs/` e é criada **sob demanda** (nada de placeholders). Templates em `~/.claude/templates/docs/`.

Docs disponíveis quando criados:
- `PROJECT-SUMMARY.md` — o que o app faz
- `ARCHITECTURE.md` — arquitetura do sistema
- `STACK.md` — tecnologias e versões
- `DEPLOYMENT.md` — ambientes e CI/CD
- `CONSTRAINTS.md` — restrições e decisões não negociáveis
- `DECISIONS.md` — ADRs
- `SECRETS.md` — variáveis de ambiente (gitignored)
- `INFRASTRUCTURE.md` — mapa de serviços cloud
- `UI-UX.md` — design system (se houver frontend)

Guardrails de lazy loading: `.claude/GUARDRAILS.md`.

## Convenções locais
A definir conforme a stack for escolhida.

## Pontos de atenção
- Diretório ainda não é repositório git. Inicializar (`git init` + remote) deve ser uma das primeiras ações.
- Nome sugere domínio de "gestão de incidentes" — confirmar com o usuário antes de assumir.

## Histórico de atualizações
- 2026-04-28: Estrutura inicial (`.claude/`, `CLAUDE.md`, `GUARDRAILS.md`, `.claude/memory/MEMORY.md`).
