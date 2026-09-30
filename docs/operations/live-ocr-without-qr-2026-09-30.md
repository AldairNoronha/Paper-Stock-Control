# OCR contínuo sem QR — 30/09/2026

## Causa confirmada

O scanner de códigos processava o vídeo diretamente. O OCR passava por uma validação
de fotografia aplicada indevidamente à moldura: menos de 350 mil pixels ou largura
menor que 850 pixels bloqueavam o processamento. Uma câmera 1280 × 720 produzia um
recorte 1152 × 302, inferior ao limite. Em 720 × 1280, a largura da moldura era 648.
Assim, os códigos podiam funcionar enquanto o OCR nem era chamado.

## Correções

- Perfil de qualidade `live` separado de `photo`, avaliado antes da ampliação para OCR.
- OCR iniciado pelo fornecedor/material, sem aguardar QR; decodificação em paralelo.
- Recorte alinhado à moldura considerando `object-fit: cover` e orientação da tela.
- Papel majoritariamente branco com texto contrastado não é confundido com reflexo.
- Mensagens distinguem preparação, leitura, ausência de texto e confirmação pendente.
- Cabeçalhos bilíngues preservados no OCR; confirmação por dois quadros mantida.
- Confusão limitada T/I na marca Schattdecor reconhecida com confiança reduzida.
- Pallet Impress truncado e lote Schattdecor com caracteres inválidos ficam pendentes.

## Evidências e limitações

1. Testes unitários reproduzem o bloqueio anterior e verificam molduras de vídeos
   1280 × 720, 720 × 1280 e 640 × 480. Fotografias mantêm os critérios anteriores.
2. Câmera simulada com `canvas.captureStream`, vídeo 640 × 480 e tela 390 × 844:
   Tesseract real e leitores reais, sem QR/barras. Etiqueta sintética legível coletou
   SCHATTDECOR, CONVÉS, 850 folhas, 1865 × 2865 e D123456888, com revisão aberta.
   Isso valida o fluxo sem códigos; não é uma medição de acurácia em fábrica.
3. Recortes de texto da fotografia Impress enviada, sem fornecer códigos ao parser:
   material `90113 UNICOLOR IP441 2760x1860mm`, dimensões 1860 × 2760 e SSCC
   `378989959000344929` recuperados. O cabeçalho da quantidade ficou ilegível;
   o pallet apresentou separadores incorretos e foi rejeitado, não completado por suposição.
4. Fotografia panorâmica inteira mantém leitura parcial, aprovação desabilitada por
   quantidade ausente, zero QR/barras e confiança estimada de 53%, não 100%.
5. Nos testes, alguns caracteres pequenos (7/barra e 0/O) continuaram ambíguos.
   Esses casos não justificam liberação operacional nem garantem que qualquer foto funcione.

Validação física de foco, reflexos, performance e permissões no Android do operador
continua necessária. A primeira carga do OCR precisa de internet; processamento ocorre
no aparelho. Nenhuma imagem destes testes foi enviada ao estoque ou ao Supabase.
