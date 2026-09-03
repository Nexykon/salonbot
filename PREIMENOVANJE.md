# FlowTiq → FlowTek: kaj je narejeno in kaj mora narediti človek

Koda je pripravljena. **Preden gre v objavo, mora biti izpolnjen pogoj iz
razdelka 1** — drugače stran sama kaže na domeno, ki ne obstaja.

---

## 1 · Stanje objave

Objavljeno je bilo **brez nove domene** (tako je bilo odločeno; nabiralnik
`info@flowtek.si` že deluje). Zato:

**Preusmeritev na novo domeno je PRIVZETO IZKLOPLJENA.** Dokler flowtek.si ne
odgovarja, bi 301 pomenil, da vsak obiskovalec flowtiq.si pristane na domeni
brez odziva — stran bi bila za vse nedosegljiva. To ni tveganje, ampak
gotovost, zato je za preusmeritvijo stikalo.

### Ko bo flowtek.si priklopljen

1. registriraj domeno in usmeri DNS na isti strežnik kot `flowtiq.si`;
2. na gostovanju dodaj `flowtek.si` in `www.flowtek.si`, pridobi potrdilo TLS;
3. preveri, da `https://flowtek.si/` vrne 200;
4. na gostovanju nastavi spremenljivko in znova zaženi:

   ```
   PREUSMERI_NA_NOVO_DOMENO = 1
   ```

5. preveri, da `https://flowtiq.si/cenik.html` vrne 301 na
   `https://flowtek.si/cenik.html`;
6. `flowtiq.si` **pusti priklopljen vsaj 12 mesecev.**

Sprememba kode za to ni potrebna in ni potrebna nova objava.

### Kar do takrat ni v redu (in je znano)

Strani že vsebujejo `rel="canonical"` in `og:url` na `https://flowtek.si/...`,
sitemap in llms.txt pa naštevata novo domeno. Dokler ta ne odgovarja:

- Google bere kanonični naslov, ki vrne napako — dlje ko to traja, bolj
  verjetno je, da strani začne umikati iz indeksa;
- deljene povezave na družbenih omrežjih ne bodo pokazale predogleda.

**Zato naj bo priklop domene stvar dni, ne tednov.** Če se zavleče, je
enourno delo, da se kanonični naslovi in `og:url` začasno vrnejo na
flowtiq.si — povej in naredim.

---

## 2 · Kar je treba narediti ročno, zunaj kode

| # | Kaj | Kje |
|---|---|---|
| 1 | Registracija domene + DNS + TLS | registrar in gostovanje |
| 2 | Nabiralnik `info@flowtek.si` | ponudnik pošte |
| 3 | **Change of address** iz flowtiq.si v flowtek.si | Google Search Console (obe domeni morata biti potrjeni) |
| 4 | Nov sitemap oddaj za novo domeno | Search Console |
| 5 | Ime in naslov strani | Google Business Profile |
| 6 | Profilna slika in ime | WhatsApp Business — uporabi `public/ft-whatsapp-avatar-1024.png` |
| 7 | Podpisi v e-pošti | ročno |
| 8 | Ime in domena na računih/predračunih | preveri `src/proforma.js` (podatki podjetja Webacus ostanejo nespremenjeni) |
| 9 | Stripe: ime izdelka na položnicah | Stripe nadzorna plošča |
| 10 | Meta App: ime aplikacije, webhook domena | developers.facebook.com (webhook lahko ostane na stari domeni — 301 ga namenoma ne prestreže) |

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
