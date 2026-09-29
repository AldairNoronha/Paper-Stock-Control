# Paper Stock Control

Sistema independente para controle e rastreabilidade de papel melamínico por pallet.

As Fases 1 e 2 estão implementadas: fundação React/FastAPI/Supabase e núcleo
transacional de estoque com autenticação, RBAC, idempotência, rotação, auditoria e
testes concorrentes. A Fase 3A entrega um piloto móvel de leitura local de etiquetas.

## Piloto móvel de leitura (Fase 3A)

Abra <https://aldairnoronha.github.io/Paper-Stock-Control/> no celular. O piloto:

- abre a câmera traseira ou uma foto já existente;
- rejeita imagens muito pequenas, escuras, estouradas ou desfocadas;
- procura QR Code e códigos de barras com ZXing;
- executa OCR em português no próprio navegador com Tesseract.js;
- aplica parsers específicos para Impress, Schattdecor e Interprint;
- mostra origem e confiança por campo, valida a área e permite correção manual;
- salva a aprovação somente como rascunho local no aparelho.

Neste piloto a foto não é enviada ao servidor, a aprovação não cria pallet e não altera
estoque. A persistência será conectada quando a API FastAPI estiver hospedada em HTTPS.

## Arquitetura

```text
React PWA → FastAPI → serviços de domínio → PostgreSQL Supabase
     │          │                              │
     └─ Auth ───┘                              └─ Storage privado
```

- `apps/web`: aplicação React/TypeScript e PWA;
- `apps/api`: API FastAPI e módulos de negócio;
- `packages/api-client`: tipos gerados a partir do OpenAPI;
- `supabase`: configuração local de Auth, Storage e PostgreSQL;
- `docs`: arquitetura, ADRs, operação e amostras de teste.

O frontend nunca grava diretamente nas tabelas de negócio. O FastAPI é a porta de
escrita e aplica autorização, idempotência, transações e invariantes.

## Pré-requisitos

- Node.js 24;
- pnpm 12;
- Python 3.13;
- Docker Desktop;
- Git.

## Instalação local

No PowerShell:

```powershell
Copy-Item .env.example .env
pnpm install
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".\apps\api[dev]"
```

Suba o Supabase local:

```powershell
pnpm infra:start
pnpm exec supabase status
```

Copie as chaves locais exibidas pelo comando para `.env` e aplique o schema. O
Supabase local usa Docker apenas como ambiente de desenvolvimento; em produção a API
usa o projeto hospedado em `supabase.com`:

```powershell
pnpm db:upgrade
```

Inicie as aplicações em terminais separados:

```powershell
pnpm dev:api
pnpm dev:web
```

- web: <http://localhost:5173>
- API: <http://localhost:8000>
- OpenAPI: <http://localhost:8000/docs>
- Supabase Studio: <http://localhost:54323>

Também é possível executar web e API em containers após o Supabase local estar ativo:

```powershell
docker compose up --build
```

## Qualidade

Com o ambiente virtual ativado:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Validação de migration em um banco limpo:

```powershell
python -m alembic -c apps/api/alembic.ini upgrade head
python -m alembic -c apps/api/alembic.ini downgrade base
python -m alembic -c apps/api/alembic.ini upgrade head
```

## Contrato da API

O FastAPI/OpenAPI é a fonte de verdade entre Python e TypeScript. Com a API em execução:

```powershell
pnpm contracts:generate
```

O arquivo gerado fica em `packages/api-client/src/schema.d.ts`.

## Banco de dados

O Alembic é o único proprietário do schema da aplicação. Não crie um segundo histórico
em `supabase/migrations`. SQL de RLS ou Storage pode ser organizado em
`supabase/policies`, mas precisa ser aplicado por uma revision do Alembic.

O primeiro schema inclui:

- fornecedores, materiais e mapeamentos por fornecedor;
- localizações;
- pallets com projeção de saldos e constraint de conservação;
- movimentos append-only;
- scans de etiqueta e leituras por campo;
- seeds de Impress, Schattdecor e Interprint.

A segunda migration acrescenta usuários de aplicação, seis perfis, códigos de motivo,
idempotência, auditoria append-only e política FIFO/FEFO.

## Núcleo transacional (Fase 2)

Todas as rotas abaixo ficam sob `/api/v1`, exigem JWT do Supabase e aplicam RBAC:

- `POST /catalog/materials`, `/catalog/locations` e `/catalog/supplier-materials`;
- `POST /inventory/receipts`;
- `POST /inventory/pallets/{id}/issues`, `/blocks`, `/unblocks`, `/discards`,
  `/returns` e `/transfers`;
- `POST /inventory/movements/{id}/reversal`;
- `GET /inventory/stock`, `/inventory/pallets/{id}` e histórico de movimentos;
- `GET /inventory/materials/{id}/rotation-recommendation`.

Comandos de estoque exigem o header `Idempotency-Key`. O mesmo usuário, operação,
chave e payload devolve o recurso já criado; reutilizar a chave com outro payload gera
conflito.

Para habilitar o primeiro administrador, crie o usuário no Supabase Auth e execute:

```powershell
python -m scripts.bootstrap_admin <UUID_DO_USUARIO> "Nome do usuário" --email usuario@empresa.com
```

Execute o comando dentro de `apps/api`, com `DATABASE_URL` apontando para o ambiente
correto. Consulte [a operação da Fase 2](docs/operations/phase-2.md) para a matriz de
permissões e exemplos.

## Decisões importantes

- IDs internos usam UUIDv7; `PAP-000001` é apenas o código amigável;
- o QR interno usa `PSC:1:<uuid>`;
- quantidade é sempre inteira em folhas;
- dimensões são inteiros em milímetros;
- movimentos são imutáveis e estornos criam novos movimentos;
- nenhuma foto cria estoque antes da confirmação humana;
- nenhuma movimentação offline será aceita no MVP.

Consulte [a visão de arquitetura](docs/architecture/overview.md) e os
[registros de decisão](docs/adr/README.md).
