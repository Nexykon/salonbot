# FlowTiq → FlowTek: kaj je narejeno in kaj mora narediti človek

---

## 1 · Stanje objave — domena je živa (5. 9. 2026)

`flowtek.si` je priklopljen in **preusmeritev je vklopljena**. Preverjeno v
živo:

```
http://flowtek.si/          301 → https://flowtek.si/
https://flowtek.si/         200, canonical https://flowtek.si/
https://www.flowtek.si/     301 → https://flowtek.si/
https://flowtiq.si/         301 → https://flowtek.si/
https://flowtiq.si/cenik.html  301 → https://flowtek.si/cenik.html
```

Preusmeritev dela **naša koda**, ne platforma — kar je pomembno, ker naši dve
namerni izjemi zato res veljata:

```
GET  flowtiq.si/webhook                403  (brez preusmeritve)
POST flowtiq.si/webhook                200  (brez preusmeritve)
GET  flowtiq.si/api/public/restaurants 200  (brez preusmeritve)
```

Platformna preusmeritev bi tu vrnila 301 in Meta bi ob POST izgubljala
sporočila strank.

`flowtiq.si` **pusti priklopljen vsaj 12 mesecev.**

### Pred aplikacijo stoji Cloudflare

Glave odgovorov: `server: cloudflare`, `cf-ray: …-VIE`. Posledica, ki jo je
treba poznati: **`robots.txt` v živo ni naša datoteka.** Cloudflare pred našo
vsebino vrine 62 vrstic svojega bloka (`# BEGIN Cloudflare Managed content`) z
`Content-Signal: search=yes,ai-train=no,use=reference` in `Disallow: /` za
Amazonbot, Applebot-Extended, Bytespider, CCBot, ClaudeBot,
CloudflareBrowserRenderingCrawler, Google-Extended, GPTBot in
meta-externalagent.

Naš del je za tem blokom cel in nespremenjen, `llms.txt` in `sitemap.xml` se
strežeta točno tako, kot sta v repozitoriju. Omrežne blokade AI pajkov ni —
zahteve z imeni teh pajkov v `User-Agent` dobijo 200 in vsebino.

Nastavitev je v Cloudflarovi nadzorni plošči (AI Crawl Control → robots.txt),
ne v kodi, in velja za obe domeni. Podrobneje v razdelku 5.

---

## 2 · Kar je treba narediti ročno, zunaj kode

| # | Kaj | Kje | Stanje |
|---|---|---|---|
| 1 | Registracija domene + DNS + TLS | registrar in gostovanje | **narejeno** |
| 2 | Nabiralnik `info@flowtek.si` | ponudnik pošte | **narejeno** |
| 3 | `PREUSMERI_NA_NOVO_DOMENO = 1` | gostovanje | **narejeno** |
| 4 | **`BASE_URL = https://flowtek.si`** | gostovanje — glej spodaj | odprto |
| 5 | **Change of address** iz flowtiq.si v flowtek.si | Google Search Console (obe domeni morata biti potrjeni) | odprto |
| 6 | Nov sitemap oddaj za novo domeno | Search Console | odprto |
| 7 | Naslov toka podatkov | Google Analytics 4 | odprto |
| 8 | Ime in naslov strani | Google Business Profile | odprto |
| 9 | Profilna slika in ime | WhatsApp Business — uporabi `public/ft-whatsapp-avatar-1024.png` | odprto |
| 10 | Podpisi v e-pošti | ročno | odprto |
| 11 | Ime in domena na računih/predračunih | preveri `src/proforma.js` (podatki podjetja Webacus ostanejo nespremenjeni) | odprto |
| 12 | Stripe: ime izdelka na položnicah | Stripe nadzorna plošča | odprto |
| 13 | Meta App: ime aplikacije, webhook domena | developers.facebook.com (webhook lahko ostane na stari domeni — 301 ga namenoma ne prestreže) | odprto |

### `BASE_URL` — edina odprta stvar, ki lahko kaj pokvari

`server.js` ga bere na sedmih mestih kot
`process.env.BASE_URL || 'https://flowtek.si'`. Privzetek v kodi je torej že
nov, **ampak če je spremenljivka na gostovanju še nastavljena na
`https://flowtiq.si`, jo koda ubogne** — in vsaka povezava, ki jo strežnik
sestavi sam, kaže na staro domeno:

- povezave za vpis v e-pošti lastnikom,
- povezava za ponastavitev gesla,
- `success_url` in `cancel_url` pri Stripu,
- povezava za postavitev (`/setup.html?token=…`).

Te povezave sicer **delujejo** (301 jih prevede), a v e-pošti stranka vidi
staro ime. Popravek: nastavi `BASE_URL = https://flowtek.si` ali spremenljivko
odstrani — privzetek je pravi.

### Vsi prijavljeni lastniki bodo odjavljeni

Žetoni so v `localStorage`, ta pa je vezan na domeno. Botana in Trixy sta bila
prijavljena na `flowtiq.si`; na `flowtek.si` bosta prišla **odjavljena** in
bosta potrebovala geslo. Če ga ne vesta, gre pot prek `/geslo`. To ni okvara,
ampak posledica menjave domene, ki se je ne da obiti.

### Okoljske spremenljivke — NE preimenuj

`FLOWTIQ_OWNER_EMAIL` in `FLOWTIQ_OWNER_PHONE` sta **imeni** spremenljivk,
nastavljeni na gostovanju. V kodi sta puščeni nespremenjeni namenoma:
preimenovanje bi pomenilo, da strežnik po objavi ne najde vrednosti in
obvestila o novih prijavah ne bi imela naslovnika. Če ju hočeš poenotiti,
najprej dodaj novi imeni na gostovanju, nato popravi kodo.

### Ključi v shrambi brskalnika — NE preimenuj

`ft_owner_token`, `ft_master_token`, `ft_delivery_token`. Preimenovanje bi
odjavilo vse prijavljene lastnike in skrbnike.

---

## 3 · Kaj je spremenjeno v kodi

### Sredstva
- 6 SVG in 7 PNG iz `public/assets/` prekopiranih v koren `public/`.
- SVG so v korenu **brez C2PA metapodatkov**: skupaj 46 KB manj (npr.
  `ft-mark.svg` z 8,4 KB na 0,7 KB), videz nespremenjen. Znak se naloži na
  vsaki strani, zato to ni malenkost. **Izvirniki z provenienco ostanejo v
  `public/assets/`.**
- `flowtiq_logo.png` odstranjen (nanj ni kazalo nič).
- `ft-logo.png` zamenjan z novim lockupom (1280×320).

### Logotip
- Glava (28 strani) in noga (29 mest): rastrski `<img>` zamenjan z
  `.brand` = znak + pravo besedilo `Flow<span>Tek</span>`.
- **Noga uporablja svetli `ft-mark.svg`, ne temnega.** Navodilo je
  predvidevalo temno nogo, pri nas pa je `.site-foot { background: var(--cream) }`
  — svetla. Pravila `.sec--ink .brand-name` so vseeno dodana za temne odseke.
- Znak: 30 px v glavi, 28 px v nogi.
- `.head-logo img { height: 30px }` zoženo na `.head-logo > img:only-child`,
  da ne stiska novega znaka ob besedilu.
- Nadzorne plošče (`admin`, `salon`, `delivery`) in `prijava.html` še naprej
  uporabljajo `ft-logo.png` — tam gre za ločeno temo, ki je ne mešamo.
  Popravljeno pa je razmerje: `188×55` → `188×47` (nov lockup je 4 : 1).

### Glava dokumenta
- `favicon.svg` + `apple-touch-icon.png` na vseh 38 straneh (prej `logo.png`
  oziroma neobstoječi `favicon.ico`).
- `theme-color`, `og:site_name`, `og:image`, `og:image:width/height/alt`,
  `twitter:card`, `canonical`, `og:url` — preverjeno na vseh 30 javnih straneh.

### Ime in domena
- 1104 zamenjav v HTML, CSS, JS, TXT, XML, MD.
- Preimenovane datoteke: `flowtiq-site.css` → `flowtek-site.css`,
  `flowtiq-theme.css` → `flowtek-theme.css`,
  `flowtiq-pravno.css` → `flowtek-pravno.css`,
  `flowtiq-nav.js` → `flowtek-nav.js` (vse sklicevanja posodobljena).
- Razlaga imena (30 mest): »Tiq je odziv v sekundi« →
  »**Tek** je to, da posel teče sam naprej«. V `o-nas.html` je bila druga
  različica te razlage; usklajena posebej.
- `info@flowtiq.si` → `info@flowtek.si`.

### Strežnik
- 301 z `flowtiq.si` in `www.flowtiq.si` na `flowtek.si`, poti 1 : 1.
  **Dve namerni izjemi:** samo GET/HEAD (Meta ob POST preusmeritve ne sledi,
  zato bi 301 pomenil izgubljena sporočila strank) in nikoli `/webhook`
  ter `/api/`.
- Nova domena je v `NOVA_DOMENA` (privzeto `https://flowtek.si`), da jo je
  mogoče prekriti brez posega v kodo.

### Kar ostaja nespremenjeno
Webacus, Valentin Iljaž s.p., naslov, davčna številka, `ft-*` predpone imen
datotek, ključi v shrambi, imeni okoljskih spremenljivk, mapa
repozitorija (`d:\sinusiks\flowtiq\flowtiq.si` — preimenovanje mape bi
prekinilo delovni imenik in nima nobene zveze z objavljeno stranjo).

---

## 4 · Preverjeno

- Iskanje po `public/`, `src/`, `tools/`, `server.js` za `FlowTiq`, `flowtiq`,
  `Tiq`: ostanejo samo imena okoljskih spremenljivk in namerna raba
  `ft-logo.png` v ploščah.
- Izris v pravem brskalniku: glava in noga na `cenik.html` in
  `panoga/restavracije.html`, znak se nariše, razlaga imena je nova.
- Vsi preizkusi: test-seo 9, test-ai-iskanje 92, test-prijava 54,
  test-kontakt 36, test-seznam 56, test-zaprto 14, test-gumbi 51,
  test-ensus 37, test-dostava 176, test-embalaza 60, test-besede 36,
  test-urnik 41.

---

## 5 · Cloudflarov robots.txt: kaj pomeni za AI iskanje

Cloudflare blokira **pajke za učenje modelov**, ne pajkov, ki sestavljajo
odgovore z navedbo vira. Ta razlika odloča:

**Blokirani (učenje in gradnja korpusa):** GPTBot, ClaudeBot, CCBot,
Google-Extended, Applebot-Extended, meta-externalagent, Amazonbot, Bytespider.

**Niso blokirani — in to so tisti, ki pripeljejo obiskovalca:** OAI-SearchBot
in ChatGPT-User (iskanje v ChatGPT), Claude-SearchBot in Claude-User,
PerplexityBot in Perplexity-User, Bingbot, Applebot, MistralAI-User,
DuckAssistBot, YouBot. Googlov AI Overviews se ravna po navadnem Googlebotu,
ne po Google-Extended.

Delo na `llms.txt` in AI iskanju torej ni izgubljeno.

### Kar pa ni v redu: datoteka si nasprotuje

Za šest imen (GPTBot, ClaudeBot, CCBot, Google-Extended, Applebot-Extended,
meta-externalagent) sta v živem `robots.txt` **dve skupini z istim imenom** —
Cloudflarova z `Disallow: /` in naša z `Allow: /`. Kaj se zgodi, je odvisno od
pajka: Googlov razčlenjevalnik skupini zlije in ob enako dolgih pravilih zmaga
`Allow`, drugi pajki pa lahko vzamejo prvo skupino in ostalo prezrejo. Zanesti
se na to ni mogoče.

Dve pošteni rešitvi:

1. **Sprejmemo Cloudflarovo politiko** (učenje ne, iskanje ja) in iz naše
   datoteke odstranimo teh šest imen, da si ne nasprotuje. Vidnost v AI
   iskalnikih ostane nespremenjena. *(priporočeno)*
2. **Izklopimo Cloudflarov managed robots.txt** (nadzorna plošča → AI Crawl
   Control) in velja samo naša datoteka, ki spušča naprej tudi učenje.

Odločitev je poslovna, zato koda ostaja pri miru, dokler ne pade odgovor.

Omrežne blokade ni: zahteve z imeni teh pajkov v `User-Agent` dobijo 200 in
vsebino, brez `cf-mitigated`.
