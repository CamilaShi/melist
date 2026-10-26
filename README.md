# ME-List

Aplicativo de checklists multiusuário. Front-end estático no GitHub Pages, banco, login e fotos no Supabase.

Estrutura:

- docs/ : site publicado pelo GitHub Pages (index.html, style.css, app.js, config.js)
- supabase/schema.sql : tabelas, regras de segurança (RLS) e bucket de fotos
- supabase/liberar_acesso.sql : comandos para liberar ou bloquear clientes manualmente
- supabase/functions/webhook-compra : função que libera o acesso quando o pagamento é confirmado
- GUIA.md : passo a passo completo

Comece pelo GUIA.md.
