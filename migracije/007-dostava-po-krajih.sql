-- 007 — Strošek dostave po kraju (21. 8. 2026)
--
-- ZAKAJ
-- Lokal je imel eno samo ceno dostave na naročilo (sb_salons.delivery_fee).
-- Botana zaračunava po kraju — Vodice 2 €, Šenčur 3 €, Domžale 4 €,
-- Kamnik 5 €, Dol pri Ljubljani 6 € — cenik pa je obstajal samo na roko
-- napisanem listu. Ker tega bot ni znal, je bila njena dostava nastavljena na
-- 0 € in se ni zaračunavala.
--
-- KAJ
-- Doda en stolpec: sb_salons.delivery_zones (jsonb), polje krajev s cenami:
--
--   [ { "kraj": "Vodice",  "cena": 2 },
--     { "kraj": "Komenda", "cena": 2 },
--     { "kraj": "Kamnik",  "cena": 5 } ]
--
-- Dva načina, ki se IZKLJUČUJETA:
--   1) delivery_zones ima vsaj en kraj → cena po kraju, iz naslova stranke
--   2) prazno ali NULL                → enotna delivery_fee, kot doslej
--
-- Kadar kraja iz naslova ni mogoče določiti, cena NI ugibana: naročilo gre
-- skozi, ceno dostave pa določi lokal. Napačna cena je slabša od nedoločene.
--
-- VARNOST
-- Samo dodajanje stolpca, brez brisanja in brez sprememb obstoječih vrstic.
-- Dokler je stolpec NULL, se zneski ne spremenijo niti za cent.
-- Varno je pognati večkrat.

-- ── 1. korak: sprememba ────────────────────────────────────────────────────
alter table public.sb_salons
  add column if not exists delivery_zones jsonb;

comment on column public.sb_salons.delivery_zones is
  'Cena dostave po kraju: [{"kraj":"Vodice","cena":2}, ...]. Ce je NULL ali prazno, velja enotna cena sb_salons.delivery_fee. Neznan kraj pomeni, da ceno dostave doloci lokal.';


-- ── 2. korak: preverba ─────────────────────────────────────────────────────
-- Poženi LOČENO od prvega koraka — SQL editor pokaže samo rezultat zadnjega
-- stavka.
--
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'sb_salons'
--   and column_name in ('delivery_zones', 'delivery_fee', 'delivery_area')
-- order by column_name;
--
-- Pričakovano: tri vrstice, delivery_zones je jsonb in nullable.
