# Predloga `salon_opomnik` v Meti

Kaj je treba nastaviti, da opomnik dan pred terminom sploh pride do stranke.
Koda je pripravljena in preizkušena; brez te predloge ne naredi nič.

## Zakaj predloga in ne navadno sporočilo

WhatsApp dovoli prosto pisanje stranki samo **24 ur od njenega zadnjega
sporočila**. Opomnik gre tistim, ki so rezervirali vsaj dva dni prej — kdor od
takrat ni pisal, je zunaj tega okna. Tam gredo skozi samo odobrene predloge;
navadno besedilo in gumbi so zavrnjeni enako.

Zato ne pomaga, da bi opomnik poslali »kar kot sporočilo«. Brez odobrene
predloge opomnika ni.

## Enkrat za vsako stranko, ne enkrat za FlowTek

**Predloga je vezana na račun WhatsApp Business, ne na našo aplikacijo.** Vsaka
stranka ima svojega, kar se vidi iz žetonov — `/me` vrne tri različne
identitete: Botana `122110725591430859`, Test Picerija in FlowTek si delita
`122106796623463475`, Trixy-Tatoo-Art `122110154349416908`.

Odobrena predloga torej velja **samo pri tisti stranki**. Pri naslednji je
treba ves spodnji postopek ponoviti na njenem računu, sicer pošiljanje vrne
napako 132001 — predloge s tem imenom tam ni.

To sodi v postopek priklopa nove stranke, ne v enkratno nastavitev.

## Kaj narediti

**Kje:** Meta Business Manager → WhatsApp Manager → **Message templates** →
*Create template*. Potrebuješ dostop do WhatsApp Business računa **tiste
stranke**, ki jo priklapljaš.

### 1 · Osnovno

| Polje | Vrednost |
|---|---|
| Ime | `salon_opomnik` |
| Kategorija | **Utility** |
| Jezik | **Slovenian (sl)** |

Ime mora biti natanko to — koda pošilja prav ta niz
(`src/whatsapp.js`, `reminderTemplate`). Dovoljene so male črke, številke in
podčrtaji.

**Kategorija je pomembna.** Opomnik na že dogovorjen termin je *utility*, ne
*marketing*: stranka ga pričakuje, cena je nižja in odobritev je lažja. Če ga
oddaš kot marketing, ga bo Meta morda prekategorizirala sama ali zavrnila.

### 2 · Telo sporočila

Prilepi točno to, skupaj s krepkim tiskom in presledki med odstavki:

```
⏰ *Opomnik za jutri*

Pozdravljeni! 👋

Jutri, *{{1}}* ob *{{2}}*, vas čakamo v salonu *{{3}}*.

Potrdite z *DA* ali odpovejte z *NE*.
```

Trije parametri, po vrsti:

| | Pomen | Primer za obrazec |
|---|---|---|
| `{{1}}` | datum termina | `sreda, 24. oktobra` |
| `{{2}}` | ura | `15:00` |
| `{{3}}` | ime lokala | `Frizerstvo Ana` |

Obrazec pri vsakem parametru zahteva primer vrednosti — vpiši te tri. Vrstni
red je zavezujoč: koda pošilja vrednosti v tem zaporedju in jih Meta vstavi po
številki, ne po pomenu.

**Nagovor je brez imena stranke namenoma.** Marsikateri gost se predstavi samo
s številko, zato bi bil četrti parameter pogosto prazen. Splošen nagovor je pri
sporočilu, ki ga stranka dobi brez svoje pobude, varnejši od napačnega imena.

### 3 · Gumba za hiter odgovor

Dodaj **Buttons → Quick reply**, dva, **v tem vrstnem redu**:

| Zaporedje | Besedilo gumba |
|---|---|
| prvi | `✅ DA, pridem` |
| drugi | `❌ NE, odpovem` |

**Vrstni red ni kozmetika.** Koda prvemu gumbu pripne tovor `opomnik_da_<id>`
in drugemu `opomnik_ne_<id>`. Če ju v Meti zamenjaš, bo tap na »DA« odpovedal
termin.

Gumbov ne nastavljaj kot *Call to action* in jima ne dodajaj povezav — tovor
mora ostati hiter odgovor, sicer koda odgovora ne prepozna.

### 4 · Oddaj v pregled

Odobritev običajno traja od nekaj ur do nekaj dni. Dokler stanje ni
**Approved**, opomnikov ne vklapljaj.

## Kako preveriti, da je res odobrena

```
node tools/preizkus-predloge.js --lokal "Test Picerija" --na 38641791370
node tools/preizkus-predloge.js --lokal "Test Picerija" --na 38641791370 --zares
```

Brez `--zares` se nič ne pošlje — izpiše se le, kaj bi odšlo in komu.

Seznama predlog od tu ni mogoče prebrati: za to je potreben id računa WhatsApp
Business, ki ga nikjer ne hranimo (`sb_salons` ima le `whatsapp_phone_number_id`
in `whatsapp_access_token`), v Railwayu ga ni, in iz sistemskega žetona se ga ne
da izluščiti — `whatsapp_business_management` je podeljen brez omejitve na
račune, zato v `debug_token` ni nobenega id-ja.

Poskus pošiljanja je zato edina preverba, ki nam je na voljo — in hkrati
močnejša od seznama, ker potrdi celo pot: ime predloge, jezik in število
parametrov. Odgovori, ki nekaj povedo:

| koda | pomen |
|---|---|
| sprejeto | predloga obstaja, je odobrena in parametri se ujemajo |
| 132001 | predloge s tem imenom in jezikom na tem računu ni |
| 132005 | predloga ni odobrena |
| 132000 | število parametrov se ne ujema s predlogo |

**Česar ta preverba ne pove, je vrstni red gumbov.** Tega je treba pogledati na
telefonu: levi mora biti DA, desni NE. Gumba v preizkusnem sporočilu je varno
tapniti — v tovoru je `preizkus-brez-termina` in ne pravi id, zato se ne more
ničesar odpovedati; bot odgovori, da tega termina ni več med prihajajočimi.

Stanje 26. 10. 2026: predloga je potrjena na računu Test Picerije in FlowTeka
(`122106796623463475`). Pri Botani in Trixyju je ni.

## Ko je predloga odobrena

1. **Preizkus samo na TEST Frizerju.** Botana in Trixy-Tatoo-Art sta pravi
   stranki; opomnik, ki bi jima odšel po pomoti, je sporočilo njunemu gostu.
2. V bazi naredi termin za jutri: `status = confirmed`, `reminder_sent = false`,
   `created_at` vsaj dva dni nazaj.
3. Sproži `sendReminders()` ročno in preveri, da predloga pride na telefon.
4. Tapni ❌ — termin mora dobiti status `cancelled`, stranka potrditev odpovedi,
   lastnik obvestilo, ura pa mora biti spet med prostimi.
5. Šele nato v Railwayu nastavi spremenljivko **`SCHEDULER=1`**.

Zadnji korak prižge **šest** dnevnih opravil, ne samo opomnikov: prošnje za
oceno, reaktivacije po osmih tednih, dnevni povzetek, opomnike za podaljšanje
naročnine in obvestila ob poteku. Preden ga nastaviš, poglej, kaj od tega želiš
imeti vklopljeno. Sprememba spremenljivke ne zahteva nove objave in jo je enako
hitro mogoče umakniti.

## Česar ta dokument ne trdi

Metina javna dokumentacija na straneh, ki so dosegljive brez prijave, ne navaja
niti največje dolžine napisa na gumbu niti tega, ali sme biti parameter prazen.
Oboje se pokaže v obrazcu ob vnosu — če te omeji, se drži tega, kar dovoli, in
javi, da se je besedilo moralo spremeniti. Besedilo predloge in
`opomnik.besedilo()` v kodi se morata ujemati; če se razideta, je v kodi
napačen zapis tistega, kar stranka res dobi.
