# ADR-004 — Identificadores internos

**Status:** aceito

O identificador persistente é UUIDv7. Um número sequencial gera o código visível
`PAP-000001`. O QR usa `PSC:1:<uuid>` para conter versão e identidade global sem depender
do fornecedor. Ler o QR não concede permissão.

