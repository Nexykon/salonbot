-- 001 · Vklop Row Level Security na vseh tabelah v shemi public
-- Avgust 2026 · povod: Supabase Advisor "Table publicly accessible (rls_disabled_in_public)"
--
-- ZAKAJ
--   Brez RLS lahko kdorkoli z anon ključem bere, spreminja in briše vse.
--   Anon ključ je po Supabasovi zasnovi JAVEN podatek, zato je RLS edina
--   prava pregrada — tudi če ključa danes nikjer ne objavljamo.
--
--   Na kocki so: sb_salons (WhatsApp žetoni in zgoščena gesla lastnikov),
--   leads (nekaj tisoč e-naslovov), sb_bookings (imena, telefoni, naslovi
--   dostave), sb_master_admins (žetoni za ponastavitev gesla).
--
-- ZAKAJ JE VARNO BREZ POLITIK
--   Strežnik dostopa s service_role ključem, ki RLS obide. Aplikacija zato
--   deluje naprej nespremenjeno; anon dobi nič.
--
-- Varno je pognati večkrat.

-- ── 1. Pregled stanja pred spremembo ─────────────────────────────────────────
select
  c.relname          as tabela,
  c.relrowsecurity   as rls_vklopljen,
  count(p.polname)   as stevilo_politik
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relkind = 'r'
group by 1, 2
order by rls_vklopljen, tabela;

-- ── 2. Vklop povsod, kjer ga še ni ───────────────────────────────────────────
do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    raise notice 'RLS vklopljen: %', t.relname;
  end loop;
end $$;

-- ── 3. Potrditev: spodnja poizvedba mora vrniti 0 vrstic ─────────────────────
select c.relname as tabela_brez_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity;
