-- Controle manual de acesso. Rode no SQL Editor do Supabase (roda como administrador).

-- Liberar acesso (compra fora do sistema automatico, cortesia, teste):
update public.assinaturas
set status = 'ativa', plano = 'manual', provedor = 'manual', valido_ate = null, atualizado_em = now()
where user_id = public.user_id_por_email('cliente@email.com');

-- Liberar por tempo limitado (30 dias):
update public.assinaturas
set status = 'ativa', plano = 'teste', provedor = 'manual', valido_ate = now() + interval '30 days', atualizado_em = now()
where user_id = public.user_id_por_email('cliente@email.com');

-- Bloquear acesso (os dados continuam guardados, so ficam inacessiveis):
update public.assinaturas
set status = 'inativa', atualizado_em = now()
where user_id = public.user_id_por_email('cliente@email.com');

-- Ver todos os clientes e situacao:
select u.email, a.status, a.plano, a.provedor, a.valido_ate, u.last_sign_in_at
from auth.users u
join public.assinaturas a on a.user_id = u.id
order by u.created_at desc;
