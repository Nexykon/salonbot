-- ✔ PREVERJENO: TE MIGRACIJE NI TREBA POGNATI
--
-- Korak 1 je pokazal, da so vse tuje tabele ŽE prej imele RLS vklopljen in
-- politike (routes 4, audit_log 2, profiles 2, user_subscriptions 2, ostale
-- po 1). Migracija 001 je delovala samo na tabelah, kjer RLS ni bil vklopljen,
-- zato jih je vse preskočila — tuja aplikacija ni bila prizadeta.
--
-- Stanje je pravilno že brez te migracije:
--   13 FlowTiqovih tabel  RLS vklopljen, 0 politik (zavrni vse razen service_role)
--   13 tujih tabel        RLS vklopljen, 1–4 njihove politike
--   spatial_ref_sys       brez RLS, last razširitve
--
-- Datoteko ohranjamo za dva namena: kot zapis preverbe in kot pripravljen
-- popravek, če bi kdaj kdo pognal poseg na "vse v shemi public". Korak 1 je
-- uporaben sam po sebi — pokaže, katera tabela ima RLS brez politik.
--
-- Da se ni zalomilo, je bila SREČA, ne zasnova: tuja aplikacija je bila
-- pravilno postavljena. Pravilo iz README ostaja v veljavi — migracija mora
-- tabele našteti izrecno.
--
-- ─────────────────────────────────────────────────────────────────────────────

-- 004 · POPRAVEK migracije 001: RLS naj velja samo na FlowTiqovih tabelah
-- Avgust 2026
--
-- KAJ JE ŠLO NAROBE
--   Migracija 001 je vklopila RLS na VSEH tabelah v shemi public. Utemeljena
--   je bila s tem, da FlowTiq do baze dostopa s service_role ključem, ki RLS
--   obide — to drži, a velja samo za FlowTiq.
--
--   V tem projektu pa živi še druga aplikacija: activities, activity_points,
--   routes, saved_routes, map_packs, user_map_packs, coach_profiles,
--   coach_plans, coach_messages, profiles, user_subscriptions,
--   subscription_products, audit_log.
--
--   Če ta aplikacija bere Supabase iz brskalnika z anon ključem (običajen
--   vzorec), jo je vklop RLS brez politik tiho ustavil: poizvedbe vračajo
--   prazno, brez napake.
--
-- KAJ NAREDI TA MIGRACIJA
--   1. pokaže, katere tabele imajo RLS brez politik (te so lahko prizadete)
--   2. RLS IZKLOPI na vseh tabelah, ki niso FlowTiqove in nimajo politik
--      — torej vrne stanje, kakršno je bilo pred 001
--   3. RLS vklopi na FlowTiqovih tabelah, tokrat po izrecnem seznamu
--
--   Korak 2 se namenoma ne dotakne tabel, ki politike IMAJO: te je nekdo
--   nastavil namenoma in 001 jih ni spremenil.
--
-- Varno je pognati večkrat.

-- ── 1. Pregled: katere tabele imajo RLS brez politik ─────────────────────────
select
  c.relname                                        as tabela,
  c.relrowsecurity                                 as rls,
  count(p.polname)                                 as politik,
  (c.relname = any (array[
    'sb_salons','sb_bookings','sb_services','sb_available_slots','sb_order_items',
    'sb_knowledge','sb_errors','sb_logs','sb_master_admins','sb_invoices',
    'sb_contacts','leads','ai_misses','ai_sessions'
  ]))                                              as flowtiqova
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
group by c.relname, c.relrowsecurity
having c.relrowsecurity
order by flowtiqova, tabela;

-- ── 2. Vrni tuje tabele v prejšnje stanje (RLS izklopljen, brez politik) ─────
do $$
declare
  t record;
  nase text[] := array[
    'sb_salons','sb_bookings','sb_services','sb_available_slots','sb_order_items',
    'sb_knowledge','sb_errors','sb_logs','sb_master_admins','sb_invoices',
    'sb_contacts','leads','ai_misses','ai_sessions'
  ];
  n int := 0;
begin
  for t in
    select c.relname, c.oid
    from pg_class c
    join pg_namespace n2 on n2.oid = c.relnamespace
    where n2.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity
      and not (c.relname = any (nase))
      -- tabel s politikami se ne dotikamo: te ni vklopila migracija 001
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
  loop
    begin
      execute format('alter table public.%I disable row level security', t.relname);
      n := n + 1;
      raise notice 'RLS izklopljen (tuja tabela): %', t.relname;
    exception when insufficient_privilege then
      raise notice 'PRESKOČENO (nismo lastnik): %', t.relname;
    end;
  end loop;
  raise notice '— vrnjenih v prejšnje stanje: %', n;
end $$;

-- ── 3. Vklopi RLS na FlowTiqovih tabelah po izrecnem seznamu ─────────────────
do $$
declare
  t text;
  nase text[] := array[
    'sb_salons','sb_bookings','sb_services','sb_available_slots','sb_order_items',
    'sb_knowledge','sb_errors','sb_logs','sb_master_admins','sb_invoices',
    'sb_contacts','leads','ai_misses','ai_sessions'
  ];
  n int := 0;
begin
  foreach t in array nase loop
    if exists (
      select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) then
      begin
        execute format('alter table public.%I enable row level security', t);
        n := n + 1;
      exception when insufficient_privilege then
        raise notice 'PRESKOČENO (nismo lastnik): %', t;
      end;
    end if;
  end loop;
  raise notice '— FlowTiqovih tabel z RLS: %', n;
end $$;

-- ── 4. Potrditev ─────────────────────────────────────────────────────────────
--    Pričakovano: flowtiqova = true ima rls = true,
--                 flowtiqova = false brez politik ima rls = false
select
  c.relname                                        as tabela,
  c.relrowsecurity                                 as rls,
  count(p.polname)                                 as politik,
  (c.relname = any (array[
    'sb_salons','sb_bookings','sb_services','sb_available_slots','sb_order_items',
    'sb_knowledge','sb_errors','sb_logs','sb_master_admins','sb_invoices',
    'sb_contacts','leads','ai_misses','ai_sessions'
  ]))                                              as flowtiqova
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
group by c.relname, c.relrowsecurity
order by flowtiqova desc, tabela;
