# Nome em destaque na Schattdecor: LENHO

Versão: Leitor 2026.09.30.3 / SchattdecorLabelParser 1.3.0.

## Evidência e causa

Em `1000319917.jpg`, o operador enquadrou várias regiões da etiqueta. A etiqueta informa LENHO, 800 folhas, 2765 × 1865 mm e lote D009235577 (não é o lote anterior de 810 folhas).

Reprodução com o recorte amplo da captura: o OCR reconheceu `LENHO` junto de cliente, descrição e ruído. O acumulador manteve o material vazio porque o parser não reconhecia um nome comercial isolado no meio da etiqueta e o fallback destinado a um close-up recusava várias linhas misturadas. Não foi um bloqueio de foco: esse recorte passou na qualidade ao vivo. A captura seguinte apontava ao teclado desfocado; bloquear aquele quadro é apropriado.

## Mudança

A associação espacial da Schattdecor passa a aproveitar o nome comercial destacado por tamanho e posição, com limites:

- Requer contexto impresso de etiqueta, palavra legível em maiúsculas e destaque de tamanho sobre o texto menor.
- Exclui fornecedor, cliente, unidades e cabeçalhos, além da linha da empresa. Essa exclusão por linha evita tomar `LTDA` mal reconhecido como `CDA` por nome do papel.
- Junta palavras próximas e até uma segunda linha alinhada; dois blocos grandes separados permanecem ambíguos.
- Não utiliza coordenadas fixas, lista de nomes de papéis ou os valores esperados da foto no código de produção.
- Mantém a preferência por dados estruturados, a exigência de duas observações OCR e confiança estimada limitada a 75% para essa inferência. Campos críticos e aprovação continuam sujeitos a revisão.
- Não altera os limites de desfoque, luz ou resolução, nem faz suposições de quantidade a partir do peso.

## Testes executados

- OCR real do recorte amplo de `1000319917.jpg`: antes, material vazio; depois, LENHO. O OCR de quantidade e medidas pequenas continua degradado nessa reprodução.
- Câmera simulada 640 × 480 em viewport 390 × 844, pixels do mesmo recorte mantendo sua proporção, leitor OCR real, nenhum código fornecido pelo teste: confirmou LENHO por OCR após dois quadros. Quantidade, dimensões e lote permaneceram pendentes no fluxo testado; não se declara leitura completa.
- Regressores: nome comercial versus descrição, nome em duas linhas, outro nome fora desta foto, empresa/teclado, nomes concorrentes, palavra sem destaque e preferência pelo QR.
- Caso real de ruído `CDA` na linha do cliente verificado no fluxo da interface.
- Layout móvel inspecionado visualmente; sem overflow.

O teste automatizado não substitui a validação da câmera física Android. Para retestar, conferir Leitor 2026.09.30.3; mostrar LENHO e parte da etiqueta legíveis. Depois aproximar os cabeçalhos e valores de folhas e medidas se continuarem pequenos. Nesta etiqueta, conferir 800 folhas e não 1009 (peso).
