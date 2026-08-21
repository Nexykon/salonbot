// ─── Pomoč ob poljih, kjer je lahko zmotiti se ───────────────────────────
// Poleg oznake polja stoji majhen gumb z vprašajem; klik odpre okno z
// navodili. Skupno za vse plošče, da je besedilo na enem mestu.
//
// Uporaba v strani:
//   <button type="button" class="pomoc-gumb" data-pomoc="google-ocena"
//           aria-label="Kako dobim povezavo do Google ocene">?</button>
//
// Nič ni treba klicati — datoteka sama prižge poslušalca na klik.

(function () {
  var VSEBINE = {
    'google-ocena': {
      naslov: 'Kako dobiš pravo povezavo do Google ocene',
      html: '\
<p>Najbolj zanesljivo je, da povezavo <b>vzameš iz svojega Google Business Profila</b> — \
ne da jo sestavljaš na roko.</p>\
<h4>1. Če si lastnik profila (priporočeno)</h4>\
<p>Prijavi se v Google z računom, ki upravlja profil, in v Googlu poišči ime svojega lokala. \
Prikaže se upravljalna plošča profila, kjer klikneš <b>Zahtevaj ocene</b> \
(v angleščini <i>Ask for reviews</i>; včasih je pod „Promocija“ → „Zahtevaj ocene“). \
Dobiš kratko povezavo v obliki:</p>\
<pre>https://g.page/r/XXXXXXXXXXXX/review</pre>\
<p>To je prava povezava — gostu odpre okno za pisanje ocene z že izbranimi zvezdicami. \
Isto najdeš v aplikaciji Google Maps → zavihek <b>Poslovno</b> → <b>Zahtevaj ocene</b>.</p>\
<h4>2. Če nimaš dostopa do profila</h4>\
<p>Uporabi Googlov <a href="https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder" \
target="_blank" rel="noopener">Place ID Finder</a>, vpiši ime lokala, prekopiraj <b>Place ID</b> in ga vstavi v:</p>\
<pre>https://search.google.com/local/writereview?placeid=TVOJ_PLACE_ID</pre>\
<h4>Kako preveriš, ali povezava dela</h4>\
<p>Odpri jo v zasebnem oknu brskalnika. Če se odpre okno za pisanje ocene tvojega lokala, \
je prava. Če se odpre le zemljevid ali iskanje, ni.</p>\
<p class="pomoc-opomba">Povezave ne sestavljaj iz naslova, ki ga vidiš v brskalniku, ko iščeš svoj lokal — \
tiste vsebujejo začasne dele in pri gostu pogosto ne delujejo.</p>'
    }
  };

  var SLOG = '\
.pomoc-gumb{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;\
width:18px;height:18px;min-width:18px;margin-left:6px;padding:0;border:1px solid currentColor;\
border-radius:50%;background:transparent;color:inherit;opacity:.65;font:inherit;font-size:11px;\
font-weight:700;line-height:1;cursor:pointer;vertical-align:middle;flex:0 0 auto}\
.pomoc-gumb:hover,.pomoc-gumb:focus{opacity:1}\
.pomoc-ozadje{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;\
padding:20px;background:rgba(16,30,43,.55)}\
.pomoc-okno{max-width:560px;width:100%;max-height:82vh;overflow:auto;box-sizing:border-box;\
padding:22px 24px 24px;border-radius:16px;background:var(--surface,#fff);color:var(--text,#101E2B);\
box-shadow:0 18px 50px rgba(0,0,0,.3);text-align:left}\
.pomoc-glava{display:flex;align-items:flex-start;gap:12px;margin-bottom:6px}\
.pomoc-naslov{margin:0;font-size:17px;line-height:1.3;font-weight:700}\
.pomoc-zapri{margin-left:auto;flex:0 0 auto;width:30px;height:30px;padding:0;border:0;border-radius:8px;\
background:transparent;color:inherit;font:inherit;font-size:19px;line-height:1;cursor:pointer;opacity:.6}\
.pomoc-zapri:hover{opacity:1;background:var(--surface2,rgba(0,0,0,.06))}\
.pomoc-telo{font-size:14px;line-height:1.6}\
.pomoc-telo p{margin:10px 0}\
.pomoc-telo h4{margin:16px 0 4px;font-size:14px;font-weight:700}\
.pomoc-telo pre{margin:8px 0;padding:10px 12px;overflow-x:auto;border-radius:10px;\
background:var(--surface2,#f3f4f6);font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px}\
.pomoc-telo a{color:inherit;text-decoration:underline}\
.pomoc-opomba{opacity:.75;font-size:13px}';

  function poskrbiZaSlog() {
    if (document.getElementById('pomoc-slog')) return;
    var s = document.createElement('style');
    s.id = 'pomoc-slog';
    s.textContent = SLOG;
    document.head.appendChild(s);
  }

  var odprto = null, prejsnjiFokus = null;

  function zapri() {
    if (!odprto) return;
    odprto.remove();
    odprto = null;
    document.removeEventListener('keydown', naTipko);
    if (prejsnjiFokus && prejsnjiFokus.focus) prejsnjiFokus.focus();
  }

  function naTipko(e) { if (e.key === 'Escape') zapri(); }

  function odpri(kljuc, sprozilec) {
    var v = VSEBINE[kljuc];
    if (!v) return;
    poskrbiZaSlog();
    zapri();
    // Ob zapiranju vrnemo fokus tja, od kod je prišel. Na sprožilca se
    // zanesemo, ker programski klik v Chromu gumba ne fokusira.
    var a = document.activeElement;
    prejsnjiFokus = (a && a !== document.body && a !== document.documentElement) ? a : (sprozilec || null);

    var ozadje = document.createElement('div');
    ozadje.className = 'pomoc-ozadje';
    ozadje.innerHTML = '<div class="pomoc-okno" role="dialog" aria-modal="true" aria-label="'
      + v.naslov.replace(/"/g, '&quot;') + '">'
      + '<div class="pomoc-glava"><h3 class="pomoc-naslov">' + v.naslov + '</h3>'
      + '<button type="button" class="pomoc-zapri" aria-label="Zapri">✕</button></div>'
      + '<div class="pomoc-telo">' + v.html + '</div></div>';

    ozadje.addEventListener('click', function (e) {
      if (e.target === ozadje || e.target.closest('.pomoc-zapri')) zapri();
    });
    document.body.appendChild(ozadje);
    odprto = ozadje;
    document.addEventListener('keydown', naTipko);
    var gumb = ozadje.querySelector('.pomoc-zapri');
    if (gumb) gumb.focus();
  }

  // Slog vstavimo takoj, ne šele ob odprtju okna — sicer je gumb do prvega
  // klika neoblikovan sistemski gumb.
  if (document.head) poskrbiZaSlog();
  else document.addEventListener('DOMContentLoaded', poskrbiZaSlog);

  document.addEventListener('click', function (e) {
    var g = e.target.closest && e.target.closest('[data-pomoc]');
    if (!g) return;
    e.preventDefault();
    odpri(g.getAttribute('data-pomoc'), g);
  });

  window.Pomoc = { odpri: odpri, zapri: zapri, VSEBINE: VSEBINE };
})();
