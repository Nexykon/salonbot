# Nagovarjanje lokalov — kako teče

Trideset lokalov na dan, vsak dobi svoje pismo s sliko, narejeno zanj.
Pošilja se ročno iz poštnega predala; koda ne pošlje ničesar.

## Vsakodnevni krog

```
1.  node tools/paket.js --panoga RESTAVRACIJE --koliko 30
        pokaže, koga bi vzel in koga izločil — nič ne zapiše

2.  node tools/paket.js --panoga RESTAVRACIJE --koliko 30 --zares
        zapiše izločene, izriše slike, sestavi pisma v out/

3.  out/paket.md
        kazalo: lokal, kraj, e-naslov, zadeva, ime datoteke

4.  za vsako vrstico: odpri out/pismo-<slug>.html v brskalniku,
        označi vse, kopiraj, prilepi v Roundcube, pošlji

5.  node tools/izid.js --zares
        zapiše v bazo, kaj je bilo poslano in kaj zavrnjeno
```

**Petega koraka se ne da preskočiti.** Pisma odidejo iz poštnega odjemalca in
baza o tem ne ve nič; brez zapisa se isti lokali jutri vrnejo v vrsto in
dobijo drugo pismo.

Pred vsakim novim paketom v `tools/izid.js` popravi seznama `ZAVRNJENI` in
`BREZ_SLIKE` po poročilu o dostavi.

## Ime, ki gre v sliko

Ime se izpelje iz registra, register pa ni napis nad lokalom. Iz
`GOSTILNA FRANCL, PETER ZAVERŠEK S.P.` nastane »Gostilna Francl Peter
Zaveršek«, iz `OKREPČEVALNICA - BISTRO TANJA TANJA DERVARIČ S.P.« pa
»Okrepčevalnica - Bistro Tanja Tanj« — odrezano sredi besede.

To ni lepotna napaka. Slika je edino, kar je v pismu res narejeno za
prejemnika; ime z lastnikovim priimkom ali odrezano na pol pove, da je pismo
sestavil stroj. V paketu z 18. 9. je tako odšlo najmanj šest pisem.

Popravek se zapiše v **`tools/imena-lokalov.json`**, `id` → ime, kot ga
uporablja lokal sam:

```json
{ "801": "Bistro Tanja", "836": "Bar Pepi" }
```

`paket.js` tako ime označi z »ime popravljeno ročno« in takega leada ne
ponuja več v pregled — ker ga je človek očitno že pogledal. Imena, daljša od
30 znakov, izpiše posebej: v sliki bodo odrezana.

## Odločitev, ki jo mora sprejeti človek

`paket.js` preveri obliko naslova, zapis MX v DNS, packarije tipa `noreply`,
podvojene naslove in prazna imena. Delniške družbe izloči sam.

Česar **ne** more presoditi, je, ali je lokal primerna stranka. Lokale, v
katerih imenu ni gostinske besede, izpiše posebej z opozorilom, kaj bi pisalo
v sliki — tam je ime najbolj tvegano:

```
? ZA TVOJ PREGLED
   707  v sliki bi pisalo: "Qtbr"
        v registru: QTBR d.o.o.
```

Odločitev zapišeš v ukaz, da ostane ponovljiva:

```
--izloci "707=ime ni napis nad lokalom;708=naslov pripada skupini"
--vkljuci 713,745     noter kljub opozorilu
```

Razlog ni okras: v `leads.html` je to tisto, kar piše nad značko ⛔. Brez
njega je zapisano samo »ročno izločen pri pregledu«, kar čez pol leta ne pove
ne, ali je lokal odjavljen, ne, ali je bila presoja napačna in jo je vredno
preklicati. Id brez `=` dobi ta splošni razlog.

## Kaj o tem ve plošča

`leads.html` bere isto bazo, zato po vsakem koraku kaže zadnje stanje:

| Po koraku | Kaj se vidi |
|---|---|
| 2 (`paket.js --zares`) | izločeni obledijo, dobijo rdečo črto ob levem robu in značko ⛔; razlog se pokaže ob prehodu z miško. Iz filtra »Čaka na email« izpadejo. |
| 5 (`izid.js --zares`) | poslani dobijo ✓ z datumom in status 📤 Poslano; zavrnjeni gredo med ⛔ |

Presojo se da preklicati z gumbom ↩ v vrstici — zastavica in razlog padeta,
lokal se vrne v vrsto za naslednji paket. Iskanje najde tudi izločene, zato
jih je mogoče poiskati po imenu.

## Drugi paket (21. 9. 2026)

30 lokalov, id 753–836. Šestnajstim je bilo treba popraviti ime za sliko,
dvanajst jih je šlo ven:

| Zakaj ven | Kdo |
|---|---|
| ime v registru ni napis nad lokalom | Huasheng, Komunika, 3PI-K, Gema Center, Ančica, Tophit, De-Line, Port-PSP, Gostinstvo in turizem |
| naslov pripada skupini, ne lokalu | Immervoll (`office@navia.at`), Malica (`abcskupina@gmail.com`) |
| isti lokal kot drug lead | Mesarija Lečnik (824) — pismo gre na Gostilno Lečnik (826) |

Izločitve so v bazi z razlogom in jih je mogoče preklicati z gumbom ↩ v
`leads.html`, če se izkaže, da je bila presoja napačna.

Izid: **26 dostavljenih, 4 trajno zavrnjeni** (806, 808, 822, 827) — spet
13 %. Med pošiljanjem je bila zadeva spremenjena v **»AI natakar na vašem
WhatsAppu«**; dnevnik za vseh trideset navaja novo, kaj je dobilo prvih
nekaj, iz baze ni razvidno.

## Kje se zavrnitve nabirajo (60 pisem, oba paketa)

| domena | poslanih | zavrnjenih | |
|---|---|---|---|
| gmail.com | 20 | 1 | 5 % |
| siol.net | 13 | 4 | **31 %** |
| amis.net | 2 | 1 | |
| ostale lastne | 25 | 2 | |

Vzorec je majhen, a razlika med gmailom in `siol.net` je prevelika, da bi
bila naključje: `siol.net` je star ISP naslov, ki v register pride ob
ustanovitvi in ga nihče ne popravi, ko ga lokal neha uporabljati. Domena
pošto sprejema, zato preverba MX tega ne vidi.

**V vrsti je še 407 naslovov na `siol.net`.** Pri tem deležu bi to pomenilo
okoli 126 zavrnitev — dovolj, da se ugled naslova, s katerega pošiljamo,
pokvari. Preden gredo ti na vrsto, je treba nekaj spremeniti: preverjanje
naslovov pri plačljivi storitvi, manjši paketi zanje, ali klic namesto
pisma (telefon ima 3376 od 4057 lokalov).

## Kaj vemo iz podatkov po prvem paketu (18. 9. 2026)

| | |
|---|---|
| poslanih | 30 |
| dostavljenih | 26 |
| trajno zavrnjenih | 4 (13 %) |
| brez slike pri prejemniku | 1 |

**Trinajst odstotkov zavrnitev je veliko** — povprečje je 7,5 %, dobro pod
4 %. Preverba MX pove le, ali domena sprejema pošto; ali za tistim imenom
obstaja predal, se z DNS ne da videti. Trajna zavrnitev je pri hladnem
pošiljanju najdražja napaka, ker jo ponudniki berejo kot znak, da pošiljatelj
ne ve, komu piše.

Odločeno: pošiljamo naprej po 30 in vsak paket zabeležimo — seznam se čisti
sam. Druga možnost je bila plačljiva storitev za preverjanje naslovov; če se
ugled naslova pokvari, je to prvi ukrep.

**Gmail vloženo sliko prikaže** (preverjeno s pravim pismom).

## Datoteke

| | |
|---|---|
| `tools/pismo-predloga.html` | predloga pisma — postavitev, barve, gumb |
| `tools/pismo.js` | sestavi eno pismo (besedilo, zadeva, UTM) |
| `tools/imena-lokalov.json` | ročno popravljena imena za sliko (id → ime) |
| `tools/paket.js` | izbor iz baze, preverbe, cel paket naenkrat |
| `tools/izid.js` | zapis izida v bazo |
| `tools/nagovor.js` | lokalna konzola: vrsta, kanali, beleženje stikov |
| `../flowtek-video/orodja/vabila.js` | izris personaliziranih slik |

`out/` je v `.gitignore`: sestavljena pisma vsebujejo ime in naslov
konkretnega lokala in v repozitorij ne sodijo. Po poslanem paketu jih izbriši.

## Kaj je še odprto

- Podpis domene (SPF, DKIM, DMARC) za naslov, s katerega se pošilja.
  Če bodo pisma pristajala med Promocijami, je to prvi ukrep.
- Ločena poddomena za hladno pošto, da ugled `flowtek.si` ostane za
  prijavne povezave in obvestila strankam.
- Drugi krog za tiste, ki niso odgovorili. Vsak naslednji stik mora prinesti
  nekaj novega; »samo preverjam« ne šteje.
