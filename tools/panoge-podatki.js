// Vsebina panožnih podstrani. Vir: Claude Design projekt FlowTiq (panoge.js).
// Ureja se tukaj, potem se požene:  node tools/gradi-panoge.js

module.exports = [
  {
    slug: "restavracije", mono: "RE", ime: "Restavracije in picerije",
    za: "restavracije in picerije",
    kratko: "Naročila za dostavo in prevzem ter rezervacije miz — direktno na tvoj WhatsApp, brez provizij.",
    naslov: "Naročila brez zvonjenja.\nIn brez 28 % provizije.",
    podnaslov: "Gost napiše na WhatsApp, FlowTiq mu pokaže meni, sestavi naročilo in ga pošlje v kuhinjo. Ti kuhaš naprej.",
    boli: [
      { t: "Telefon zvoni med špico", o: "Kuhinja gori, natakar drži slušalko. En zamujen klic je eno naročilo pri konkurenci." },
      { t: "Tržnice vzamejo skoraj tretjino", o: "Pri 20 € naročilu ti ostane 14 €. Pri 100 dostavah na mesec je to cena zaposlenega." },
      { t: "Ocene padajo zaradi neodgovorjenih sporočil", o: "Gost, ki ne dobi odgovora, ne napiše lepe ocene. Napiše slabo." }
    ],
    primeri: [
      { t: "Naročilo za dostavo", o: "Gost napiše „eno capriccioso in dve koli“. FlowTiq razume, sestavi košarico, vpraša za naslov in čas ter potrdi ceno." },
      { t: "Osebni prevzem", o: "„Bi vzel ob 19:00.“ Bot preveri obremenitev kuhinje in predlaga realen čas, ne pa nemogočega." },
      { t: "Rezervacija mize", o: "„Miza za 4 v petek ob 20h.“ Preveri zasedenost, potrdi in dan prej pošlje opomnik." },
      { t: "Vprašanja o ponudbi", o: "„A imate kaj brez laktoze?“ Bot odgovori iz tvojega menija — brez ugibanja." },
      { t: "Dnevna malica", o: "Vsak dan ob 10:00 samodejno pošlje dnevno ponudbo tistim, ki so se prijavili." },
      { t: "Naročilo v blagajno", o: "Potrjeno naročilo pade v Poster POS, Square, iiko ali Loyverse. Nič pretipkavanja." }
    ],
    pogovor: [
      { k: "g", t: "dober dan, eno margherito in eno solato cezar za dostavo" },
      { k: "b", t: "Dober dan! Dodal sem 1× Margherita in 1× Solata Cezar — skupaj 16,80 €. Na kateri naslov dostavimo?" },
      { k: "g", t: "Trubarjeva 12, čim prej" },
      { k: "b", t: "Zabeleženo. Dostava ob 19:25 (±10 min). Plačilo ob prevzemu z gotovino ali kartico. Naj potrdim?" },
      { k: "g", t: "ja" },
      { k: "b", t: "Naročilo je potrjeno in že v kuhinji. Hvala!" }
    ],
    stevilke: [
      { v: "0 %", o: "provizije na naročilo" },
      { v: "≈ 550 €", o: "prihranek na mesec pri 100 dostavah" },
      { v: "< 2 s", o: "odziv tudi med špico" }
    ],
    faq: [
      { v: "Kaj če je kuhinja polna?", o: "Nastaviš, koliko naročil na 15 minut zmoreš. Ko je meja dosežena, bot ponudi naslednji prosti termin, namesto da obljubi nemogoče." },
      { v: "Se poveže z našo blagajno?", o: "Da — Poster POS, Square, iiko in Loyverse. Če imaš drug sistem, naročila vidiš na nadzorni plošči." },
      { v: "Lahko sprejema plačila?", o: "Naročila potekajo kot doslej: gotovina ali kartica ob prevzemu. Spletno plačilo dodamo na željo." }
    ]
  },
  {
    slug: "frizerski-saloni", mono: "FR", ime: "Frizerski saloni",
    za: "frizerske salone",
    kratko: "Termini se naročajo sami, medtem ko ti strižeš. Opomniki dan prej zmanjšajo prazne stole.",
    naslov: "Strižeš.\nTermini se polnijo sami.",
    podnaslov: "Stranka napiše na WhatsApp, FlowTiq pogleda tvoj koledar in ji da prost termin. Brez prekinjanja dela.",
    boli: [
      { t: "Roke v laseh, telefon zvoni", o: "Ne moreš odgovoriti sredi barvanja. Stranka pokliče naslednji salon." },
      { t: "Sporočila ob desetih zvečer", o: "Odgovoriš zjutraj — stranka je že naročena drugje." },
      { t: "Prazni stoli zaradi pozabljivosti", o: "Termin ob 15h, nihče ne pride. Ura in pol tvojega časa je izgubljena." }
    ],
    primeri: [
      { t: "Naročanje na termin", o: "„Bi na striženje v sredo popoldne.“ Bot pokaže tri proste ure, stranka izbere eno." },
      { t: "Različno dolge storitve", o: "Barvanje traja 2 uri, striženje 40 minut. Bot rezervira pravo dolžino, ne enotnega bloka." },
      { t: "Izbira frizerke", o: "„Pri Ani, prosim.“ Vsak zaposlen ima svoj koledar in svoje storitve." },
      { t: "Opomnik dan prej", o: "„Jutri ob 15:00 pri Ani. Potrdi z DA ali odpovej z NE.“ Odpovedan termin se takoj sprosti." },
      { t: "Zbiranje Google ocen", o: "Po obisku bot prijazno vpraša za oceno in ponudi povezavo. Brez tvojega opominjanja." },
      { t: "Vabilo nazaj", o: "Stranke, ki jih 8 tednov ni bilo, dobijo prijazno povabilo. Koledar se polni iz strank, ki jih že imaš." }
    ],
    pogovor: [
      { k: "g", t: "živjo, a je kje kaj prostega za striženje ta teden?" },
      { k: "b", t: "Živjo! Prosto imamo: sreda 14:00, sreda 17:30, četrtek 10:00. Kaj ti ustreza?" },
      { k: "g", t: "sreda 17:30" },
      { k: "b", t: "Zabeleženo — sreda 17:30, striženje (40 min) pri Ani. Dan prej ti pošljem opomnik." }
    ],
    stevilke: [
      { v: "do −30 %", o: "manj praznih terminov" },
      { v: "24/7", o: "naročanje tudi ponoči" },
      { v: "≈ 16 h", o: "manj telefoniranja na mesec" }
    ],
    faq: [
      { v: "Moram uporabljati nov koledar?", o: "Ne nujno. FlowTiq ima svoj koledar, lahko pa ga poveže z Google koledarjem, ki ga že uporabljaš." },
      { v: "Kaj če hočem termin dodati sam?", o: "Napišeš botu ali klikneš v nadzorni plošči. Oboje deluje." },
      { v: "Kaj pa stranke, ki raje pokličejo?", o: "Nič se ne spremeni — telefon dela naprej. FlowTiq prevzame samo tiste, ki pišejo." }
    ]
  },
  {
    slug: "kozmetika", mono: "KO", ime: "Kozmetika in nohti",
    za: "kozmetiko in nohte",
    kratko: "Manikura, trepalnice, obrazi — vsaka storitev s svojo dolžino in svojo pripravo.",
    naslov: "Nohti so tvoje delo.\nUrnik naj bo naš.",
    podnaslov: "FlowTiq pozna vse tvoje storitve, njihove dolžine in navodila pred obiskom. Stranki jih pošlje sam.",
    boli: [
      { t: "Roke zasedene, telefon ne", o: "Med gelom se ne da odgovarjati. Vsak neodgovorjen DM je izgubljen termin." },
      { t: "Stranke ne vejo, kaj naj izberejo", o: "„Kakšna je razlika med gel lakom in podaljševanjem?“ Isto vprašanje petkrat na dan." },
      { t: "Neprihodi na dolge storitve", o: "Prazen tritirni blok popoldne je izgubljen dan." }
    ],
    primeri: [
      { t: "Naročanje po storitvi", o: "Bot pokaže tvoj cenik, stranka izbere in dobi točno ceno ter trajanje." },
      { t: "Navodila pred obiskom", o: "„Pridi brez laka in brez kreme na rokah.“ Samodejno, dan prej." },
      { t: "Odgovori na vprašanja", o: "Razlike med storitvami, trajanje, vzdrževanje — odgovori iz tvojih besedil." },
      { t: "Ponovni obisk na 3 tedne", o: "Ko se lak obrabi, stranka že dobi vabilo za naslednji termin." },
      { t: "Depozit za dolge storitve", o: "Pri storitvah nad 2 uri lahko bot zahteva potrditev dan prej, drugače termin sprosti." },
      { t: "Google ocena", o: "Dve uri po obisku prijazno vpraša za oceno. Več zvezdic, več novih strank." }
    ],
    pogovor: [
      { k: "g", t: "koliko stane gel lak in kdaj je kaj prostega" },
      { k: "b", t: "Gel lak je 30 € in traja 60 minut. Prosto: torek 11:00, torek 16:00, sreda 9:00." },
      { k: "g", t: "torek 16h" },
      { k: "b", t: "Zabeleženo, torek 16:00. Pridi brez starega laka — tako prihraniva 15 minut." }
    ],
    stevilke: [
      { v: "24/7", o: "naročanje brez tvojega telefona" },
      { v: "do −30 %", o: "manj neprihodov" },
      { v: "+ ocene", o: "samodejna prošnja po obisku" }
    ],
    faq: [
      { v: "Imam veliko različnih storitev.", o: "Vsako vpišeš enkrat — ime, ceno, trajanje. Bot potem ve, koliko časa rezervirati." },
      { v: "Delam sama, brez pomoči.", o: "Točno za to je narejeno. FlowTiq je tvoja receptorka, ki ne gre na malico." },
      { v: "Lahko blokiram dopust?", o: "Da, v nadzorni plošči ali kar prek WhatsAppa: „od 15. do 22. zaprto“." }
    ]
  },
  {
    slug: "tattoo", mono: "TA", ime: "Tattoo in piercing",
    za: "tattoo in piercing studie",
    kratko: "Povpraševanja z referenčnimi slikami, oceno velikosti in depozitom — brez neskončnega dopisovanja.",
    naslov: "Manj dopisovanja.\nVeč časa za iglo.",
    podnaslov: "FlowTiq zbere vse, kar rabiš za oceno: motiv, velikost, mesto na telesu in sliko. Ti samo potrdiš termin.",
    boli: [
      { t: "Dvajset sporočil za eno tatoo", o: "Vedno ista vprašanja o velikosti, mestu in ceni, preden pride do termina." },
      { t: "Ljudje ne pridejo na dolge seanse", o: "Cel dan blokiran, stranka pa se ne oglasi." },
      { t: "Povpraševanja izgubljena v DM-ih", o: "Instagram, WhatsApp, mail — nekaj vedno pade skozi." }
    ],
    primeri: [
      { t: "Zbiranje povpraševanja", o: "Bot vpraša za motiv, velikost v cm, mesto na telesu in referenčno sliko. Vse na enem mestu." },
      { t: "Ocena cene in trajanja", o: "Po tvojih pravilih (npr. 100 €/h, minimum 80 €) pošlje okvirno oceno." },
      { t: "Depozit pred rezervacijo", o: "Termin se potrdi šele po nakazilu. Manj praznih dni." },
      { t: "Navodila pred in po", o: "Pred: naspan, sit, brez alkohola. Po: nega kože. Samodejno, ob pravem času." },
      { t: "Konzultacija", o: "Za večje projekte rezervira 20-minutni pogovor namesto celotne seanse." },
      { t: "Piercing brez čakanja", o: "Kratki posegi se naročajo v 15-minutnih oknih, brez klicanja." }
    ],
    pogovor: [
      { k: "g", t: "zanima me tattoo na podlahti, pošiljam sliko" },
      { k: "b", t: "Super. Približno koliko centimetrov naj bo (višina)?" },
      { k: "g", t: "okoli 12 cm, črno belo" },
      { k: "b", t: "To je okvirno 2–2,5 ure, 200–250 €. Prosto: 14. ob 11:00 ali 19. ob 10:00. Depozit 50 € potrdi termin." }
    ],
    stevilke: [
      { v: "1 sporočilo", o: "namesto dvajsetih" },
      { v: "depozit", o: "potrdi termin pred rezervacijo" },
      { v: "0", o: "izgubljenih povpraševanj" }
    ],
    faq: [
      { v: "Lahko stranka pošlje sliko?", o: "Da. Slike, ki jih pošlje na WhatsApp, se shranijo k povpraševanju." },
      { v: "Cene so pri meni po dogovoru.", o: "Bot lahko pošlje samo razpon in te opozori, da oceno potrdiš ročno." },
      { v: "Kaj z mladoletnimi?", o: "Bot vpraša za starost in pri mladoletnih takoj pojasni, da posega ne izvajate." }
    ]
  },
  {
    slug: "wellness", mono: "WE", ime: "Masaže in wellness",
    za: "masaže in wellness",
    kratko: "Termini, paketi in darilni boni — brez motenja med masažo.",
    naslov: "Med masažo\nne dvigaš telefona.",
    podnaslov: "FlowTiq sprejema rezervacije, prodaja darilne bone in opominja stranke, ko se paket izteka.",
    boli: [
      { t: "Telefon moti terapijo", o: "Zvonjenje sredi masaže pokvari izkušnjo — in ti stranko." },
      { t: "Paketi se izgubijo", o: "Kdo ima še koliko obiskov od desetih? Nihče ne ve točno." },
      { t: "Prazne ure sredi dneva", o: "Dopoldan je pogosto prazno, čeprav bi ga kdo vzel s popustom." }
    ],
    primeri: [
      { t: "Rezervacija termina", o: "Stranka izbere vrsto masaže in dolžino (30, 60, 90 min), bot rezervira pravo okno." },
      { t: "Paketi obiskov", o: "Bot vodi štetje: „Ostali so ti še 3 obiski od 10.“" },
      { t: "Darilni bon", o: "Stranka naroči bon prek WhatsAppa, ti ga potrdiš. Idealno pred prazniki." },
      { t: "Zapolnitev mrtvih ur", o: "Ob praznem dopoldnevu pošlje ponudbo bližnjim strankam." },
      { t: "Kontraindikacije", o: "Pred prvim obiskom vpraša za nosečnost, poškodbe, zdravila — po tvojem seznamu." },
      { t: "Opomnik in nega po", o: "Dan prej opomnik, po masaži nasvet o pitju vode in počitku." }
    ],
    pogovor: [
      { k: "g", t: "a imate kaj prostega za sproščujočo masažo 60 min" },
      { k: "b", t: "Da. Danes 16:00, jutri 11:00 ali 18:30. Cena 55 €, trajanje 60 minut." },
      { k: "g", t: "jutri 11" },
      { k: "b", t: "Rezervirano. Pridi 5 minut prej. Če imaš kakšno poškodbo ali si noseča, mi napiši." }
    ],
    stevilke: [
      { v: "0", o: "prekinitev med terapijo" },
      { v: "paketi", o: "samodejno štetje obiskov" },
      { v: "boni", o: "prodaja brez klicev" }
    ],
    faq: [
      { v: "Delamo v dvoje, en prostor.", o: "Nastaviš število sob in terapevtov. Bot ne rezervira dveh strank v isto sobo." },
      { v: "Lahko vodi darilne bone?", o: "Da, izda kodo in jo ob unovčenju označi kot porabljeno." },
      { v: "Kaj z odpovedmi zadnji trenutek?", o: "Nastaviš pravilo (npr. odpoved do 12 ur prej brezplačno). Bot ga pove ob rezervaciji." }
    ]
  },
  {
    slug: "zobozdravniki", mono: "ZD", ime: "Zobozdravniki in ambulante",
    za: "zobozdravnike in ambulante",
    kratko: "Naročanje, opomniki in triaža nujnih primerov — brez zasedene linije.",
    naslov: "Linija ni več zasedena.",
    podnaslov: "FlowTiq sprejme naročilo, pošlje opomnik in nujne primere takoj označi, da jih vidiš prvi.",
    boli: [
      { t: "Zasedena telefonska linija", o: "Pacient kliče petkrat, potem gre drugam." },
      { t: "Neprihodi na kontrole", o: "Prazen termin je izgubljen prihodek in daljša čakalna vrsta." },
      { t: "Nujni primeri se ne prepoznajo takoj", o: "Pacient z bolečino pusti sporočilo in čaka enako dolgo kot vsi ostali." }
    ],
    primeri: [
      { t: "Naročanje na pregled", o: "Pacient izbere vrsto obiska (pregled, čiščenje, kontrola) in dobi prost termin." },
      { t: "Triaža nujnih primerov", o: "Pri bolečini bot takoj označi primer kot nujen in ti pošlje obvestilo." },
      { t: "Opomniki in potrditve", o: "48 in 24 ur prej. Nepotrjen termin se sprosti in je spet na voljo." },
      { t: "Redne kontrole na 6 mesecev", o: "Bot sam povabi paciente na kontrolo, ko pride čas." },
      { t: "Napotki pred posegom", o: "„Pridi na tešče“, „vzemi kartico zavarovanja“ — samodejno." },
      { t: "Odgovori na cene", o: "Cenik samoplačniških storitev pošlje takoj, brez čakanja na receptorko." }
    ],
    pogovor: [
      { k: "g", t: "dober dan, boli me zob, rabim čim prej" },
      { k: "b", t: "Razumem. Bolečina ima prednost — imamo prosto danes ob 14:40. Vam ustreza?" },
      { k: "g", t: "da, hvala" },
      { k: "b", t: "Zabeleženo, danes 14:40. Prinesite kartico zdravstvenega zavarovanja." }
    ],
    stevilke: [
      { v: "0", o: "zasedenih linij" },
      { v: "do −30 %", o: "manj neprihodov" },
      { v: "nujno", o: "primeri označeni takoj" }
    ],
    faq: [
      { v: "Kako je z zdravstvenimi podatki?", o: "Bot ne zbira diagnoz. Zbere le ime, kontakt in vrsto obiska. Podatki so v EU, po GDPR." },
      { v: "Lahko nadomesti receptorko?", o: "Nadomesti tisti del, ki je ponavljajoč: naročanje in opomniki. Zahtevnejše pogovore prevzame človek." },
      { v: "Več zdravnikov v ordinaciji?", o: "Da, vsak ima svoj koledar in svoje vrste posegov." }
    ]
  },
  {
    slug: "avtoservisi", mono: "AV", ime: "Avtoservisi in vulkanizerji",
    za: "avtoservise in vulkanizerje",
    kratko: "Termini za servis in menjavo gum, obvestila o končanem popravilu — brez klicanja nazaj.",
    naslov: "Roke v olju.\nTermini vseeno urejeni.",
    podnaslov: "Stranka napiše registrsko in kaj potrebuje, FlowTiq ji da termin. Ko je avto gotov, jo obvesti.",
    boli: [
      { t: "Telefon zvoni, roke umazane", o: "Sredi popravila ne moreš dvigniti. Klic ostane neodgovorjen." },
      { t: "Sezonska gneča", o: "Oktobra in aprila ti telefon ne da miru dva tedna." },
      { t: "Stranke sprašujejo, ali je avto gotov", o: "Pet klicev na dan samo za to." }
    ],
    primeri: [
      { t: "Termin za servis", o: "Stranka izbere vrsto dela (servis, zavore, klima) in dobi realen termin z oceno trajanja." },
      { t: "Menjava gum v sezoni", o: "Bot razporedi menjave v 30-minutna okna in prepreči gnečo v delavnici." },
      { t: "Podatki o vozilu vnaprej", o: "Registrska, znamka, letnik, prevoženi kilometri — vse pripravljeno pred prihodom." },
      { t: "Obvestilo „avto je gotov“", o: "Klikneš v nadzorni plošči, stranka dobi sporočilo. Nič klicanja." },
      { t: "Opomnik na servis", o: "Čez leto ali ob dogovorjenih kilometrih bot sam povabi na naslednji servis." },
      { t: "Hramba gum", o: "Bot ve, kdo ima gume pri tebi, in ga jeseni sam pokliče na menjavo." }
    ],
    pogovor: [
      { k: "g", t: "rabim menjavo gum, golf, LJ 12-34A" },
      { k: "b", t: "Zabeležil. Menjava traja 30 min. Prosto: sreda 8:30, sreda 13:00, četrtek 9:00." },
      { k: "g", t: "sreda 8:30" },
      { k: "b", t: "Potrjeno, sreda 8:30. Gume imaš pri nas v hrambi — pripravimo jih." }
    ],
    stevilke: [
      { v: "30 min", o: "okna brez gneče v sezoni" },
      { v: "0", o: "klicev „je avto gotov?“" },
      { v: "24/7", o: "naročanje tudi po zaprtju" }
    ],
    faq: [
      { v: "Delo se pogosto zavleče.", o: "Termin lahko premakneš z enim sporočilom botu — stranka takoj dobi obvestilo." },
      { v: "Rabim podatke o vozilu.", o: "Bot jih vpraša vnaprej in ti jih pokaže ob terminu." },
      { v: "Lahko pošilja ponudbe?", o: "Da — npr. „akcija na klimo“ vsem strankam, ki jih že imaš v bazi." }
    ]
  },
  {
    slug: "veterina", mono: "VE", ime: "Veterinarske ambulante",
    za: "veterinarske ambulante",
    kratko: "Termini po živali, opomniki na cepljenja in obvladana nujnost.",
    naslov: "Za vsako tačko\nsvoj termin.",
    podnaslov: "FlowTiq si zapomni žival, njeno vrsto in datum zadnjega cepljenja — in lastnika sam povabi, ko pride čas.",
    boli: [
      { t: "Nujni primeri se izgubijo med klici", o: "Zaskrbljen lastnik ne bi smel čakati na zasedeni liniji." },
      { t: "Cepljenja zamujena", o: "Nihče ne vodi seznama, kdo mora priti letos." },
      { t: "Ponavljajoča vprašanja o cenah", o: "„Koliko stane sterilizacija mačke?“ vsak dan znova." }
    ],
    primeri: [
      { t: "Naročanje po živali", o: "Bot vpraša za vrsto, ime in starost. Termin dobi pravo dolžino." },
      { t: "Nujen primer", o: "Ob znakih nujnosti (strup, krvavitev, težko dihanje) takoj pokaže telefon in te obvesti." },
      { t: "Opomnik na cepljenje", o: "Leto po zadnjem cepljenju lastnik dobi vabilo z že predlaganim terminom." },
      { t: "Priprava pred posegom", o: "„Mačka naj bo 12 ur tešča.“ Samodejno, dan prej." },
      { t: "Cene in odgovori", o: "Bot pošlje cenik osnovnih storitev in navodila, kaj prinesti." },
      { t: "Obvestilo po operaciji", o: "Ko je žival zbujena, lastnik dobi sporočilo. Manj klicev v ambulanto." }
    ],
    pogovor: [
      { k: "g", t: "moj pes ima izpuščaje, bi rabil pregled" },
      { k: "b", t: "Kako mu je ime in koliko je star?" },
      { k: "g", t: "Rex, 4 leta" },
      { k: "b", t: "Hvala. Prosto: danes 17:20 ali jutri 9:00. Prinesite knjižico cepljenj." }
    ],
    stevilke: [
      { v: "nujno", o: "prepoznano takoj" },
      { v: "cepljenja", o: "samodejni opomniki" },
      { v: "24/7", o: "sprejem povpraševanj" }
    ],
    faq: [
      { v: "Ali bot postavlja diagnoze?", o: "Ne. Nikoli. Zbere opis, oceni nujnost in naroči na pregled." },
      { v: "Kaj pri pravih nujnostih?", o: "Bot takoj napiše, naj lastnik pokliče, in ti pošlje obvestilo. Ne zadržuje ga v pogovoru." },
      { v: "Vodi zgodovino živali?", o: "Osnovno: žival, lastnik, obiski, cepljenja. Ni nadomestilo kartoteke." }
    ]
  },
  {
    slug: "fotografi", mono: "FO", ime: "Fotografi",
    za: "fotografe",
    kratko: "Povpraševanja s termini, lokacijami in paketi — ter avans, ki potrdi datum.",
    naslov: "Povpraševanja urejena.\nDatumi potrjeni.",
    podnaslov: "FlowTiq zbere vrsto snemanja, datum, lokacijo in število oseb, pošlje cenik in rezervira datum z avansom.",
    boli: [
      { t: "Vsako povpraševanje je deset sporočil", o: "Datum, lokacija, koliko oseb, koliko fotografij — vedno znova." },
      { t: "Dvojno obljubljeni datumi", o: "Poroka in krst na isti dan. Neprijetno." },
      { t: "Ljudje si premislijo", o: "Datum je bil blokiran mesece, potem pa nič." }
    ],
    primeri: [
      { t: "Zbiranje povpraševanja", o: "Vrsta (poroka, družina, portret, produkt), datum, lokacija, število oseb — vse v enem pogovoru." },
      { t: "Pošiljanje cenika", o: "Bot pošlje ustrezen paket glede na vrsto snemanja." },
      { t: "Blokada datuma z avansom", o: "Datum je rezerviran šele po nakazilu. Manj odpovedi." },
      { t: "Priprava pred snemanjem", o: "Kaj obleči, kje se dobimo, koliko časa vzame — dan prej." },
      { t: "Obvestilo o galeriji", o: "Ko so fotografije gotove, stranka dobi povezavo in geslo." },
      { t: "Sezonske akcije", o: "Novembra povabilo na božične družinske portrete vsem preteklim strankam." }
    ],
    pogovor: [
      { k: "g", t: "zanima me družinsko fotografiranje v septembru" },
      { k: "b", t: "Z veseljem. Koliko oseb in ali imate željo za lokacijo — studio ali narava?" },
      { k: "g", t: "4 osebe, raje v naravi" },
      { k: "b", t: "Paket Družina (60 min, 15 obdelanih fotografij) je 190 €. Prosto: 12., 19. in 26. september ob 17:30." }
    ],
    stevilke: [
      { v: "1 pogovor", o: "namesto desetih sporočil" },
      { v: "avans", o: "datum potrjen šele s plačilom" },
      { v: "0", o: "dvojno obljubljenih datumov" }
    ],
    faq: [
      { v: "Delam v več mestih.", o: "Bot vpraša za lokacijo in doda potne stroške po tvojem pravilu." },
      { v: "Cene so po dogovoru.", o: "Bot pošlje razpon in te obvesti, da ponudbo dokončaš sam." },
      { v: "Lahko pošilja pogodbe?", o: "Pošlje povezavo do tvojega dokumenta ali obrazca. Podpis ostane pri tebi." }
    ]
  },
  {
    slug: "trenerji", mono: "TR", ime: "Osebni trenerji in fitnes",
    za: "osebne trenerje in fitnes",
    kratko: "Termini, skupinske vadbe z omejenimi mesti in paketi treningov.",
    naslov: "Ti trenirate.\nUrnik se ureja sam.",
    podnaslov: "FlowTiq vodi individualne termine in skupinske vadbe z omejenim številom mest, šteje pa tudi porabljene treninge iz paketa.",
    boli: [
      { t: "Prijave na vadbo v treh kanalih", o: "Nekdo napiše na WhatsApp, drug na Instagram, tretji v živo. Kaos." },
      { t: "Odpovedi zadnji trenutek", o: "Prosto mesto ostane prazno, čeprav bi ga kdo vzel." },
      { t: "Paketi treningov brez pregleda", o: "Koliko treningov ima še kdo? Ugibanje." }
    ],
    primeri: [
      { t: "Individualni termin", o: "Stranka izbere prost termin, bot ga rezervira in doda v tvoj koledar." },
      { t: "Skupinska vadba z mesti", o: "„Joga, torek 18:00, prostih 3 od 12.“ Ko se zapolni, bot to takoj pove." },
      { t: "Odpoved sprosti mesto", o: "Odpovedan termin se takoj vrne med proste — naslednji, ki vpraša, ga dobi." },
      { t: "Paketi treningov", o: "Bot šteje porabljene treninge in opozori, ko se paket izteka." },
      { t: "Opomniki", o: "Dve uri pred vadbo. Manj praznih mest, manj čakanja." },
      { t: "Mesečno obračunavanje", o: "Pregled obiskov po stranki za obračun ob koncu meseca." }
    ],
    pogovor: [
      { k: "g", t: "a je še kaj prostega za jogo v torek" },
      { k: "b", t: "Torek 18:00 — prosta 2 mesta od 12. Naj te prijavim?" },
      { k: "g", t: "ja prosim" },
      { k: "b", t: "Prijavljena. Ostala so ti še 4 treninga od paketa 10. Opomnik dobiš dve uri prej." }
    ],
    stevilke: [
      { v: "mesta", o: "sproti in točno" },
      { v: "odpovedi", o: "mesto se takoj sprosti" },
      { v: "paketi", o: "samodejno štetje" }
    ],
    faq: [
      { v: "Imam več vrst vadb.", o: "Vsaka ima svoj urnik, kapaciteto in ceno." },
      { v: "Kaj z online treningi?", o: "Bot pošlje povezavo do srečanja ob potrditvi termina." },
      { v: "Delam v več studiih?", o: "Da, nastaviš lokacije. Bot jo pove ob vsaki rezervaciji." }
    ]
  },
  {
    slug: "hoteli", mono: "HO", ime: "Hoteli in apartmaji",
    za: "hotele in apartmaje",
    kratko: "Povpraševanja o prostih terminih, direktne rezervacije brez provizij portalov, navodila za prihod.",
    naslov: "Direktne rezervacije.\nBrez 15 % portalu.",
    podnaslov: "FlowTiq odgovori na povpraševanje v sekundi, pove ceno in razpoložljivost ter potrdi direktno rezervacijo.",
    boli: [
      { t: "Portali vzamejo svoj delež", o: "Vsaka rezervacija prek portala je 15–18 % manj zaslužka." },
      { t: "Povpraševanja pridejo ponoči", o: "Gost sprašuje ob 23h, ti odgovoriš zjutraj — rezerviral je drugje." },
      { t: "Ista vprašanja o prihodu", o: "Kje parkirati, kdaj je prijava, kje je ključ. Vsak teden znova." }
    ],
    primeri: [
      { t: "Prosti termini in cena", o: "„Od 12. do 15. avgusta, 2 osebi?“ Bot pove razpoložljivost in ceno takoj." },
      { t: "Direktna rezervacija", o: "Gost potrdi, bot blokira datume in pošlje podatke za plačilo ali avans." },
      { t: "Navodila za prihod", o: "Naslov, parkiranje, koda za ključavnico — dan pred prihodom." },
      { t: "Dodatne storitve", o: "Zajtrk, pozna prijava, otroška postelja — bot ponudi in zabeleži." },
      { t: "Zapolnitev vrzeli", o: "Dva prosta dneva med rezervacijama? Bot ponudi kratko bivanje s popustom." },
      { t: "Ocena po odhodu", o: "Prijazna prošnja za oceno na Googlu ali portalu, kjer ti največ pomeni." }
    ],
    pogovor: [
      { k: "g", t: "dober dan, a je apartma prost od 12. do 15. avgusta za 2 osebi?" },
      { k: "b", t: "Dober dan! Da, prost je. Tri noči, 2 osebi = 285 €, turistična taksa vključena." },
      { k: "g", t: "super, bi rezerviral" },
      { k: "b", t: "Odlično. Za potrditev je avans 30 % (85,50 €). Ko prispe, so datumi vaši." }
    ],
    stevilke: [
      { v: "0 %", o: "provizije portalov" },
      { v: "< 2 s", o: "odziv tudi ponoči" },
      { v: "direktno", o: "gost je tvoja stranka" }
    ],
    faq: [
      { v: "Imam koledar na portalu.", o: "FlowTiq lahko bere iCal povezavo, da se datumi ne podvajajo." },
      { v: "Več enot?", o: "Da, vsaka enota ima svoj koledar in svojo ceno po sezoni." },
      { v: "Kaj z jeziki?", o: "Bot lahko odgovarja v slovenščini, angleščini in nemščini." }
    ]
  },
  {
    slug: "sole", mono: "ŠO", ime: "Šole in inštrukcije",
    za: "šole in inštrukcije",
    kratko: "Prijave na termine in tečaje, obveščanje staršev, evidenca obiskov.",
    naslov: "Prijave brez\nsedmih klicev staršem.",
    podnaslov: "FlowTiq sprejme prijavo, pove urnik in ceno, opomni pred uro ter starše obvesti o spremembah.",
    boli: [
      { t: "Prijave po telefonu in mailu", o: "Seznam je v treh zvezkih in eni glavi." },
      { t: "Odpovedi uro prej", o: "Termin ostane prazen, ura je izgubljena." },
      { t: "Obveščanje o spremembah", o: "Ko odpade ura, moraš poklicati vse starše." }
    ],
    primeri: [
      { t: "Prijava na inštrukcije", o: "Predmet, razred, želen termin — bot poveže z ustreznim učiteljem." },
      { t: "Skupinski tečaji", o: "Omejeno število mest in potrditev prijave. Bot pove, koliko je še prostih." },
      { t: "Opomnik pred uro", o: "Dan prej starš in dijak dobita opomnik. Manj pozabljenih ur." },
      { t: "Obvestilo vsem naenkrat", o: "„Jutrišnja ura odpade.“ Eno sporočilo, vsi obveščeni." },
      { t: "Evidenca obiskov", o: "Kdo je prišel, kdo ne — podlaga za mesečni obračun." },
      { t: "Paketi ur", o: "Bot šteje porabljene ure in obvesti, ko je čas za nov paket." }
    ],
    pogovor: [
      { k: "g", t: "dober dan, iščem inštrukcije iz matematike za 8. razred" },
      { k: "b", t: "Dober dan! Matematika, 8. razred — 20 €/uro. Prosto: torek 17:00, četrtek 16:00." },
      { k: "g", t: "torek 17:00" },
      { k: "b", t: "Prijavljeno. Prvo uro prinesi zvezek in učbenik. Opomnik pošljem dan prej." }
    ],
    stevilke: [
      { v: "1 sporočilo", o: "za obvestilo vsem" },
      { v: "evidenca", o: "obiski za obračun" },
      { v: "24/7", o: "prijave brez tvojega časa" }
    ],
    faq: [
      { v: "Več učiteljev, več predmetov.", o: "Vsak učitelj ima svoj koledar in svoje predmete." },
      { v: "Kaj z mladoletnimi?", o: "Prijavo lahko odda starš. Bot vpraša za kontakt starša." },
      { v: "Delamo tudi online.", o: "Bot pošlje povezavo do srečanja ob potrditvi termina." }
    ]
  }
];
