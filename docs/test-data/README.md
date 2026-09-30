# Dados de teste de etiquetas

As amostras precisam manter foto, payload lido e ground truth do mesmo pallet.

- A foto Schattdecor enviada mostra CONVÉS, 850 folhas e lote D009247388.
- O payload textual de ASFALTO, 800 folhas e lote D009247968 é outra amostra.
- A Interprint permanece `needs_physical_validation`: 1865 × 2765 × 1060 resulta em
  5.466,128 m², enquanto a foto declara 5.466,32 m² e uma dimensão está danificada.

Nenhuma amostra incerta deve ser marcada como ground truth aprovado.

## Matriz do scanner guiado

Os testes automatizados cobrem a fusão incremental usando os valores verificados acima:

- QR Impress preenche material, pallet, quantidade, dimensões e datas em uma leitura;
- Schattdecor exige duas observações OCR iguais antes de aceitar material, folhas e medidas;
- código de barras continua tendo prioridade para lote;
- os recortes podem chegar em qualquer ordem e são acumulados na mesma sessão;
- a confirmação de entrada permanece bloqueada enquanto faltar campo crítico.

O aceite físico exige execução em celular real porque foco, reflexo, câmera, zoom e
lanterna não são reproduzidos de forma confiável pelo navegador automatizado.
