# Leitor V2 — foto completa e revisão

Esta versão substitui **a estratégia de captura**, não o projeto de estoque. A câmera contínua e o Tesseract no celular continuam disponíveis em “Leitor anterior”. O padrão agora é fotografar uma etiqueta inteira, enviar uma única imagem ao backend e revisar todos os campos juntos.

## O que está implementado

- Captura de foto pela câmera do celular ou seleção da galeria, sem dependência de QR.
- `POST /api/v1/labels/photo-analysis`, autorizado para OPERATOR, SUPERVISOR e ADMIN.
- Google Cloud Vision `DOCUMENT_TEXT_DETECTION` no servidor; chave nunca enviada ao navegador.
- JPEG/PNG até 10 MB e 20 megapixels, com verificação do conteúdo real, orientação EXIF corrigida e remoção de metadados antes do envio ao provedor. A foto não é recortada nem reduzida para OCR.
- Extração espacial: fornecedor, nome do papel, folhas, dimensões, lote, pallet, área declarada, peso, datas, ordem, sequência do pallet e SSCC impresso com dígito verificador.
- Cada sugestão tem texto de origem e posição na foto quando disponíveis. “Ver origem” destaca e amplia o trecho. Ausência ou conflito não é sucesso. Nenhum “100% de confiança” global.
- Conferência humana por campo; editar um valor remove sua confirmação. Conferência da área (tolerância de 0,5%, mínimo de 0,05 m²), validação de números, datas e SSCC.
- Exportação local JSON da revisão e das correções. **Não há criação de pallet, gravação no Storage ou movimento de estoque pela V2.** Guarde a foto original junto com o JSON; ela não é embutida nele. O leitor anterior continua com suas operações existentes.

## Ativar o OCR real

O Supabase continua sendo autenticação/banco/Storage. Sua chave não autentica o Google Cloud Vision.

1. Em um projeto Google Cloud, habilite a Cloud Vision API e a configuração de faturamento exigida pelo serviço. Não foi criada conta nem contratado serviço automaticamente.
2. Crie uma chave de API e restrinja seu uso à Cloud Vision API. Configure também cotas no Google; não deixe uma chave irrestrita no frontend, GitHub ou chat.
3. Nas variáveis do backend (por exemplo Render), configure:

```dotenv
LABEL_OCR_ENABLED=true
GOOGLE_VISION_API_KEY=<chave privada do Google>
LABEL_OCR_TIMEOUT_SECONDS=35
LABEL_OCR_DAILY_LIMIT=100
```

4. Publique/reinicie a API com esta versão. Confira `GET /api/v1/labels/photo-analysis/status`: `enabled: true` significa que a configuração local está presente, **não comprova que a credencial/quota funciona**.
5. No aplicativo, entre no modo operacional com usuário habilitado. Tire a foto, autorize o envio e use “Analisar foto no servidor”.

Sem configuração, o aplicativo mostra o motivo e permite revisão manual sem transmitir a imagem. Erros de autenticação, provedor ou timeout não geram valores inventados e não disparam reenvio automático.

Proteções locais: duas análises simultâneas por processo, uma por usuário, três tentativas por minuto por usuário e teto diário configurável. Esses limites reiniciam com o processo e não somam réplicas; **não substituem cotas do provedor nem são garantia de teto financeiro**. O cancelamento no celular interrompe a espera, mas uma análise já recebida pelo servidor pode terminar/consumir cota.

## Validação antes de integrar ao estoque

Os testes automatizados usam layouts e respostas do provedor **simulados**. Eles verificam contrato, regras, segurança e revisão; não são medição de acurácia de OCR. Falta uma chamada real ao Google com as credenciais do projeto e teste físico no Android.

Monte um conjunto mínimo de 30 fotos originais de etiquetas físicas (10 por fornecedor). Separe desenvolvimento e aceitação, para não ajustar regras e medir resultado nas mesmas fotos. Inclua boa luz, reflexo, inclinação e etiqueta parcialmente danificada. Evite fotos de monitor como evidência principal. Faça também um teste com QR coberto.

Para cada foto, registre uma transcrição humana independente de fornecedor, papel, folhas, dimensões e lote/pallet. Registre versão, tempo da análise, JSON bruto, correções necessárias e falhas. Campos sugeridos errados e campos ausentes contam separadamente; preenchimento manual não conta como sucesso automático.

Critérios propostos para autorizar integração ao recebimento: pelo menos 95% de acerto exato por campo crítico no conjunto reservado, nenhum peso aceito como folhas, nenhuma troca de lote/pallet/SSCC, nenhuma aprovação de dados faltantes, interface sem travamento e tempo p95 até 15 segundos com backend aquecido. São **metas de aceitação, não resultados já obtidos**. Se falhar, compare outro provedor no mesmo conjunto antes de prosseguir.

Escopo posterior, só depois de validar: associar papel ao catálogo, persistir foto/evidência privada e conectar a revisão ao recebimento existente. Não é preciso reconstruir banco, autenticação ou controle de estoque.

## Fontes do contrato utilizado

- [Método REST images.annotate](https://docs.cloud.google.com/vision/docs/reference/rest/v1/images/annotate)
- [Texto e estrutura de documentos](https://docs.cloud.google.com/vision/docs/fulltext-annotations)
- [Requisições e autenticação por chave ou OAuth](https://docs.cloud.google.com/vision/docs/request)
- [Chave em cabeçalho, não na URL](https://docs.cloud.google.com/docs/authentication/api-keys-use)

## Comandos locais

Na raiz do projeto: `python -m pip install -e "./apps/api[dev]"`, `pnpm dev:api` e `pnpm dev:web`. Configure as variáveis no `.env` ignorado pelo Git. Rode `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build`. Os testes PostgreSQL de integração continuam executados no CI com banco isolado.
