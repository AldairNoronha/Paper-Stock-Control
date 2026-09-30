# Leitura das partes importantes — validação de 30/09/2026

## Uso no celular

1. Selecione o fornecedor antes de iniciar, caso o logotipo não caiba no recorte.
2. Escolha Material, Quantidade de folhas, Dimensões ou Lote/pallet.
3. Aproxime somente a região correspondente e mantenha parada por duas leituras.
4. O leitor mostra o valor coletado e preserva os demais campos. Auto retoma a sequência.
5. Abra os complementos para área, produção, validade, pedido/número do pallet ou SSCC.
6. Revise todos os valores contra a etiqueta; fornecedor selecionado é uma informação manual.

Os alvos manuais permanecem ativos até o operador escolher outro. A moldura e o recorte
de processamento usam a mesma altura variável por campo e respeitam o vídeo visível.
Letras e números de outros campos não são coletados indiscriminadamente pelo OCR.
QR/barras continuam como fonte complementar, sem requisito para iniciar o OCR.

## O que mudou

- Tesseract retorna posições e confiança das palavras, além do texto. Cabeçalhos são
  associados aos números abaixo, na mesma coluna, em vez da ordem do texto linear.
- A tabela Schattdecor pode ter Comprimento 1860 e Largura 2760. Rótulos legíveis
  prevalecem sobre ordenar automaticamente a menor medida como largura.
- Se um cabeçalho falhar, a outra medida só é recuperada de um único número na mesma
  linha, excluindo folhas. Caso ambíguo fica pendente, não vira 1201 mm por acaso.
- Nomes grandes em duas linhas, como BRANCO NÓRDICO IMP, são lidos em um bloco próprio.
- Peso não é usado como folhas quando seu cabeçalho está presente. Um único número
  isolado, apontado no alvo folhas, é uma hipótese de baixa confiança para revisão.
- Um lote D com ruído alfabético final pode ser relido com alfabeto numérico. Só é
  aceito se TODOS os dígitos das duas leituras coincidirem; confiança limitada a 65%.
- Pedido e número do pallet são campos separados. Nunca substituem lote, código
  completo do pallet ou SSCC para validar identificação/duplicidade.
- Os novos campos são guardados no registro da leitura e, depois da revisão, em
  `raw_label_payload.reviewed_fields` do recebimento. Não houve migração de tabelas.
- A API aceita evidências dos novos alvos área, produção, validade e referência.

Referência técnica: [API oficial do Tesseract.js](https://github.com/naptha/tesseract.js/blob/master/docs/api.md#workerrecognizeimage-options-output-jobid-promise),
com saída `blocks` e posições de palavras. A tipagem da versão 7 instalada foi conferida.

## Testes na imagem marcada fornecida

Os dois exemplos da montagem foram recortados separadamente; não se misturaram etiquetas.
O OCR foi executado de verdade, sem fornecer QR/barras ou valores esperados ao parser.

| Etiqueta | Valores recuperados nas regiões destacadas | Pendências |
| --- | --- | --- |
| Impress | PAU FERRO; 950 folhas; 1860 × 2760; 4.876,92 m²; produção 12/09/2026; validade 11/12/2026; pedido 102893/130 | Hora apareceu como 47:14:31 e foi rejeitada; número 2 não foi recuperado. Identificadores completos fora dos destaques não foram inferidos. |
| Schattdecor | BRANCO NÓRDICO IMP; 1201 folhas; comprimento 1860 e largura 2760; lote D009260228; 6165,45 m² | Pallet 5-5326-B veio danificado e permaneceu pendente. |

Teste adicional da interface: vídeo simulado 640 × 480 com recortes desta mesma foto,
tela 390 × 844, seleção manual dos alvos e fornecedor Schattdecor. Material, folhas,
as duas medidas, lote e área foram coletados, com zero QR e zero barras. Revisão abriu
sem erros JavaScript e sem transbordamento horizontal. Confiança global 75%, não 100%.

Testes unitários cobrem ordem variável das colunas, ambiguidade entre colunas, peso,
pedido versus lote, hora inválida e recusa quando a releitura muda qualquer dígito.
Ainda é necessário testar câmera, foco, reflexos e tempo de processamento no Android real.
Esta melhoria não garante leitura integral de todas as fotos nem libera uso operacional
sem revisão humana. O modo público permanece local e não envia imagens ao estoque.
