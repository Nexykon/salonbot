# Migracije baze

Projekt nima orodja za migracije — sheme ne ustvarja koda, ampak se ureja
ročno v Supabase SQL editorju. Da spremembe niso samo v nečijem klepetu ali
brskalniku, jih zapisujemo sem: eno oštevilčeno datoteko na spremembo,
z datumom in razlogom.

## Kako pognati

Supabase → SQL Editor → prilepi vsebino datoteke → Run.

Vse datoteke so napisane tako, da jih je varno pognati **večkrat**
(`if not exists`, preverjanje stanja pred spremembo).

## Zaporedje

| Datoteka | Kaj naredi |
|---|---|
| `001-rls-vklop.sql` | Vklopi Row Level Security na vseh tabelah v `public` |
| `002-preklic-sej.sql` | Doda `sessions_valid_from` za preklic sej ob odjavi |

## Tabele, ki niso naše

V shemi `public` ležijo tudi tabele razširitev — pri nas PostGIS-ov
`spatial_ref_sys`. Teh ne lastimo, zato `alter table` nanje vrne
`42501: must be owner of table`. Migracija 001 jih izloči.

Supabase Advisor jih bo morda še naprej navajal med opozorili. Pri
`spatial_ref_sys` to ni težava: vsebuje javno znane koordinatne sisteme,
ne osebnih podatkov.

## Zakaj je RLS varen brez politik

Aplikacija do baze dostopa izključno s `service_role` ključem s strežnika
(`src/supabase.js`), ta ključ pa RLS **obide**. Vklop RLS brez politik torej
ne spremeni ničesar za aplikacijo, `anon` ključu pa vzame vse.

Če bo kdaj dodana poizvedba iz brskalnika, bo dobila prazno, dokler ji ne
napišemo politike — kar je prava smer odpovedi.
