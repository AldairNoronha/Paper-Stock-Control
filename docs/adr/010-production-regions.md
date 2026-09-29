# ADR-010 — Regiões de produção

**Status:** aceito

O frontend estático será publicado na Vercel. A API usará Cloud Run e o banco Supabase,
ambos em São Paulo. Render permanece uma alternativa de protótipo, pois não oferece
região brasileira e aumentaria a distância entre API e banco.
