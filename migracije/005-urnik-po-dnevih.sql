-- 005 — Urnik po dnevih (20. 8. 2026)
--
-- ZAKAJ
-- Lokal je imel doslej eno samo območje ur (working_hours_start/_end) in
-- seznam delovnih dni (working_days). Restavracija ima vsak dan lahko svoj
-- odpiralni čas, kak dan pa zaprto. Restavracijski bot delovnih dni sploh ni
-- bral, zato je v zaprtem dnevu sprejemal naročila.
--
-- KAJ
-- Doda en stolpec: sb_salons.working_hours (jsonb). Oblika, ključ je dan,
-- kot ga vrne Date#getDay() (0 = nedelja), null pomeni zaprto:
--
--   { "0": null,
--     "1": { "od": "10:00", "do": "22:00" },
--     "2": { "od": "10:00", "do": "22:00" } }
--
-- VARNOST
-- Samo dodajanje stolpca, brez brisanja in brez sprememb obstoječih vrstic.
-- Stara stolpca ostaneta in se še naprej uporabljata kot rezerva, dokler
-- lokal urnika ne vpiše — zato po tej migraciji nobenemu lokalu nič ne ugasne
-- in podatkov ni treba prenašati.
-- Varno je pognati večkrat.

-- ── 1. korak: sprememba ────────────────────────────────────────────────────
alter table public.sb_salons
  add column if not exists working_hours jsonb;

comment on column public.sb_salons.working_hours is
  'Urnik po dnevih: kljuc 0-6 (0=nedelja, kot Date#getDay()), vrednost {"od":"HH:MM","do":"HH:MM"} ali null za zaprto. Ce je NULL, velja star model working_days + working_hours_start/_end.';


-- ── 2. korak: preverba ─────────────────────────────────────────────────────
-- Poženi LOČENO od prvega koraka — SQL editor pokaže samo rezultat zadnjega
-- stavka, zato bi sicer tega izpisa ne videl.
--
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'sb_salons'
--   and column_name in ('working_hours', 'working_days', 'working_hours_start', 'working_hours_end')
-- order by column_name;
--
-- Pričakovano: štiri vrstice, working_hours je jsonb in nullable,
-- stari trije stolpci nedotaknjeni.
