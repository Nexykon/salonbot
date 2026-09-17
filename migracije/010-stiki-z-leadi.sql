-- 010 · Stanje nagovarjanja: kdaj, po katerem kanalu in kaj je bilo
-- September 2026
--
-- ZAKAJ
--
--   Pošiljanje iz administracije je odstranjeno. Naprej bo šlo ročno oziroma
--   iz lokalnega postopka: po enem lokalu naenkrat, do 30 na dan, po e-pošti,
--   Facebooku, Instagramu ali telefonu.
--
--   Tabela leads tega ne zna zapisati. Ima `email_sent_at` in `status`, kar
--   pomeni natanko eno stvar: "poslali smo mu tisto eno pošto". Ne ve, ali
--   smo mu pisali na Instagram, ali smo ga poklicali, koliko poskusov je bilo
--   in kdaj je bil zadnji. Vse to bi se dalo tlačiti v `notes`, a stanje v
--   prostem besedilu ni stanje — po njem se ne da niti šteti niti filtrirati.
--
--   Zato: en zapis na en stik. Tabela leads ostane to, kar je — kdo je lokal;
--   sb_lead_stiki pa postane to, česar ni bilo — kaj smo z njim počeli.
--
-- KAJ SE NE SPREMINJA
--
--   `status` ostane nedotaknjen, z obstoječimi vrednostmi (pending, new, sent,
--   interested, not_interested). 4057 vrstic je živih in jih ne selimo brez
--   razloga. Pomeni "kje v lijaku je", podrobnost nosi dnevnik stikov.
--
--   `email_sent_at` ostane vodilni podatek za staro pošiljanje — po njem se
--   spodaj dnevnik tudi napolni za nazaj. Izpolnjen je pri 183 vrsticah.
--
--   `sent_at` NI to, kar pove ime: izpolnjen je pri vseh 4057 vrsticah, tudi
--   pri tistih, ki jim ni nikoli nihče pisal. Najbrž je čas uvoza. Koda ga ne
--   bere. Puščamo ga pri miru, ker ne vemo, kdo ga je pisal — a nanj se ne
--   sme nihče zanesti; kdor bi po njem sklepal o nagovarjanju, bi dobil, da
--   smo nagovorili vse.
--
-- VRSTNI RED
--
--   Koraki 1–5 so posegi in so varni za večkratni zagon. Korak 6 je samo
--   preverba — poženi ga ločeno, kot velja po README.

-- ───────────────────────────────────────────────────────────────────────────
-- 1 · Kanali, ki jih lokal sploh ima
--
--   Brez tega postopek ne ve, ali je Instagram možnost ali ne, in bi moral
--   vsakič znova brskati. `website` in `phone` že obstajata.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.leads add column if not exists facebook_url  text;
alter table public.leads add column if not exists instagram_url text;

-- ───────────────────────────────────────────────────────────────────────────
-- 2 · Ne kontaktiraj
--
--   Kdor je rekel ne, mora ostati ne. Danes je to zapisano samo v `status`,
--   gumb za ponastavitev pa `status` povozi nazaj na 'new' — s tem bi človek,
--   ki se je odjavil, spet pristal v vrsti. To je edina napaka v tem sklopu,
--   ki bi jo občutil nekdo zunaj nas.
--
--   Zastavica je ločena od `status` prav zato, da je ponastavitev ne more
--   izbrisati.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.leads add column if not exists ne_kontaktiraj        boolean not null default false;
alter table public.leads add column if not exists ne_kontaktiraj_razlog text;

-- ───────────────────────────────────────────────────────────────────────────
-- 3 · Povzetek stanja na leadu
--
--   Izpeljano iz dnevnika, a zapisano tukaj, ker se po tem filtrira in ureja
--   seznam. Vzdržuje ga prožilec v koraku 5 — ročno se teh dveh stolpcev ne
--   piše, sicer se razideta z dnevnikom.
--
--   `naslednji_korak_at` je edini stolpec, ki ga piše človek: kdaj naj se
--   lokal spet pojavi v vrsti. Brez njega je "pisali smo mu pred tednom"
--   podatek, s katerim se ne da nič narediti.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.leads add column if not exists zadnji_stik_at     timestamptz;
alter table public.leads add column if not exists stikov             integer not null default 0;
alter table public.leads add column if not exists naslednji_korak_at date;

-- ───────────────────────────────────────────────────────────────────────────
-- 4 · Dnevnik stikov
--
--   Ena vrstica na en stik. Nič se ne prepisuje in nič ne izgine — zato se da
--   kadarkoli vprašati "koliko smo jih nagovorili danes" in "kaj smo temu
--   lokalu že pisali", kar sta natanko vprašanji, ki ju postopek potrebuje.
--
--   `smer` loči naš stik od njihovega odgovora. V povzetek (korak 5) se šteje
--   samo 'odhod' — prejeti odgovor ni nov poskus.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.sb_lead_stiki (
  id          uuid primary key default gen_random_uuid(),
  lead_id     bigint not null references public.leads (id) on delete cascade,

  kanal       text not null check (kanal in ('email','facebook','instagram','telefon','whatsapp','osebno')),
  smer        text not null default 'odhod' check (smer in ('odhod','prihod')),
  zgodilo_at  timestamptz not null default now(),

  -- 'poslano' je privzeti izid odhodnega stika; ostalo se dopiše pozneje.
  izid        text check (izid in ('poslano','dostavljeno','odgovor','zavrnitev','ni_odziva','napaka')),

  zadeva      text,   -- naslov pošte oziroma prva vrstica sporočila
  priponka    text,   -- ime poslanega GIF-a ali druge datoteke
  opomba      text,

  created_at  timestamptz not null default now()
);

-- Zgodovina enega lokala, najnovejše najprej.
create index if not exists sb_lead_stiki_lead_idx
  on public.sb_lead_stiki (lead_id, zgodilo_at desc);

-- "Koliko smo jih nagovorili danes" — dnevna omejitev 30.
create index if not exists sb_lead_stiki_cas_idx
  on public.sb_lead_stiki (zgodilo_at desc);

-- Vrsta za jutri: kdor ni odjavljen in mu dolgo nismo pisali.
create index if not exists leads_vrsta_idx
  on public.leads (zadnji_stik_at nulls first)
  where ne_kontaktiraj = false;

-- RLS po vzoru migracije 004: vklopljen, brez politik. Do tabele pride samo
-- service_role, s katerim teče strežnik in bo tekel lokalni postopek.
alter table public.sb_lead_stiki enable row level security;

-- ───────────────────────────────────────────────────────────────────────────
-- 5 · Povzetek se vzdržuje sam
--
--   Ne prištevamo, ampak preštejemo. Prištevanje se ob vsakem izbrisu ali
--   popravku razide s stvarnostjo, preračun pa je pri nekaj deset vrsticah na
--   lokal zastonj.
-- ───────────────────────────────────────────────────────────────────────────

create or replace function public.sb_osvezi_stanje_leada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead bigint;
begin
  v_lead := coalesce(new.lead_id, old.lead_id);

  update public.leads l
     set zadnji_stik_at = s.zadnji,
         stikov         = s.n
    from (
      select max(zgodilo_at) as zadnji, count(*)::int as n
        from public.sb_lead_stiki
       where lead_id = v_lead
         and smer = 'odhod'
    ) s
   where l.id = v_lead;

  return null;
end;
$$;

drop trigger if exists sb_lead_stiki_povzetek on public.sb_lead_stiki;
create trigger sb_lead_stiki_povzetek
  after insert or update or delete on public.sb_lead_stiki
  for each row execute function public.sb_osvezi_stanje_leada();

-- ───────────────────────────────────────────────────────────────────────────
-- 6 · Za nazaj
--
--   Dnevnik, ki se začne danes, trdi, da nismo nikoli nikogar nagovorili.
--   180 lokalov je pošto dobilo julija; to se prepiše v dnevnik, da je
--   zgodovina cela in da jih vrsta ne pobere še enkrat.
--
--   `not exists` naredi ta korak varen za večkratni zagon.
-- ───────────────────────────────────────────────────────────────────────────

insert into public.sb_lead_stiki (lead_id, kanal, smer, zgodilo_at, izid, opomba)
select l.id, 'email', 'odhod', l.email_sent_at, 'poslano',
       'Preneseno iz email_sent_at ob migraciji 010'
  from public.leads l
 where l.email_sent_at is not null
   and not exists (
     select 1 from public.sb_lead_stiki s
      where s.lead_id = l.id and s.kanal = 'email' and s.zgodilo_at = l.email_sent_at
   );

-- Kdor je kliknil "Ne, hvala", ostane odjavljen ne glede na ponastavitve.
update public.leads
   set ne_kontaktiraj = true,
       ne_kontaktiraj_razlog = coalesce(ne_kontaktiraj_razlog, 'Kliknil "Ne, hvala" v pošti')
 where status = 'not_interested'
   and ne_kontaktiraj = false;

-- ───────────────────────────────────────────────────────────────────────────
-- 7 · PREVERBA — poženi ločeno, ne skupaj s posegom
-- ───────────────────────────────────────────────────────────────────────────

-- Koliko stikov je v dnevniku in koliko leadov ima povzetek:
--   select count(*) from public.sb_lead_stiki;
--   select count(*) from public.leads where stikov > 0;
--   -- številki se morata ujemati s številom leadov z email_sent_at:
--   select count(*) from public.leads where email_sent_at is not null;

-- Odjavljeni:
--   select count(*) from public.leads where ne_kontaktiraj;

-- Ali je RLS vklopljen na obeh tabelah (obe morata vrniti t):
--   select relname, relrowsecurity
--     from pg_class
--    where relname in ('leads', 'sb_lead_stiki');

-- Vrsta za danes — komu pišemo naslednjemu:
--   select id, business_name, category, email, facebook_url, instagram_url,
--          zadnji_stik_at, stikov
--     from public.leads
--    where ne_kontaktiraj = false
--      and (naslednji_korak_at is null or naslednji_korak_at <= current_date)
--      and email <> ''
--    order by zadnji_stik_at nulls first, id
--    limit 30;

-- Koliko smo jih nagovorili danes (dnevna omejitev):
--   select count(*) from public.sb_lead_stiki
--    where smer = 'odhod' and zgodilo_at >= current_date;
