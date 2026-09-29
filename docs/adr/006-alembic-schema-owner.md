# ADR-006 — Alembic como proprietário do schema

**Status:** aceito

Todas as alterações do schema, incluindo constraints, triggers e futuras políticas RLS,
são aplicadas pelo Alembic. A pasta Supabase não terá um histórico concorrente de
migrations. Isso preserva uma única ordem e um único estado de revisão.

