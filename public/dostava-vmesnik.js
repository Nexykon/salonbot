// ─── Cena dostave po krajih ───────────────────────────────────────────────
// Vnos je urejen po CENOVNIH RAZREDIH, ne po posameznih krajih: ena cena in
// pod njo vsi kraji, ki zanjo veljajo. Tako je vpisan tudi cenik na papirju
// ("2 € — Vodice, Sp. Brnik, Komenda"), zato je prepis hiter.
//
// Cena je polje type="text" in ne "number": brskalnik pri "number" vejico
// zavrne in .value vrne prazen niz — cena bi tiho izginila. Sprejmemo vejico
// in piko, ob izstopu iz polja pa zapišemo na dve decimalki.
//
// Uporaba:
//   DostavaPolja.izrisi('s-zone', d.delivery_zones);
//   var z = DostavaPolja.zberi('s-zone');   // → [{kraj,cena}] ali null
//
// Navzven ostane oblika enaka: polje {kraj, cena}.

(function () {
  var SLOG = '\
.dz-razredi{display:flex;flex-direction:column;gap:12px;margin-top:8px}\
.dz-razred{border:1px solid var(--border,#d1d5db);border-radius:12px;padding:12px 13px}\
.dz-vrh{display:grid;grid-template-columns:auto minmax(0,120px) auto minmax(0,1fr) auto;\
align-items:center;column-gap:8px}\
.dz-oznaka{font-size:12.5px;font-weight:600;color:var(--muted,#6b7280);white-space:nowrap}\
.dz-razred input.dz-cena{box-sizing:border-box;display:block;width:100%;min-width:0;margin:0;\
text-align:right;font-variant-numeric:tabular-nums}\
.dz-enota{font-size:13px;color:var(--muted,#6b7280)}\
.dz-koliko{font-size:12px;color:var(--muted,#6b7280);white-space:nowrap;justify-self:end}\
.dz-brisi{width:30px;height:30px;padding:0;border:1px solid var(--border,#d1d5db);border-radius:9px;\
background:transparent;color:inherit;font:inherit;font-size:13px;cursor:pointer;opacity:.7;justify-self:end}\
.dz-brisi:hover{opacity:1;border-color:#dc2626;color:#dc2626}\
.dz-razred textarea.dz-kraji{box-sizing:border-box;display:block;width:100%;margin:8px 0 0;\
min-height:58px;font-family:inherit;font-size:13.5px;line-height:1.5;resize:vertical}\
.dz-orodja{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}\
.dz-gumb{font:inherit;font-size:13px;padding:7px 11px;border:1px solid var(--border,#d1d5db);\
background:transparent;color:inherit;border-radius:9px;cursor:pointer}\
.dz-gumb:hover{border-color:var(--muted,#6b7280)}\
.dz-stevec{font-size:12px;color:var(--muted,#6b7280)}\
.dz-opozorilo{margin-top:8px;font-size:12.5px;color:#b45309}\
.dz-razred.je-brez-cene{border-color:#b45309}\
@media(max-width:560px){\
.dz-vrh{grid-template-columns:auto minmax(0,96px) auto minmax(0,1fr) auto}\
.dz-koliko{display:none}}';

  function poskrbiZaSlog() {
    if (document.getElementById('dz-slog')) return;
    var s = document.createElement('style');
    s.id = 'dz-slog';
    s.textContent = SLOG;
    document.head.appendChild(s);
  }

  // Za prepoznavo podvojenih krajev: brez šumnikov, male črke, brez ločil
  function kljuc(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // "2" → 2, "2,5" → 2.5, "2.50 €" → 2.5, smeti → null
  function vCeno(v) {
    var s = String(v == null ? '' : v).replace(/[€\s]/g, '').replace(',', '.');
    if (!s) return null;
    var n = parseFloat(s);
    if (isNaN(n) || n < 0 || n > 100) return null;
    return Math.round(n * 100) / 100;
  }

  // Prikaz z vejico in dvema decimalkama — tako, kot cene pišemo pri nas.
  function izCene(n) {
    return (n === null || n === undefined || n === '') ? '' : Number(n).toFixed(2).replace('.', ',');
  }

  // "Vodice, Sp. Brnik\nKomenda" → ['Vodice','Sp. Brnik','Komenda']
  function vKraje(besedilo) {
    return String(besedilo || '').split(/[,;\n\r]+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function razredHtml(cena, kraji) {
    return '<div class="dz-razred">'
      + '<div class="dz-vrh">'
      + '<span class="dz-oznaka">Cena dostave</span>'
      + '<input type="text" class="dz-cena" inputmode="decimal" placeholder="2,00" value="'
      + String(izCene(cena)).replace(/"/g, '&quot;') + '">'
      + '<span class="dz-enota">€</span>'
      + '<span class="dz-koliko"></span>'
      + '<button type="button" class="dz-brisi" title="Odstrani cenovni razred">✕</button>'
      + '</div>'
      + '<textarea class="dz-kraji" placeholder="Kraji, ločeni z vejico — npr. Vodice, Sp. Brnik, Komenda">'
      + String(kraji || '').replace(/</g, '&lt;') + '</textarea>'
      + '</div>';
  }

  var razredi = function (el) { return [].slice.call(el.querySelectorAll('.dz-razred')); };

  function osvezi(el) {
    var videni = {}, podvojenih = [], brezCene = 0, skupno = 0, razredov = 0;
    razredi(el).forEach(function (r) {
      var cena = vCeno(r.querySelector('.dz-cena').value);
      var kraji = vKraje(r.querySelector('.dz-kraji').value);
      r.classList.toggle('je-brez-cene', cena === null && kraji.length > 0);
      if (cena === null && kraji.length) brezCene += kraji.length;
      if (cena !== null && kraji.length) razredov++;
      kraji.forEach(function (k) {
        var kk = kljuc(k);
        if (!kk) return;
        if (videni[kk]) { if (podvojenih.indexOf(k) < 0) podvojenih.push(k); return; }
        videni[kk] = true;
        if (cena !== null) skupno++;
      });
      var koliko = r.querySelector('.dz-koliko');
      if (koliko) koliko.textContent = kraji.length
        ? kraji.length + ' ' + (kraji.length === 1 ? 'kraj' : kraji.length === 2 ? 'kraja' : kraji.length < 5 ? 'kraji' : 'krajev')
        : '';
    });

    var st = el.querySelector('.dz-stevec');
    if (st) {
      st.textContent = skupno
        ? skupno + ' ' + (skupno === 1 ? 'kraj' : skupno === 2 ? 'kraja' : skupno < 5 ? 'kraji' : 'krajev')
          + ' v ' + razredov + ' ' + (razredov === 1 ? 'razredu' : razredov === 2 ? 'razredih' : 'razredih')
        : 'ni vpisanih krajev — velja enotna cena dostave';
    }
    var op = el.querySelector('.dz-opozorilo');
    if (op) {
      var t = [];
      if (podvojenih.length) t.push('podvojeni kraji: ' + podvojenih.slice(0, 6).join(', ')
        + (podvojenih.length > 6 ? ' …' : '') + ' — obvelja prva cena');
      if (brezCene) t.push(brezCene + (brezCene === 1 ? ' kraj je v razredu brez cene' : ' krajev je v razredu brez cene') + ' — ne bo shranjen');
      op.textContent = t.join(' · ');
      op.style.display = t.length ? 'block' : 'none';
    }
  }

  function izrisi(vsebnikId, zone) {
    var el = document.getElementById(vsebnikId);
    if (!el) return;
    poskrbiZaSlog();

    // Kraje strnemo po ceni — cenik je tako tudi napisan
    var skupine = {};
    (zone || []).forEach(function (z) {
      var c = vCeno(z.cena);
      if (c === null || !String(z.kraj || '').trim()) return;
      var k = c.toFixed(2);
      if (!skupine[k]) skupine[k] = [];
      skupine[k].push(String(z.kraj).trim());
    });
    var cene = Object.keys(skupine).sort(function (a, b) { return parseFloat(a) - parseFloat(b); });
    var html = cene.length
      ? cene.map(function (c) { return razredHtml(parseFloat(c), skupine[c].join(', ')); }).join('')
      : razredHtml('', '');

    el.innerHTML = '<div class="dz-razredi">' + html + '</div>'
      + '<div class="dz-orodja">'
      + '<button type="button" class="dz-gumb" data-dz-dodaj>+ dodaj cenovni razred</button>'
      + '<span class="dz-stevec"></span>'
      + '</div>'
      + '<div class="dz-opozorilo" style="display:none"></div>';

    var vsebnik = el.querySelector('.dz-razredi');

    el.addEventListener('input', function () { osvezi(el); });
    // Ob izstopu iz polja ceno zapišemo na dve decimalki
    el.addEventListener('focusout', function (e) {
      if (!e.target.classList || !e.target.classList.contains('dz-cena')) return;
      var c = vCeno(e.target.value);
      e.target.value = c === null ? '' : izCene(c);
      osvezi(el);
    });
    el.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.dz-brisi');
      if (b) {
        if (razredi(el).length > 1) b.closest('.dz-razred').remove();
        else {
          var r = b.closest('.dz-razred');
          r.querySelector('.dz-cena').value = '';
          r.querySelector('.dz-kraji').value = '';
        }
        osvezi(el);
        return;
      }
      if (e.target.closest && e.target.closest('[data-dz-dodaj]')) {
        vsebnik.insertAdjacentHTML('beforeend', razredHtml('', ''));
        var zadnji = vsebnik.lastElementChild;
        if (zadnji) zadnji.querySelector('.dz-cena').focus();
        osvezi(el);
      }
    });

    osvezi(el);
  }

  // Vrne [{kraj,cena}] ali null. Podvojen kraj obvelja pri prvi ceni.
  function zberi(vsebnikId) {
    var el = document.getElementById(vsebnikId);
    if (!el) return null;
    var out = [], videni = {};
    razredi(el).forEach(function (r) {
      var cena = vCeno(r.querySelector('.dz-cena').value);
      if (cena === null) return;
      vKraje(r.querySelector('.dz-kraji').value).forEach(function (kraj) {
        var k = kljuc(kraj);
        if (!k || videni[k]) return;
        videni[k] = true;
        out.push({ kraj: kraj, cena: cena });
      });
    });
    return out.length ? out : null;
  }

  /* ── Kraji brez cene ─────────────────────────────────────────────────────
     Napačno zapisan kraj ni nikoli ujet — posledica je vidna pri naročilu, a
     nihče je ne sešteje. Tu pokažemo, kateri kraji se v pravih naslovih
     ponavljajo in niso pokriti, ter jih dodamo z enim klikom. Ker šifranta
     krajev ni, so predlogi vzeti iz naslovov, ki so jih napisale stranke.
  */
  var SLOG_N = '\
.dzn{margin-top:14px;border:1px dashed var(--border,#d1d5db);border-radius:12px;padding:12px 13px}\
.dzn-naslov{font-size:12.5px;font-weight:700;color:#b45309;margin-bottom:2px}\
.dzn-opis{font-size:12px;color:var(--muted,#6b7280);margin-bottom:10px}\
.dzn-vrstica{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,110px) auto;\
align-items:center;column-gap:8px;padding:6px 0;border-top:1px solid var(--border,#d1d5db)}\
.dzn-vrstica:first-of-type{border-top:0}\
.dzn-kraj{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\
.dzn-koliko{font-size:12px;color:var(--muted,#6b7280);white-space:nowrap}\
.dzn select,.dzn input{box-sizing:border-box;display:block;width:100%;min-width:0;margin:0;font-size:13px}\
.dzn-primeri{font-size:11.5px;color:var(--muted,#6b7280);grid-column:1/-1;margin:0 0 4px}\
@media(max-width:560px){.dzn-vrstica{grid-template-columns:minmax(0,1fr) minmax(0,92px) auto}\
.dzn-koliko{display:none}}';

  function poskrbiZaSlogN() {
    if (document.getElementById('dzn-slog')) return;
    var s = document.createElement('style');
    s.id = 'dzn-slog';
    s.textContent = SLOG_N;
    document.head.appendChild(s);
  }

  // Kraj vpiši v razred z dano ceno; če razreda ni, ga ustvari.
  function dodajVRazred(zoneId, kraj, cena) {
    var el = document.getElementById(zoneId);
    if (!el || cena === null) return false;
    var cilj = null;
    razredi(el).forEach(function (r) {
      if (cilj) return;
      if (vCeno(r.querySelector('.dz-cena').value) === cena) cilj = r;
    });
    if (!cilj) {
      var prazen = null;
      razredi(el).forEach(function (r) {
        if (!prazen && !vCeno(r.querySelector('.dz-cena').value)
          && !vKraje(r.querySelector('.dz-kraji').value).length) prazen = r;
      });
      if (prazen) { cilj = prazen; cilj.querySelector('.dz-cena').value = izCene(cena); }
      else {
        el.querySelector('.dz-razredi').insertAdjacentHTML('beforeend', razredHtml(cena, ''));
        cilj = el.querySelector('.dz-razredi').lastElementChild;
      }
    }
    var polje = cilj.querySelector('.dz-kraji');
    var obstoj = vKraje(polje.value);
    if (obstoj.map(kljuc).indexOf(kljuc(kraj)) < 0) obstoj.push(kraj);
    polje.value = obstoj.join(', ');
    osvezi(el);
    cilj.scrollIntoView({ block: 'nearest' });
    return true;
  }

  function izrisiNeznane(vsebnikId, kraji, zoneId) {
    var el = document.getElementById(vsebnikId);
    if (!el) return;
    if (!kraji || !kraji.length) { el.innerHTML = ''; return; }
    poskrbiZaSlogN();

    // Predlagane cene = razredi, ki že obstajajo
    var zoneEl = document.getElementById(zoneId);
    var cene = [];
    if (zoneEl) razredi(zoneEl).forEach(function (r) {
      var c = vCeno(r.querySelector('.dz-cena').value);
      if (c !== null && cene.indexOf(c) < 0) cene.push(c);
    });
    cene.sort(function (a, b) { return a - b; });

    var moznosti = cene.map(function (c) { return '<option value="' + c + '">' + izCene(c) + ' €</option>'; }).join('')
      + '<option value="">druga cena…</option>';

    el.innerHTML = '<div class="dzn">'
      + '<div class="dzn-naslov">Kraji brez cene</div>'
      + '<div class="dzn-opis">V naslovih iz naročil se pojavljajo ti kraji, ki jih na ceniku ni. Če je ime napačno zapisano, ga popravi v polju zgoraj; sicer izberi ceno in dodaj. Predlogi so vzeti iz naslovov, ki so jih napisale stranke.</div>'
      + kraji.map(function (k, i) {
        return '<div class="dzn-vrstica" data-dzn="' + i + '">'
          + '<span class="dzn-kraj" title="' + String(k.naslovi || []).replace(/"/g, '&quot;') + '">' + k.kraj + '</span>'
          + '<span class="dzn-koliko">' + k.narocil + ' '
          + (k.narocil === 1 ? 'naročilo' : k.narocil === 2 ? 'naročili' : k.narocil < 5 ? 'naročila' : 'naročil') + '</span>'
          + (cene.length
            ? '<select class="dzn-cena">' + moznosti + '</select>'
            : '<input type="text" class="dzn-cena-rocno" inputmode="decimal" placeholder="cena">')
          + '<button type="button" class="dz-gumb dzn-dodaj">dodaj</button>'
          + '<div class="dzn-primeri">' + (k.naslovi || []).slice(0, 3).join(' · ') + '</div>'
          + '</div>';
      }).join('')
      + '</div>';

    el.addEventListener('change', function (e) {
      if (!e.target.classList || !e.target.classList.contains('dzn-cena')) return;
      if (e.target.value !== '') return;
      // "druga cena…" → zamenjaj s prostim vnosom
      var vr = e.target.closest('.dzn-vrstica');
      e.target.outerHTML = '<input type="text" class="dzn-cena-rocno" inputmode="decimal" placeholder="cena">';
      var novo = vr.querySelector('.dzn-cena-rocno');
      if (novo) novo.focus();
    });

    el.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.dzn-dodaj');
      if (!b) return;
      var vr = b.closest('.dzn-vrstica');
      var izbor = vr.querySelector('.dzn-cena') || vr.querySelector('.dzn-cena-rocno');
      var cena = vCeno(izbor && izbor.value);
      if (cena === null) { if (izbor) izbor.focus(); return; }
      var kraj = vr.querySelector('.dzn-kraj').textContent.trim();
      if (dodajVRazred(zoneId, kraj, cena)) vr.remove();
      if (!el.querySelectorAll('.dzn-vrstica').length) el.innerHTML = '';
    });
  }

  window.DostavaPolja = {
    izrisi: izrisi, zberi: zberi, vCeno: vCeno, izCene: izCene, vKraje: vKraje,
    izrisiNeznane: izrisiNeznane, dodajVRazred: dodajVRazred
  };
})();
