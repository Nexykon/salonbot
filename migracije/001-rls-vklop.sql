-- 001 · Vklop Row Level Security na naših tabelah v shemi public
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
-- ZAKAJ PRESKAKUJEMO NEKATERE TABELE
--   V public ležijo tudi tabele, ki pripadajo razširitvam (npr. PostGIS-ov
--   spatial_ref_sys). Teh ne lastimo, zato ALTER TABLE na njih vrne
--   "42501: must be owner of table". Ker do-blok teče v eni transakciji, je
--   prva taka napaka prej razveljavila celoten vklop — zato zdaj tabele
--   razširitev izločimo, vsak ALTER pa je še posebej zavarovan.
--
--   spatial_ref_sys vsebuje referenčne koordinatne sisteme, torej javno
--   znane podatke brez osebnih vsebin. Supabase Advisor ga bo morda še naprej
--   omenjal; to je pričakovano in ni naša težava.
--
-- Varno je pognati večkrat.

-- ── 1. Pregled stanja pred spremembo ─────────────────────────────────────────
select
  c.relname                                                      as tabela,
  c.relrowsecurity                                               as rls_vklopljen,
  count(p.polname)                                               as stevilo_politik,
  (d.objid is not null)                                          as od_razsiritve,
  pg_get_userbyid(c.relowner)                                     as lastnik
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
left join pg_depend d on d.objid = c.oid and d.deptype = 'e'
where n.nspname = 'public'
  and c.relkind = 'r'
group by c.relname, c.relrowsecurity, d.objid, c.relowner
order by od_razsiritve, rls_vklopljen, tabela;

-- ── 2. Vklop na naših tabelah ────────────────────────────────────────────────
do $$
declare
  t record;
  vklopljenih int := 0;
  preskocenih int := 0;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
      -- tabele razširitev (PostGIS ipd.) niso naše
      and not exists (
        select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e'
      )
    order by c.relname
  loop
    begin
      execute format('alter table public.%I enable row level security', t.relname);
      vklopljenih := vklopljenih + 1;
      raise notice 'RLS vklopljen: %', t.relname;
    exception
      -- Če katere tabele vseeno ne lastimo, jo preskočimo in nadaljujemo,
      -- namesto da bi razveljavili celoten vklop.
      when insufficient_privilege then
        preskocenih := preskocenih + 1;
        raise notice 'PRESKOČENO (nismo lastnik): %', t.relname;
    end;
  end loop;
  raise notice '— vklopljenih: %, preskočenih: %', vklopljenih, preskocenih;
end $$;

-- ── 3. Potrditev: spodnja poizvedba mora vrniti 0 vrstic ─────────────────────
--    (tabele razširitev so izločene — te ostanejo brez RLS namenoma)
select
  c.relname                    as tabela_brez_rls,
  pg_get_userbyid(c.relowner)  as lastnik
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity
  and not exists (
    select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e'
  )
order by tabela_brez_rls;
