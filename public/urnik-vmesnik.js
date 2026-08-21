// ─── Vnos odpiralnega časa po dnevih ─────────────────────────────────────
// Skupno za dostavno, salonsko in administratorsko ploščo — sicer bi bil isti
// vmesnik napisan trikrat in bi se trikrat razhajal.
//
// Uporaba:
//   UrnikPolja.izrisi('s-urnik', d.urnik);        // d.urnik pride s strežnika
//   var u = UrnikPolja.zberi('s-urnik');          // → {0:null, 1:{od,do}, ...}
//
// zberi() vrne null, če ni noben dan odprt — strežnik to razume kot "urnika
// ni" in obdrži star model, namesto da bi lokal utihnil.

(function () {
  var DNEVI = [
    { dan: 1, kratko: 'Pon', dolgo: 'Ponedeljek' },
    { dan: 2, kratko: 'Tor', dolgo: 'Torek' },
    { dan: 3, kratko: 'Sre', dolgo: 'Sreda' },
    { dan: 4, kratko: 'Čet', dolgo: 'Četrtek' },
    { dan: 5, kratko: 'Pet', dolgo: 'Petek' },
    { dan: 6, kratko: 'Sob', dolgo: 'Sobota' },
    { dan: 0, kratko: 'Ned', dolgo: 'Nedelja' }
  ];

  // Vrstica je mreža, ne flex: tako se stolpci poravnajo med vsemi dnevi in
  // polji ostaneta v isti vrstici tudi tam, kjer plošča vnosnim poljem sicer
  // da display:block in width:100% (sicer se vsako postavi v svojo vrstico).
  var SLOG = '\
.urnik-tabela{display:flex;flex-direction:column;gap:8px;margin-top:8px}\
.urnik-vrstica{display:grid;\
grid-template-columns:minmax(84px,auto) minmax(0,146px) auto minmax(0,146px) auto minmax(0,1fr);\
align-items:center;column-gap:10px;row-gap:4px}\
.urnik-vrstica .urnik-dan{font-weight:600;font-size:14px;white-space:nowrap;margin:0}\
.urnik-vrstica input[type=time]{box-sizing:border-box;display:block;width:100%;min-width:0;margin:0}\
.urnik-vrstica .urnik-do{color:var(--muted,#6b7280);font-size:13px;text-align:center;margin:0}\
.urnik-vrstica .urnik-zaprto{display:inline-flex;align-items:center;gap:6px;cursor:pointer;\
user-select:none;font-size:13px;font-weight:400;color:var(--muted,#6b7280);white-space:nowrap;\
justify-self:start;margin:0}\
.urnik-vrstica .urnik-zaprto input[type=checkbox]{width:auto;min-width:0;flex:0 0 auto;margin:0;padding:0}\
.urnik-vrstica.je-zaprto input[type=time]{opacity:.45}\
.urnik-vrstica.je-zaprto .urnik-do{opacity:.45}\
.urnik-orodja{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap}\
.urnik-gumb{font:inherit;font-size:13px;padding:6px 10px;border:1px solid var(--border,#d1d5db);\
background:transparent;color:inherit;border-radius:8px;cursor:pointer}\
.urnik-gumb:hover{border-color:var(--muted,#6b7280)}\
@media(max-width:560px){\
.urnik-vrstica{grid-template-columns:minmax(0,1fr) auto minmax(0,1fr) auto}\
.urnik-vrstica .urnik-dan{grid-column:1/-1}}';

  function poskrbiZaSlog() {
    if (document.getElementById('urnik-slog')) return;
    var s = document.createElement('style');
    s.id = 'urnik-slog';
    s.textContent = SLOG;
    document.head.appendChild(s);
  }

  // Urnik s strežnika (polje sedmih vrstic) → iskanje po dnevu
  function poDnevu(urnik) {
    var m = {};
    (urnik || []).forEach(function (v) { m[v.dan] = v; });
    return m;
  }

  function izrisi(vsebnikId, urnik) {
    var el = document.getElementById(vsebnikId);
    if (!el) return;
    poskrbiZaSlog();
    var m = poDnevu(urnik);
    el.className = 'urnik-tabela';
    el.innerHTML = DNEVI.map(function (d) {
      var v = m[d.dan] || { zaprto: true, od: '', do: '' };
      var zaprto = !!v.zaprto;
      // Otroci so neposredno v mreži — ovoj bi jih spet zvil v en stolpec.
      return '<div class="urnik-vrstica' + (zaprto ? ' je-zaprto' : '') + '" data-dan="' + d.dan + '">'
        + '<span class="urnik-dan">' + d.dolgo + '</span>'
        + '<input type="time" class="urnik-od" value="' + (v.od || '') + '"' + (zaprto ? ' disabled' : '') + '>'
        + '<span class="urnik-do">do</span>'
        + '<input type="time" class="urnik-doo" value="' + (v.do || '') + '"' + (zaprto ? ' disabled' : '') + '>'
        + '<label class="urnik-zaprto"><input type="checkbox" class="urnik-zaprt"'
        + (zaprto ? ' checked' : '') + '> zaprto</label>'
        + '</div>';
    }).join('')
      + '<div class="urnik-orodja">'
      + '<button type="button" class="urnik-gumb" data-urnik-kopiraj>Prvi odprti dan uporabi za vse</button>'
      + '</div>';

    el.querySelectorAll('.urnik-zaprt').forEach(function (c) {
      c.addEventListener('change', function () {
        var vrstica = c.closest('.urnik-vrstica');
        vrstica.classList.toggle('je-zaprto', c.checked);
        vrstica.querySelectorAll('input[type=time]').forEach(function (i) { i.disabled = c.checked; });
      });
    });
    var gumb = el.querySelector('[data-urnik-kopiraj]');
    if (gumb) gumb.addEventListener('click', function () { kopirajPrvi(vsebnikId); });
  }

  // Vrne {0..6} z null za zaprte dni, ali null, če ni odprt noben dan.
  function zberi(vsebnikId) {
    var el = document.getElementById(vsebnikId);
    if (!el) return null;
    var out = {}, odprtih = 0;
    el.querySelectorAll('.urnik-vrstica').forEach(function (v) {
      var dan = parseInt(v.getAttribute('data-dan'), 10);
      var zaprt = v.querySelector('.urnik-zaprt').checked;
      var od = v.querySelector('.urnik-od').value;
      var doo = v.querySelector('.urnik-doo').value;
      if (zaprt || !od || !doo) { out[dan] = null; return; }
      out[dan] = { od: od, do: doo };
      odprtih++;
    });
    return odprtih ? out : null;
  }

  // Prvi odprti dan z izpolnjenima urama prepiše v vse ostale odprte dni.
  function kopirajPrvi(vsebnikId) {
    var el = document.getElementById(vsebnikId);
    if (!el) return;
    var vir = null;
    el.querySelectorAll('.urnik-vrstica').forEach(function (v) {
      if (vir) return;
      if (v.querySelector('.urnik-zaprt').checked) return;
      var od = v.querySelector('.urnik-od').value, doo = v.querySelector('.urnik-doo').value;
      if (od && doo) vir = { od: od, do: doo };
    });
    if (!vir) return;
    el.querySelectorAll('.urnik-vrstica').forEach(function (v) {
      if (v.querySelector('.urnik-zaprt').checked) return;
      v.querySelector('.urnik-od').value = vir.od;
      v.querySelector('.urnik-doo').value = vir.do;
    });
  }

  // Kratko besedilo urnika za prikaz (enaka logika kot src/urnik.js na strežniku)
  function besedilo(urnik) {
    var m = poDnevu(urnik);
    var skupine = [];
    DNEVI.forEach(function (d) {
      var v = m[d.dan];
      var k = (v && !v.zaprto && v.od && v.do) ? (v.od + '–' + v.do) : 'zaprto';
      var z = skupine[skupine.length - 1];
      if (z && z.k === k) z.dnevi.push(d.kratko);
      else skupine.push({ k: k, dnevi: [d.kratko] });
    });
    if (skupine.length === 1 && skupine[0].k === 'zaprto') return 'zaprto';
    return skupine.map(function (g) {
      var ime = g.dnevi.length === 1 ? g.dnevi[0]
        : g.dnevi.length === 2 ? g.dnevi.join(', ')
        : g.dnevi[0] + '–' + g.dnevi[g.dnevi.length - 1];
      return ime + ' ' + g.k;
    }).join(', ');
  }

  // Besedilo urnika iz trenutnega stanja polj — za predoglede v živo.
  function besediloIzPolj(vsebnikId) {
    var u = zberi(vsebnikId);
    if (!u) return 'zaprto';
    return besedilo(DNEVI.map(function (d) {
      var v = u[d.dan];
      return { dan: d.dan, zaprto: !v, od: v ? v.od : '', do: v ? v.do : '' };
    }));
  }

  window.UrnikPolja = {
    izrisi: izrisi, zberi: zberi, kopirajPrvi: kopirajPrvi,
    besedilo: besedilo, besediloIzPolj: besediloIzPolj, DNEVI: DNEVI
  };
})();
