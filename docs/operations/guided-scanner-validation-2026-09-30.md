# Validação do scanner guiado — 2026-09-30

## Automatizado

- TypeScript, ESLint, Ruff e MyPy: aprovados.
- Web: 10 testes aprovados.
- API: 22 testes aprovados; 3 testes PostgreSQL reservados para a CI com banco migrado.
- Build web/PWA e compilação Python: aprovados.

Os testes do acumulador confirmaram QR com preenchimento imediato, confirmação OCR em
dois quadros e fusão de regiões separadas até completar os campos obrigatórios.

## Navegador em viewport móvel (390 × 844)

O estado inicial, a seleção de imagem e a revisão foram inspecionados sem erro no console.
O ambiente automatizado não possui câmera física e respondeu corretamente com fallback
para fotografia.

Resultados obtidos diretamente das três imagens fornecidas:

| Amostra | Resultado da fotografia completa |
| --- | --- |
| Schattdecor | fornecedor, material, lote, 850 folhas, 1865 × 2765 e um código lido |
| Impress | fornecedor, material e 1860 × 2760; lote e folhas continuaram ausentes porque QR/texto ficaram pequenos |
| Interprint | fornecedor, material, lote, 1060 folhas, 1865 × 2765, área, data e orientação |

O resultado Impress reproduz a limitação que motivou a mudança: uma fotografia panorâmica
não torna o QR pequeno confiável. A nova câmera mantém ZXing ativo enquanto o operador
aproxima a moldura do QR e usa OCR incremental para os campos restantes.

## Pendente obrigatório

Aprovar em um celular Android físico usando o roteiro de
`docs/operations/guided-mobile-scanner.md`. A validação automatizada não pode certificar
autofoco, lanterna, zoom, vibração nem taxa real de leitura da câmera traseira.
