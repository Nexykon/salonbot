-- ⚠⚠ NE POGANJAJ TE MIGRACIJE ⚠⚠
--
-- Ugotovljeno po prvem poskusu: PostGIS uporablja DRUGA aplikacija v isti bazi.
--   column route_line of table routes depends on type geography
--   column point of table activity_points depends on function geography(geometry)
--
-- drop je (namenoma brez cascade) odpovedal in ničesar ni izbrisal. Datoteko
-- ohranjamo kot zapis poskusa in kot opozorilo: v tej bazi ne živi samo
-- FlowTiq, zato ne odstranjujemo razširitev in ne delamo posegov na
-- "vse v shemi public". Glej migracijo 004.
--
-- spatial_ref_sys torej ostane brez RLS. To ni tveganje: vsebuje javno znane
-- koordinatne sisteme, ne osebnih podatkov. Supabase Advisor ga bo navajal
-- naprej — to je znano in sprejeto.
--
-- Spodnja vsebina je ohranjena samo za zapis; presoja "PostGIS ni v uporabi"
-- je bila napačna, ker sem preveril le FlowTiqovo kodo, ne pa cele baze.
--
-- ─────────────────────────────────────────────────────────────────────────────

-- 003 · Odstrani nerabljeno razširitev PostGIS
-- Avgust 2026 · povod: Supabase Advisor vztraja pri spatial_ref_sys
--
-- ZAKAJ
--   spatial_ref_sys je PostGIS-ova tabela referenčnih koordinatnih sistemov.
--   Leži v shemi public, zato jo Advisor prijavlja kot "publicly accessible".
--   RLS nanjo ne moremo vklopiti, ker tabele ne lastimo (42501), niti prek
--   gumba Enable RLS v nadzorni plošči — ta teče pod isto vlogo.
--
--   FlowTiq PostGIS-a ne uporablja: v celotni kodi ni nobene omembe
--   geometry/geography tipov ali ST_ funkcij, delivery_area pa je navadno
--   besedilo. Razširitev je torej odveč — z njeno odstranitvijo izgine
--   tudi tabela in z njo opozorilo.
--
-- VARNOST
--   Namenoma BREZ cascade. Če bi kaj vseeno bilo odvisno od PostGIS-a, bo
--   drop odpovedal z napako in ne bo ničesar izbrisal. Korak 1 to preveri
--   vnaprej — če vrne kakšno vrstico, koraka 3 NE poženi.
--
-- ALTERNATIVA, če bi PostGIS kdaj potrebovali
--   Ne vrni ga v public, ampak: create extension postgis schema extensions;
--   Tako spatial_ref_sys ne leži v public in Advisor ga ne prijavlja.
--
-- Varno je pognati večkrat.

-- ── 1. Ali kaj uporablja PostGIS tipe? Mora vrniti 0 vrstic. ─────────────────
select
  c.table_schema,
  c.table_name,
  c.column_name,
  c.udt_name as tip
from information_schema.columns c
where c.udt_name in ('geometry', 'geography', 'box2d', 'box3d', 'raster')
order by 1, 2, 3;

-- ── 2. Kaj je odvisno od razširitve (informativno) ───────────────────────────
select
  e.extname                        as razsiritev,
  n.nspname                        as shema,
  count(d.objid)                   as objektov
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
left join pg_depend d on d.refobjid = e.oid and d.deptype = 'e'
where e.extname like 'postgis%'
group by 1, 2;

-- ── 3. Odstranitev (brez cascade — ob odvisnostih odpove in nič ne pobriše) ──
drop extension if exists postgis_tiger_geocoder;
drop extension if exists postgis_topology;
drop extension if exists postgis_raster;
drop extension if exists postgis;

-- ── 4. Potrditev: obe poizvedbi morata vrniti 0 vrstic ──────────────────────
select extname from pg_extension where extname like 'postgis%';

select c.relname as tabela_brez_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity;
