-- 008 — Ponastavitev pozabljenega gesla za lastnike (26. 8. 2026)
--
-- ZAKAJ
-- Master administrator ponastavitev gesla ima že od prej
-- (sb_master_admins.reset_token_hash). Lastniki lokalov je niso imeli: če je
-- lastnik pozabil geslo, mu ga je moral nekdo nastaviti na roko v administraciji.
--
-- KAJ
-- Doda dva stolpca na sb_salons, po istem vzorcu kot pri master adminu:
--   owner_reset_token_hash   — SHA-256 odtis žetona iz povezave (nikoli žeton sam)
--   owner_reset_expires_at   — do kdaj povezava velja (30 minut)
--
-- Žeton se hrani samo kot odtis: kdor bi videl bazo, iz nje ne more sestaviti
-- veljavne povezave.
--
-- VARNOST
-- Samo dodajanje stolpcev, brez brisanja in brez sprememb obstoječih vrstic.
-- Dokler sta oba NULL, se ne zgodi nič — ponastavitve preprosto ni v teku.
-- Varno je pognati večkrat.

-- ── 1. korak: sprememba ────────────────────────────────────────────────────
alter table public.sb_salons
  add column if not exists owner_reset_token_hash text,
  add column if not exists owner_reset_expires_at timestamptz;

comment on column public.sb_salons.owner_reset_token_hash is
  'SHA-256 odtis zetona za ponastavitev gesla lastnika. Zeton sam se ne hrani.';
comment on column public.sb_salons.owner_reset_expires_at is
  'Do kdaj velja povezava za ponastavitev gesla lastnika (30 minut od zahteve).';

-- Iskanje po odtisu je edina poizvedba nad tem stolpcem.
create index if not exists sb_salons_owner_reset_idx
  on public.sb_salons (owner_reset_token_hash)
  where owner_reset_token_hash is not null;


-- ── 2. korak: preverba ─────────────────────────────────────────────────────
-- Poženi LOČENO od prvega koraka — SQL editor pokaže samo rezultat zadnjega
-- stavka.
--
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'sb_salons'
--   and column_name in ('owner_reset_token_hash', 'owner_reset_expires_at',
--                       'owner_password_hash', 'sessions_valid_from')
-- order by column_name;
--
-- Pričakovano: štiri vrstice; nova dva stolpca sta text in timestamptz,
-- oba nullable.
