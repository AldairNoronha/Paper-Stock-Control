# Desenvolvimento local

## Ordem de inicialização

1. Ative o ambiente Python.
2. Execute `pnpm infra:start`.
3. Atualize `.env` com as chaves de `pnpm exec supabase status`.
4. Execute `pnpm db:upgrade`.
5. Inicie API e web.

## Diagnóstico

- `GET /api/v1/health/live` prova que o processo da API está vivo.
- `GET /api/v1/health/ready` também executa `SELECT 1` no PostgreSQL.
- `pnpm exec supabase status` mostra portas e credenciais locais.

## Reset local

O reset do Supabase remove dados locais. Antes de executá-lo, confirme que o projeto
selecionado é o ambiente local. Depois do reset, aplique novamente `pnpm db:upgrade`.

Não use comandos de reset em produção.

