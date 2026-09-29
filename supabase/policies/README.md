# Supabase policies

SQL policy sources may live here for readability, but Alembic is the only migration
runner. A policy is not active until an Alembic revision applies it.

Business tables are not written directly by the browser. Storage remains private and
uploads will use short-lived signed URLs issued by the API.

