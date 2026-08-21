-- 006 — Cena embalaže po artiklu (20. 8. 2026)
--
-- ZAKAJ
-- Embalaža je bila ena sama cena za vse: kosov × cena. V resnici se razlikuje
-- po jedi — pica potrebuje karton (0,60 €), dodatek le posodico (0,40 €),
-- pijača nič. Botana si je doslej pomagala tako, da je bila embalaža vpisana
-- kot artikel na meniju ("Embalaža za pizzo - karton").
--
-- KAJ
-- Doda en stolpec: sb_services.packaging_price (numeric).
--   NULL  = artikel svoje cene nima → velja enotna cena lokala
--           (sb_salons.packaging_price)
--   0     = ta artikel je izrecno BREZ embalaže (npr. pijača)
--   > 0   = cena embalaže za en kos tega artikla
--
-- Ta razlika med NULL in 0 je namerna: brez nje pijače ne bi bilo mogoče
-- izvzeti, ne da bi lokal izgubil enotno ceno za vse ostalo.
--
-- VARNOST
-- Samo dodajanje stolpca, brez brisanja in brez sprememb obstoječih vrstic.
-- Dokler je stolpec pri vseh artiklih NULL, se zneski ne spremenijo niti za
-- cent — velja enotna cena lokala, tako kot doslej.
-- Varno je pognati večkrat.

-- ── 1. korak: sprememba ────────────────────────────────────────────────────
alter table public.sb_services
  add column if not exists packaging_price numeric;

comment on column public.sb_services.packaging_price is
  'Cena embalaze za en kos tega artikla v EUR. NULL = uporabi enotno ceno lokala (sb_salons.packaging_price), 0 = brez embalaze.';


-- ── 2. korak: preverba ─────────────────────────────────────────────────────
-- Poženi LOČENO od prvega koraka — SQL editor pokaže samo rezultat zadnjega
-- stavka.
--
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'sb_services'
--   and column_name in ('packaging_price', 'price', 'category')
-- order by column_name;
--
-- Pričakovano: tri vrstice, packaging_price je numeric in nullable.
