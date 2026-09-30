# LENHO: peso confundido com folhas e versão antiga no celular

## O que as imagens mostram

A etiqueta de `1000319913.jpg` informa material LENHO, 810 folhas, comprimento 2765 mm, largura 1865 mm, peso 1038 kg, área 4176,95 m² e lote D009235654. A tela de `1000319912.jpg` mostrava 1038 em Folhas e uma instrução de captura substituída antes desta correção. O código da versão publicada já não continha aquela instrução: tela antiga aberta/cache é uma explicação compatível, mas o estado do navegador físico não foi inspecionado.

## Correções

- Schattdecor não escolhe mais o último número sem cabeçalho como quantidade. Sem associação espacial confiável, deixa pendente. Um close-up explicitamente selecionado de uma quantidade isolada continua sendo possível, após dois quadros iguais e com confiança limitada.
- Havendo caixas de palavras, a quantidade é associada ao cabeçalho e coluna; a busca não atravessa outro cabeçalho (como Peso) para aproveitar o valor da próxima linha.
- Valores estruturados de QR/barras não são sobrescritos nem apagados por colunas OCR incompletas.
- A segunda leitura restrita de lotes também pode verificar confusão O/0, mas precisa concordar com todas as posições e o comprimento; não remove caracteres para forçar um lote válido.
- A interface identifica `Leitor 2026.09.30.2`, verifica atualização na abertura/retorno ao aplicativo e permite verificar manualmente. Uma atualização ativada é anunciada, sem recarregar o formulário até o usuário escolher Atualizar agora.
- A política de ativação existente do service worker foi preservada para evitar uma migração problemática nos celulares antigos. O aplicativo passa a controlar o registro e o aviso de recarga, sem apagar os dados locais do site.

## Verificação executada

- Testes de regressão para 810 folhas versus 1038 kg, cabeçalhos ausentes, próximo cabeçalho, quantidade ambígua e preservação de QR. Testes de aviso de atualização e concordância de releitura de lote.
- OCR real dos recortes da foto enviada, sem códigos: LENHO, 810 folhas, largura 1865 e comprimento 2765. Nos recortes de lote/área, o texto ficou danificado e os campos permaneceram pendentes. Na imagem ampla, OCR identificou D009235654; isso não implica sucesso em todo enquadramento fechado.
- Interface de câmera simulada com os pixels da foto real e OCR real: LENHO, 810, 1865 × 2765; QR 0, barras 0; lote pendente. Não é um teste de câmera Android física.
- Atualização em navegador Chromium com service worker real e build de produção: instalação inicial sem falso aviso; versão ativada sem recarga automática; seleção do fornecedor mantida até atualização explícita; layout móvel sem overflow.
- Conferência visual dos dois fluxos em viewport 390 × 844.

## Reteste no celular

Fechar todas as abas do aplicativo e reabrir o endereço publicado conectado à internet. Conferir o texto Leitor 2026.09.30.2 no topo. Se não aparecer, aguardar a verificação inicial e recarregar novamente; testar em aba anônima separa o cache da versão instalada, sem apagar os dados locais.

Escolher Schattdecor; Material: enquadrar LENHO; Quantidade: enquadrar somente Qde. de folhas e 810 (sem Peso 1038); Dimensões: enquadrar as medidas. Lote e área precisam ser revistos quando ilegíveis. Fotografar a etiqueta original, quando disponível, evita a perda adicional e padrões de interferência de fotografar uma tela.

Referência consultada: [comportamento de atualização do Vite PWA](https://vite-pwa-org.netlify.app/guide/auto-update) — o registro automático não implica recarga da interface sem integração e recarga automática pode descartar formulários. O comportamento efetivo desta implementação foi testado com o service worker gerado.
