# ADR-011 — transferências integrais de pallet no MVP

## Status

Aceito em 29/09/2026.

## Decisão

Uma transferência muda a localização do pallet inteiro sem alterar seus saldos. Não
há transferência parcial na Fase 2.

Quando uma parte física precisar seguir para outra posição, o sistema deverá criar um
pallet-filho em uma fase posterior, com rastreabilidade explícita da origem. Não será
simulado um fracionamento alterando somente a localização de parte do saldo.

## Consequências

- a localização continua sendo um único atributo inequívoco do pallet;
- o ledger registra origem e destino em um movimento append-only;
- o estorno só é aceito se o pallet ainda estiver no destino do movimento original;
- fracionamento físico fica fora do MVP e exige desenho próprio.
