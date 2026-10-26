-- ME-List: schema completo para Supabase
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------

create table public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  criado_em timestamptz not null default now()
);

create table public.assinaturas (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'inativa' check (status in ('ativa', 'inativa', 'cancelada')),
  plano text,
  provedor text,
  id_externo text,
  valido_ate timestamptz,
  atualizado_em timestamptz not null default now()
);
create index assinaturas_id_externo_idx on public.assinaturas (id_externo);

create table public.checklists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 120),
  ativo boolean not null default true,
  registrar_historico boolean not null default false,
  zerar_diario boolean not null default false,
  criado_em timestamptz not null default now()
);
create index checklists_user_idx on public.checklists (user_id);

create table public.secoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 120),
  ordem integer not null default 0
);
create index secoes_user_idx on public.secoes (user_id);
create index secoes_checklist_idx on public.secoes (checklist_id);

create table public.itens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  secao_id uuid not null references public.secoes(id) on delete cascade,
  descricao text not null check (char_length(descricao) between 1 and 500),
  ordem integer not null default 0,
  marcado boolean not null default false,
  criado_em timestamptz not null default now()
);
create index itens_user_idx on public.itens (user_id);
create index itens_checklist_idx on public.itens (checklist_id);
create index itens_secao_idx on public.itens (secao_id);

create table public.fotos_item (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id uuid not null references public.itens(id) on delete cascade,
  caminho text not null unique,
  nome text,
  criado_em timestamptz not null default now()
);
create index fotos_item_user_idx on public.fotos_item (user_id);
create index fotos_item_item_idx on public.fotos_item (item_id);

-- ---------------------------------------------------------------
-- Funcoes
-- ---------------------------------------------------------------

-- Cria perfil e assinatura inativa quando um usuario nasce em auth.users.
create function public.novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfis (id, nome)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)));

  insert into public.assinaturas (user_id) values (new.id);
  return new;
end;
$$;

create trigger ao_criar_usuario
after insert on auth.users
for each row execute function public.novo_usuario();

-- Retorna true se o usuario logado tem assinatura ativa e dentro da validade.
create function public.tem_acesso()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.assinaturas a
    where a.user_id = auth.uid()
      and a.status = 'ativa'
      and (a.valido_ate is null or a.valido_ate > now())
  );
$$;

revoke all on function public.tem_acesso() from public, anon;
grant execute on function public.tem_acesso() to authenticated;

-- Busca id de usuario pelo e-mail. Uso exclusivo da Edge Function (service_role).
create function public.user_id_por_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function public.user_id_por_email(text) from public, anon, authenticated;
grant execute on function public.user_id_por_email(text) to service_role;

-- ---------------------------------------------------------------
-- Permissoes de tabela (defesa em profundidade, alem do RLS)
-- Com "Automatically expose new tables" desmarcado no Supabase, nenhuma
-- permissao e concedida por padrao, entao tudo e concedido aqui de forma explicita.
-- ---------------------------------------------------------------

revoke all on public.perfis, public.assinaturas, public.checklists,
              public.secoes, public.itens, public.fotos_item from anon;

-- Clientes logadas: somente leitura em assinaturas, leitura e troca de nome em perfis.
grant select on public.assinaturas to authenticated;
grant select on public.perfis to authenticated;
grant update (nome) on public.perfis to authenticated;

-- Clientes logadas: acesso completo (filtrado pelo RLS) aos dados do checklist.
grant select, insert, update, delete
  on public.checklists, public.secoes, public.itens, public.fotos_item
  to authenticated;

-- Servidor (Edge Function com service_role): precisa de acesso para liberar compras.
grant select, insert, update, delete
  on public.perfis, public.assinaturas, public.checklists,
     public.secoes, public.itens, public.fotos_item
  to service_role;

-- ---------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------

alter table public.perfis enable row level security;
alter table public.assinaturas enable row level security;
alter table public.checklists enable row level security;
alter table public.secoes enable row level security;
alter table public.itens enable row level security;
alter table public.fotos_item enable row level security;

create policy perfis_ler on public.perfis
  for select to authenticated
  using (id = (select auth.uid()));

create policy perfis_atualizar on public.perfis
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy assinaturas_ler on public.assinaturas
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy checklists_dono on public.checklists
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.tem_acesso()))
  with check (user_id = (select auth.uid()) and (select public.tem_acesso()));

create policy secoes_dono on public.secoes
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.tem_acesso()))
  with check (
    user_id = (select auth.uid())
    and (select public.tem_acesso())
    and exists (
      select 1 from public.checklists c
      where c.id = checklist_id and c.user_id = (select auth.uid())
    )
  );

create policy itens_dono on public.itens
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.tem_acesso()))
  with check (
    user_id = (select auth.uid())
    and (select public.tem_acesso())
    and exists (
      select 1 from public.checklists c
      where c.id = checklist_id and c.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.secoes s
      where s.id = secao_id and s.user_id = (select auth.uid())
    )
  );

create policy fotos_item_dono on public.fotos_item
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.tem_acesso()))
  with check (
    user_id = (select auth.uid())
    and (select public.tem_acesso())
    and caminho like (select auth.uid())::text || '/%'
    and exists (
      select 1 from public.itens i
      where i.id = item_id and i.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------
-- Storage: bucket privado de fotos
-- Caminho dos arquivos: <user_id>/<item_id>/<uuid>.jpg
-- ---------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg'];

create policy fotos_ler on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fotos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.tem_acesso())
  );

create policy fotos_enviar on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fotos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.tem_acesso())
  );

create policy fotos_apagar on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'fotos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.tem_acesso())
  );
