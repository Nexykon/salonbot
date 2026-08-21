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

  window.DostavaPolja = { izrisi: izrisi, zberi: zberi, vCeno: vCeno, izCene: izCene, vKraje: vKraje };
})();
