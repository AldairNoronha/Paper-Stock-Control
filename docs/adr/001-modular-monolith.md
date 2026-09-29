# ADR-001 — Monólito modular independente

**Status:** aceito

O produto será um repositório e uma aplicação independentes do Planix. O backend será
um monólito modular com limites por domínio. Microserviços adicionariam deploys, rede e
consistência distribuída sem necessidade comprovada. Integração futura ocorrerá por API
ou migração explícita.

