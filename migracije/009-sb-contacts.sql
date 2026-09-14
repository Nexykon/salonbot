-- 009 · Prijave z obrazca /kontakt.html dobijo svojo tabelo
-- September 2026
--
-- ZAKAJ
--
--   Koda je prijave v sb_contacts vpisovala že prej, a tabele ni bilo nikoli
--   nihče ustvaril. Vstavljanje je bilo pisano "best-effort" in je napako
--   požrlo, zato tega ni nihče opazil.
--
--   Posledica se je pokazala septembra 2026: po preimenovanju domene Resend
--   ni imel potrjene flowtek.si in je vsako pošiljanje zavrnil s 403. Ker
--   zapisa ni bilo, prijave niso pristale nikjer — obrazec pa je obiskovalcu
--   še naprej javljal uspeh. Dva tedna tišine brez ene same sledi.
--
--   Pošta je zunanja storitev in bo spet kdaj odpovedala. Zapis v bazi je
--   edino, kar je pod našim nadzorom.
--
-- OPOMBA O RLS
--
--   Sledimo migraciji 004: RLS vklopljen, brez politik. Do tabele tako pride
--   samo service_role, s katerim teče strežnik. Anonimni ključ ne vidi nič.

create table if not exists public.sb_contacts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text not null,
  phone         text,
  business_type text,
  source        text default 'landing_form',
  created_at    timestamptz not null default now()
);

-- Prijave beremo po vrsti, najnovejše najprej.
create index if not exists sb_contacts_created_at_idx
  on public.sb_contacts (created_at desc);

alter table public.sb_contacts enable row level security;

-- Preveri:
--   select count(*) from public.sb_contacts;
--   select relrowsecurity from pg_class where relname = 'sb_contacts';  -- t
