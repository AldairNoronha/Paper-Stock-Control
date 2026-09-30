# Leitura guiada móvel — R0 a R5

## Objetivo

Ler etiquetas compridas sem exigir uma única fotografia panorâmica. O operador percorre
a etiqueta com a câmera traseira e recebe orientação sobre o próximo campo ausente.

## Fluxo entregue

1. O operador inicia a câmera contínua em HTTPS.
2. QR, Data Matrix e códigos lineares são procurados continuamente.
3. A moldura central é avaliada quanto a luz, contraste e foco.
4. Um único worker OCR processa quadros sequencialmente, sem gravar vídeo.
5. Leituras OCR críticas precisam aparecer em dois quadros antes de serem aceitas.
6. O checklist recomenda fornecedor/material, folhas, dimensões e lote.
7. A revisão permite corrigir qualquer campo e selecionar material interno e localização.
8. A API guarda a visão geral e os melhores recortes por campo.
9. O pallet é criado somente no comando final de recebimento, com idempotência.

## Modo de teste público

Na tela de login, **Testar scanner sem entrar** abre o processamento local. Nesse modo
nenhuma imagem é enviada e nenhum estoque é alterado. O modo operacional continua
exigindo autenticação, material mapeado e localização ativa.

## Roteiro de aceite físico

Executar em Android Chrome usando as etiquetas reais Impress, Schattdecor e Interprint:

1. Abrir a aplicação publicada e selecionar o modo de teste.
2. Permitir a câmera e confirmar que a câmera traseira foi escolhida.
3. Aproximar primeiro do QR/código e confirmar vibração ou sinal visual.
4. Mover a moldura para cada campo solicitado, mantendo-a parada por dois ciclos.
5. Confirmar que o checklist preserva campos já encontrados.
6. Abrir a revisão e conferir todos os valores contra a etiqueta física.
7. Repetir com iluminação normal, reflexo moderado e lanterna quando disponível.
8. Negar a câmera e confirmar que a opção de fotografia continua disponível.

Registrar por fornecedor: tempo total, campos automáticos, correções manuais, códigos não
lidos e qualquer valor incorreto. Um valor incorreto aceito silenciosamente reprova o lote.

## Critérios para liberar o operacional

- todos os campos obrigatórios presentes antes da confirmação;
- pelo menos 95% dos códigos fisicamente legíveis encontrados;
- pelo menos 90% dos campos críticos sem digitação manual;
- nenhuma aceitação silenciosa de valor incorreto;
- objetivo de mediana de até 30 segundos por etiqueta;
- teste aprovado em pelo menos um Android real usado na operação.
