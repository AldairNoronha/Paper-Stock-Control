# Operação da Fase 3B

A Fase 3B conecta a leitura local à API. A foto é enviada somente depois da revisão
humana, armazenada no bucket privado `label-images`, registrada em `label_scans` e
vinculada ao pallet criado pelo recebimento transacional.

## Pré-requisitos no Supabase

1. Rotacione qualquer secret key que tenha sido compartilhada fora do gerenciador de
   segredos.
2. Crie um bucket privado chamado `label-images`, limite de 10 MiB e MIME types
   `image/jpeg`, `image/png` e `image/webp`.
3. Aplique as migrations com `python -m alembic -c apps/api/alembic.ini upgrade head`.
4. Crie o usuário no Supabase Auth e habilite o perfil com
   `python -m scripts.bootstrap_admin <UUID> "Nome" --email <email>` a partir de
   `apps/api`. Para operadores, associe a role `OPERATOR` no banco.

O browser nunca recebe `SUPABASE_SECRET_KEY`. O upload passa pela FastAPI, que mantém
a chave somente no servidor e grava em caminho imutável por usuário e scan.

## Deploy da API no Render

O arquivo `render.yaml` contém o serviço FastAPI. No Render, crie um Blueprint para o
repositório e preencha:

- `DATABASE_URL`: conexão PostgreSQL com `postgresql+asyncpg://`;
- `SUPABASE_URL`;
- `SUPABASE_JWKS_URL`;
- `SUPABASE_SECRET_KEY`.

O start command aplica Alembic antes de iniciar o Uvicorn. No plano gratuito, a primeira
requisição após inatividade pode demorar enquanto o serviço acorda.

## Ativar o modo operacional no GitHub Pages

Cadastre estas **GitHub Actions variables**, nunca como texto no código:

- `VITE_API_BASE_URL=https://<serviço>.onrender.com/api/v1`
- `VITE_SUPABASE_URL=https://<projeto>.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>`

Um novo deploy do Pages passará a exigir login. Sem essas três variáveis, o frontend
continua no modo piloto e não altera estoque.

## Fluxo e garantias

1. câmera → qualidade → códigos → OCR → revisão;
2. login do operador;
3. escolha de material interno mapeado e localização;
4. upload privado da imagem e persistência das evidências por campo;
5. recebimento com `Idempotency-Key`;
6. scan marcado como `CONFIRMED` e vinculado ao pallet.

Fotos idênticas são rejeitadas por SHA-256. O recebimento também rejeita código de pallet
ou SSCC já cadastrado para o mesmo fornecedor. Se a gravação no banco falhar depois do
upload, a API tenta remover o objeto para não deixar arquivo órfão.
