# ADR-002 — FastAPI como porta de escrita

**Status:** aceito

A PWA pode usar Supabase Auth e uploads assinados, mas não grava diretamente em tabelas
de negócio. Todos os comandos passam pelo FastAPI para aplicar autorização, locks,
idempotência, invariantes e auditoria de forma uniforme.

