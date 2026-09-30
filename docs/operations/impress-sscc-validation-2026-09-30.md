# Correção de identificação Impress e confiança — 2026-09-30

## Defeito reproduzido

O QR preenchia material, pallet, folhas e dimensões, enquanto o código de barras
permanecia ausente. O cálculo aceitava lote ou pallet, ignorava campos vazios na média,
adicionava um bônus pela área e arredondava para 100%. A revisão apresentava a leitura
como consistente e não mostrava o SSCC.

## Comportamento corrigido

- SSCC aparece separadamente do lote e do código do pallet, inclusive na revisão manual.
- Etiquetas Impress exigem SSCC válido para completar a coleta e permitir a aprovação.
- O scanner procura as barras independentemente do leitor que pode retornar o QR repetidamente.
- Na fotografia, a leitura linear também tenta faixas sobrepostas com `TRY_HARDER`.
- GS1 AI `(00)` é removido, os 18 dígitos são preservados e o dígito verificador é validado.
- OCR pode recuperar o número impresso com marcador `(00)` ou `SSCC`, mantendo origem OCR.
- QR com campos numéricos arbitrários não é convertido em SSCC pela remoção de caracteres.
- O recebimento usa o SSCC revisado, inclusive após correção manual.
- A média inclui os obrigatórios ausentes com zero; área consistente não soma confiança.
- Confiança estimada nunca é exibida como 100%; divergência de área exige revisão.
- A tela distingue quantos QR e quantos códigos de barras foram efetivamente decodificados.

O número `102410/270` da etiqueta é identificado como pedido. A foto não apresenta um
campo explícito de lote. Ele permanece desconhecido e não é substituído por pedido ou SSCC.

Referência: [identificadores de aplicação GS1](https://www.gs1.org/gs1-application-identifiers).

## Evidência e limites

Na fotografia original `WhatsApp Image 2026-09-27 at 15.01.15 (2).jpeg`, em navegador
Chromium com viewport de 390 × 844:

- SSCC `378989959000344929` recuperado pelo texto impresso, com checksum válido;
- QR e barras não decodificados na fotografia panorâmica; contadores permaneceram em zero;
- quantidade não identificada, aprovação desabilitada e leitura marcada como parcial (53%);
- código do pallet obtido por OCR com ambiguidade `I/1`, confiança baixa e indicação de revisão;
- nenhum erro de JavaScript ou conteúdo ultrapassando a largura do celular.

Os testes reproduzem separadamente o caso reportado com QR completo e SSCC ausente:
85%, revisão obrigatória e continuação da coleta. Com o SSCC válido, obrigatórios completos
e estimativa limitada a 99%. Também validam checksum incorreto, códigos conflitantes,
correção manual e envio do valor revisado à API.

Essa evidência valida a fotografia e as regras; a câmera traseira, autofoco e taxa de leitura
das barras continuam dependendo do teste no celular físico, com aproximação do código.
