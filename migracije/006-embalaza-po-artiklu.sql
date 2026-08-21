-- 006 — Cena embalaže po artiklu (20. 8. 2026)
--
-- ZAKAJ
-- Embalaža je bila ena sama cena za vse: kosov × cena. V resnici se razlikuje
-- po jedi — pica potrebuje karton (0,60 €), dodatek le posodico (0,40 €),
-- pijača nič. Botana si je doslej pomagala tako, da je bila embalaža vpisana
-- kot artikel na meniju ("Embalaža za pizzo - karton").
--
-- KAJ
-- Doda en stolpec: sb_services.packaging_price (numeric) — cena embalaže za
-- en kos tega artikla. NULL ali 0 pomeni brez embalaže.
--
-- Embalaža ima dva načina, ki se IZKLJUČUJETA:
--   1) sb_salons.packaging_price > 0
--      enotna cena za CELOTNO naročilo (npr. vrečka 1 €), prišteta enkrat.
--      Cene pri artiklih se takrat NE upoštevajo.
--   2) sb_salons.packaging_price = 0
--      velja cena po artiklu; zneski se seštejejo.
-- Brez obojega je embalaža brezplačna.
--
-- VARNOST
-- Samo dodajanje stolpca, brez brisanja in brez sprememb obstoječih vrstic.
-- Varno je pognati večkrat — tudi ponovno, če je bil komentar stolpca zapisan
-- po starem pravilu.

-- ── 1. korak: sprememba ────────────────────────────────────────────────────
alter table public.sb_services
  add column if not exists packaging_price numeric;

comment on column public.sb_services.packaging_price is
  'Cena embalaze za en kos tega artikla v EUR. NULL ali 0 = brez embalaze. Velja samo, kadar je sb_salons.packaging_price = 0; sicer velja enotna cena za celotno narocilo.';


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
