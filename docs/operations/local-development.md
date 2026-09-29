# Desenvolvimento local

## Ordem de inicialização

1. Ative o ambiente Python.
2. Execute `pnpm infra:start`.
3. Atualize `.env` com as chaves de `pnpm exec supabase status`.
4. Execute `pnpm db:upgrade`.
5. Inicie API e web.

## Teste pelo celular na rede local

API e Vite escutam em todas as interfaces de rede. Descubra o IPv4 do computador com
`ipconfig`, substitua `localhost` por esse endereço em `VITE_API_BASE_URL` e acrescente
`http://<IP>:5173` em `CORS_ORIGINS`. Depois execute:

```powershell
pnpm dev:api
pnpm dev:web
```

Com o celular na mesma rede Wi-Fi, abra `http://<IP>:5173`. O endereço pode mudar
quando o computador reconectar à rede. Se a página não abrir, autorize Node/Python nas
regras de entrada do Firewall do Windows para a rede atual.

## Diagnóstico

- `GET /api/v1/health/live` prova que o processo da API está vivo.
- `GET /api/v1/health/ready` também executa `SELECT 1` no PostgreSQL.
- `pnpm exec supabase status` mostra portas e credenciais locais.

## Reset local

O reset do Supabase remove dados locais. Antes de executá-lo, confirme que o projeto
selecionado é o ambiente local. Depois do reset, aplique novamente `pnpm db:upgrade`.

Não use comandos de reset em produção.
