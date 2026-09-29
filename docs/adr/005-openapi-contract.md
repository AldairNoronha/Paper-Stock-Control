# ADR-005 — OpenAPI como contrato

**Status:** aceito

Pydantic/FastAPI geram a especificação OpenAPI. O cliente TypeScript é derivado dela em
`packages/api-client`. Não serão mantidas cópias manuais dos mesmos DTOs em Python e
TypeScript.

