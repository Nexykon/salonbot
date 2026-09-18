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
--izloci 707,708      ven, in v bazo, da se ne vrnejo
--vkljuci 713,745     noter kljub opozorilu
```

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
