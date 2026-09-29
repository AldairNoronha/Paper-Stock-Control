# ADR-009 — Comandos de estoque somente online

**Status:** aceito

A PWA pode armazenar o shell e consultas não críticas, mas recebimento, saída, bloqueio,
descarte e transferência precisam de confirmação do servidor. Uma fila offline poderia
aceitar movimentos concorrentes sobre o mesmo saldo e está fora do MVP.

