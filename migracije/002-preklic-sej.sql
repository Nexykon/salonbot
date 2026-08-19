-- 002 · Preklic sej ob odjavi
-- Avgust 2026 · povod: varnostni pregled
--
-- ZAKAJ
--   Seje so podpisani brezstanjski žetoni s 30-dnevno veljavnostjo. Odjava je
--   brisala le pomnilniško kopijo, zato je ukraden žeton po odjavi delal še do
--   30 dni.
--
-- KAKO
--   Žeton nosi čas izdaje (iat). Ob odjavi zapišemo sessions_valid_from;
--   vsak žeton z manjšim iat je s tem neveljaven. Ker je stanje v bazi in ne
--   v pomnilniku, odjava velja tudi po ponovnem zagonu strežnika.
--
--   Posledica: odjava velja za VSE naprave tega računa. Za administracijsko
--   orodje je to prava privzeta izbira — če je žeton ušel, mora nehati
--   delati povsod.
--
-- Koda: src/auth.js (jeSejaPreklicana), server.js (salonAuth, isMasterRequest,
-- /api/auth/logout). Brez teh stolpcev koda deluje, le preklica ni.
--
-- Varno je pognati večkrat.

alter table public.sb_salons
  add column if not exists sessions_valid_from timestamptz;

alter table public.sb_master_admins
  add column if not exists sessions_valid_from timestamptz;

-- ── Potrditev: obe vrstici morata biti prisotni ──────────────────────────────
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and column_name = 'sessions_valid_from'
order by table_name;
