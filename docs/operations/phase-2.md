# Operação da Fase 2

## Limite Supabase

A chave publicável pode ser entregue ao navegador. A chave secreta é exclusiva do
backend e deve existir apenas no gerenciador de segredos ou no `.env` local ignorado
pelo Git. Ela não substitui a conexão PostgreSQL: para usar o banco hospedado, copie a
connection string em **Connect > Direct connection** ou **Session pooler** e converta o
prefixo para `postgresql+asyncpg://` em `DATABASE_URL`.

O backend valida o JWT pelo JWKS do projeto Supabase. `SUPABASE_JWT_SECRET` só é usado
em instalações locais/legadas que ainda assinam tokens com HS256.

## Perfis

| Operação | Perfis autorizados |
|---|---|
| Consultas | OPERATOR, QUALITY, SUPERVISOR, PCP, ADMIN, VIEWER |
| Cadastro de material/local/mapeamento | PCP, ADMIN |
| Recebimento, saída e transferência | OPERATOR, SUPERVISOR, ADMIN |
| Bloqueio, desbloqueio e descarte | QUALITY, SUPERVISOR, ADMIN |
| Retorno e estorno | SUPERVISOR, ADMIN |

Supabase Auth identifica a pessoa. `user_profiles` e `user_roles` determinam se ela
está ativa e o que pode fazer no domínio.

## Regras transacionais

- cada comando abre uma transação e bloqueia o pallet com `SELECT FOR UPDATE`;
- saldos nunca podem ficar negativos e o PostgreSQL valida a conservação total;
- movimentos e auditoria são append-only;
- um movimento só pode ser estornado uma vez;
- recebimentos com SSCC ou código de pallet repetido para o fornecedor são rejeitados;
- uma saída fora do FIFO/FEFO exige `FIFO_OVERRIDE` e justificativa em `notes`;
- transferência é integral e muda apenas a localização do pallet;
- material precisa estar previamente mapeado para o fornecedor.

## Códigos de motivo iniciais

| Código | Uso |
|---|---|
| `QUALITY_HOLD` | bloqueio |
| `QUALITY_RELEASE` | desbloqueio |
| `DAMAGED` | descarte |
| `FIFO_OVERRIDE` | saída fora da rotação |
| `OPERATIONAL_RETURN` | retorno da produção |
| `AUTHORIZED_REVERSAL` | estorno |

## Validação

O teste de integração é opt-in para evitar apontar acidentalmente para um banco real:

```powershell
$env:RUN_INTEGRATION_TESTS='1'
python -m pytest apps/api/tests -m integration
```

Use somente um PostgreSQL local ou descartável. O cenário testa o fluxo completo,
idempotência, duplicidade e duas saídas concorrentes no mesmo pallet.
