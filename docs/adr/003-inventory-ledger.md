# ADR-003 — Ledger imutável e projeção de saldo

**Status:** aceito

Cada alteração de estoque cria um movimento append-only entre baldes. O pallet mantém
uma projeção de saldo atualizada na mesma transação. Essa combinação oferece consulta
rápida e histórico explicável. Correções são estornos, nunca edição do passado.

