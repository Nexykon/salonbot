# FlowTiq onboarding runbook - Tattoo salon

To je vrstni red, po katerem dodas novo stranko, ki ima tattoo salon.

## 0. Podatki, ki jih zberes od stranke

- Ime podjetja: npr. `Tattoo Studio [ime]`
- Ime lastnika
- Owner/admin WhatsApp telefon: stevilka, s katero se bo lastnik prijavil v owner dashboard
- Bot WhatsApp stevilka: stevilka, na katero bodo pisale stranke
- Email lastnika
- Osnovni delovni cas
- Seznam storitev, cene in trajanja:
  - Tattoo posvet, npr. 30 min, 0 EUR
  - Majhen tattoo, npr. 90 min, 80 EUR
  - Srednji tattoo, npr. 180 min, 180 EUR
  - Kontrola / popravek, npr. 30 min, 0 EUR

## 1. Pripravi Meta Business / WhatsApp

1. Odpri Meta Developers: `https://developers.facebook.com/apps`
2. Izberi obstojeco FlowTiq aplikacijo ali ustvari novo aplikacijo za WhatsApp.
3. V aplikaciji dodaj produkt `WhatsApp`.
4. Pojdi v `WhatsApp > API Setup`.
5. Dodaj produkcijsko telefonsko stevilko za tattoo salon.
6. Vnesi display name, npr. `Tattoo Studio [ime]`.
7. Potrdi stevilko prek SMS ali klica.
8. Zabelezi:
   - `Phone Number ID`
   - prikazno telefonsko stevilko, npr. `+386 XX XXX XXX`
   - `WhatsApp Business Account ID`, ce ga Meta prikaze

Pomembno:
- Stevilka ne sme biti aktivno vezana na navaden WhatsApp/WhatsApp Business app, ce jo Meta zahteva za Cloud API.
- Display name lahko gre v review. Bot lahko deluje, tudi ce ime se ni idealno prikazano, ampak za stranke je bolje, da je ime odobreno.

## 2. Permanent access token

Za produkcijo ne uporabljaj temporary tokena.

1. Odpri Meta Business Settings: `https://business.facebook.com/settings`
2. Pojdi na `Users > System users`.
3. Ustvari ali izberi system userja za FlowTiq.
4. Dodeli mu dostop do WhatsApp Business Accounta.
5. Ustvari permanent token z dovoljenji za WhatsApp Cloud API.
6. Token shrani varno.

Ce imas za vse bote isti WABA/token, ga lahko pustis v Railway env `WA_TOKEN`.
Ce bo vsak salon imel svoj token, mora backend dobiti podporo za vnos `whatsapp_access_token` v master adminu.

## 3. Webhook v Meta

FlowTiq webhook:

```text
https://salonbot-production-785b.up.railway.app/webhook
```

Verify token mora biti enak Railway env vrednosti:

```text
WA_VERIFY_TOKEN
```

Koraki:

1. V Meta app odpri `WhatsApp > Configuration`.
2. Pri Webhook klikni `Edit`.
3. Callback URL: `https://salonbot-production-785b.up.railway.app/webhook`
4. Verify token: ista vrednost kot `WA_VERIFY_TOKEN` na Railway.
5. Klikni `Verify and save`.
6. Pri webhook fields obvezno subscribaj:
   - `messages`

FlowTiq bo tenant izbral po `phone_number_id`, zato je nujno, da je v FlowTiq salonu pravilno vpisan Meta `Phone Number ID`.

## 4. Railway env preverjanje

V Railway projektu preveri environment variables:

```text
WA_TOKEN=...
WA_PHONE_ID=...              # fallback, ni glavni za multi tenant
WA_VERIFY_TOKEN=...
SUPABASE_URL=https://wtlucrpfxbhfkpgimjfh.supabase.co
SUPABASE_KEY=...
ADMIN_API_KEY=...
MASTER_ADMIN_PHONES=38640599185
```

Po spremembi env vrednosti naredi redeploy.

## 5. Dodaj tattoo salon v FlowTiq master admin

1. Odpri master admin:

```text
https://salonbot-production-785b.up.railway.app/dashboard.html
```

2. Prijavi se z master WhatsApp stevilko in OTP kodo.
3. Klikni `Nov salon`.
4. Vnesi:
   - Ime salona: `Tattoo Studio [ime]`
   - Paket: izberi paket
   - Panoga: `Tattoo studio`
   - Booking slug: npr. `tattoo-ime`
   - Ime lastnika
   - Email lastnika
   - Admin WhatsApp telefon: osebna stevilka lastnika za login
   - WhatsApp Phone Number ID: iz Meta API Setup
   - Bot telefonska stevilka: javna bot stevilka, npr. `+386 XX XXX XXX`
5. Shrani.

Sistem bo sam dodal tattoo preset storitve.

## 6. Uredi storitve in trajanja

1. V master adminu pri tattoo salonu klikni `Uredi`.
2. Preveri pozdravno sporocilo.
3. Preveri storitve:
   - cena v EUR
   - trajanje v minutah
4. Trajanje je pomembno, ker koledar blokira cel interval.
5. Shrani.

## 7. Predogled owner dashboarda

1. Zgoraj pri `Tomaz` izberi tattoo salon.
2. Klikni `Predogled dashboarda`.
3. Preveri zavihke:
   - `Nastavitve`
   - `Storitve`
   - `Koledar`

To je samo tvoj predogled kot master admin.

## 8. Test lastnikove prijave

1. Odpri owner portal:

```text
https://salonbot-production-785b.up.railway.app/settings.html
```

2. Vnesi admin WhatsApp stevilko lastnika.
3. Lastnik mora prejeti OTP na WhatsApp.
4. Po vnosu kode mora videti samo svoj salon.
5. Zapri zavihek in ponovno odpri stran: sistem mora zahtevati novo OTP prijavo.

## 9. Test strankinega WhatsApp bota

1. Iz osebnega telefona poslji sporocilo na bot WhatsApp stevilko tattoo salona.
2. Bot mora ponuditi samo tattoo storitve, ne frizerskih.
3. Izberi storitev.
4. Izberi datum in uro.
5. Preveri, da lastnik prejme obvestilo.
6. Potrdi ali zavrni rezervacijo.

## 10. Test javne booking strani

Odpri:

```text
https://salonbot-production-785b.up.railway.app/book.html?b=tattoo-ime
```

Preveri:

- prikaze se pravi tattoo salon
- prikazejo se samo tattoo storitve
- trajanje storitve vpliva na proste termine
- rezervacija se zapise v koledar tega salona

## 11. Kaj preveris pred predajo stranki

- Meta webhook je verified
- Meta webhook je subscribed na `messages`
- `Phone Number ID` v FlowTiq ustreza tej bot stevilki
- owner admin telefon je pravilna osebna stevilka lastnika
- lastnik se lahko prijavi z OTP
- owner dashboard prikaze samo njegov salon
- koledar prikaze samo njegove rezervacije
- WhatsApp bot ne mesa storitev med saloni
- javna booking povezava dela z njegovim slugom

## 12. Pogoste napake

- Bot ne odgovarja:
  - preveri Meta webhook URL
  - preveri `WA_VERIFY_TOKEN`
  - preveri, da je webhook subscribed na `messages`
  - preveri `Phone Number ID` v FlowTiq salonu

- Lastnik ne dobi OTP:
  - preveri admin telefon v FlowTiq
  - preveri, da bot WA token lahko posilja sporocila
  - preveri Railway logs

- Stranka vidi napacne storitve:
  - preveri `business_type`
  - preveri storitve v Bot Studio
  - preveri, da je webhook prisel iz pravilnega `phone_number_id`

- Koledar kaze cudne termine:
  - preveri trajanje storitev
  - preveri delovni cas
  - preveri interval narocanja
