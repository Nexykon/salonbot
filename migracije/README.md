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
| `001-rls-vklop.sql` | ⚠ **preširoka** — vklopila je RLS na vseh tabelah v `public`. Popravi jo 004; te ne poganjaj več |
| `002-preklic-sej.sql` | Doda `sessions_valid_from` za preklic sej ob odjavi |
| `003-odstrani-postgis.sql` | ⚠ **ne poganjaj** — PostGIS uporablja druga aplikacija v isti bazi |
| `004-rls-samo-nase-tabele.sql` | Popravek 001: RLS samo na FlowTiqovih tabelah, tujim vrne prejšnje stanje |

## V tej bazi ni samo FlowTiq

Projekt gosti še eno aplikacijo — poti, aktivnosti in trenerski del:
`activities`, `activity_points`, `routes`, `saved_routes`, `map_packs`,
`user_map_packs`, `coach_profiles`, `coach_plans`, `coach_messages`,
`profiles`, `user_subscriptions`, `subscription_products`, `audit_log`.

**Vsaka migracija mora zato našteti tabele izrecno**, ne pa delovati na
»vse v shemi public«. Migracija 001 je to pravilo kršila in je RLS vklopila
tudi tuji aplikaciji; če ta bere bazo z anon ključem, jo je to ustavilo.
Popravlja jo 004.

Iz istega razloga PostGIS-a ni mogoče odstraniti: `routes.route_line` in
`activity_points.point` sta tipa `geography`.

## Tabele, ki niso naše

V shemi `public` ležijo tudi tabele razširitev — pri nas PostGIS-ov
`spatial_ref_sys`. Teh ne lastimo, zato `alter table` nanje vrne
`42501: must be owner of table`. Migracija 001 jih izloči; tudi gumb
**Enable RLS** v nadzorni plošči odpove z isto napako, ker teče pod isto vlogo.

`spatial_ref_sys` sam po sebi ni tveganje — vsebuje javno znane koordinatne
sisteme, ne osebnih podatkov. Ker pa FlowTiq PostGIS-a nikjer ne uporablja,
ga migracija 003 raje odstrani: tako izgine tabela in z njo opozorilo.

Če bi PostGIS kdaj potrebovali, ga ne vračaj v `public`:

```sql
create extension postgis schema extensions;
```

## Zakaj je RLS varen brez politik

Aplikacija do baze dostopa izključno s `service_role` ključem s strežnika
(`src/supabase.js`), ta ključ pa RLS **obide**. Vklop RLS brez politik torej
ne spremeni ničesar za aplikacijo, `anon` ključu pa vzame vse.

Če bo kdaj dodana poizvedba iz brskalnika, bo dobila prazno, dokler ji ne
napišemo politike — kar je prava smer odpovedi.
