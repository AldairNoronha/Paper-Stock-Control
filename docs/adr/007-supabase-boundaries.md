# ADR-007 — Limites do Supabase

**Status:** aceito

Supabase fornece PostgreSQL, Auth e Storage. A API valida o JWT e aplica autorização de
domínio. O bucket de etiquetas é privado e usa URLs assinadas. Chaves secretas nunca são
enviadas ao navegador.

