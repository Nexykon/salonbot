// ─── Vnos krajev in cen dostave ──────────────────────────────────────────
// Lastnik vpiše kraje s cenami; bot iz naslova stranke prepozna kraj in
// doda pravo ceno. Kraj, ki ni na seznamu, pomeni, da ceno določi lokal.
//
// Uporaba:
//   DostavaPolja.izrisi('s-zone', d.delivery_zones);
//   var z = DostavaPolja.zberi('s-zone');   // → [{kraj,cena}] ali null
//
// zberi() vrne null, kadar ni nobenega kraja — strežnik to razume kot
// "krajev ni" in obdrži enotno ceno dostave.

(function () {
  var SLOG = '\
.dz-tabela{display:flex;flex-direction:column;gap:8px;margin-top:8px}\
.dz-vrstica{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,110px) auto;\
align-items:center;column-gap:10px}\
.dz-vrstica input{box-sizing:border-box;display:block;width:100%;min-width:0;margin:0}\
.dz-brisi{width:32px;height:32px;padding:0;border:1px solid var(--border,#d1d5db);border-radius:9px;\
background:transparent;color:inherit;font:inherit;font-size:14px;cursor:pointer;opacity:.7}\
.dz-brisi:hover{opacity:1;border-color:#dc2626;color:#dc2626}\
.dz-glava{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,110px) auto;column-gap:10px;\
font-size:12px;font-weight:600;color:var(--muted,#6b7280)}\
.dz-glava span:last-child{width:32px}\
.dz-orodja{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}\
.dz-gumb{font:inherit;font-size:13px;padding:7px 11px;border:1px solid var(--border,#d1d5db);\
background:transparent;color:inherit;border-radius:9px;cursor:pointer}\
.dz-gumb:hover{border-color:var(--muted,#6b7280)}\
.dz-hitri{margin-top:12px}\
.dz-hitri textarea{box-sizing:border-box;width:100%;min-height:92px;font-family:inherit;font-size:13px}\
.dz-opozorilo{margin-top:8px;font-size:12.5px;color:#b45309}\
.dz-vrstica.je-podvojen input:first-child{border-color:#b45309}\
.dz-stevec{font-size:12px;color:var(--muted,#6b7280)}\
@media(max-width:560px){\
.dz-vrstica,.dz-glava{grid-template-columns:minmax(0,1fr) 92px auto}}';

  function poskrbiZaSlog() {
    if (document.getElementById('dz-slog')) return;
    var s = document.createElement('style');
    s.id = 'dz-slog';
    s.textContent = SLOG;
    document.head.appendChild(s);
  }

  // Za prepoznavo podvojenih: brez šumnikov, male črke, brez ločil
  function kljuc(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function vrsticaHtml(kraj, cena) {
    return '<div class="dz-vrstica">'
      + '<input type="text" class="dz-kraj" placeholder="npr. Vodice" value="'
      + String(kraj || '').replace(/"/g, '&quot;') + '">'
      + '<input type="number" class="dz-cena" min="0" step="0.10" inputmode="decimal" placeholder="2.00" value="'
      + (cena === '' || cena === null || cena === undefined ? '' : cena) + '">'
      + '<button type="button" class="dz-brisi" title="Odstrani kraj">✕</button>'
      + '</div>';
  }

  function seznam(el) { return [].slice.call(el.querySelectorAll('.dz-vrstica')); }

  // Označi podvojene kraje in izpiši stanje
  function osvezi(el) {
    var videni = {}, podvojenih = 0, brezCene = 0, stevec = 0;
    seznam(el).forEach(function (v) {
      var ime = v.querySelector('.dz-kraj').value.trim();
      var cena = v.querySelector('.dz-cena').value.trim();
      var k = kljuc(ime);
      var jePodvojen = !!(k && videni[k]);
      if (k) videni[k] = true;
      if (k) stevec++;
      if (jePodvojen) podvojenih++;
      if (k && cena === '') brezCene++;
      v.classList.toggle('je-podvojen', jePodvojen);
    });
    var op = el.parentNode.querySelector('.dz-opozorilo');
    var st = el.parentNode.querySelector('.dz-stevec');
    if (st) st.textContent = stevec + ' ' + (stevec === 1 ? 'kraj' : stevec === 2 ? 'kraja' : stevec < 5 ? 'kraji' : 'krajev');
    if (op) {
      var t = [];
      if (podvojenih) t.push(podvojenih + (podvojenih === 1 ? ' kraj je vpisan dvakrat' : ' krajev je vpisanih dvakrat') + ' — obvelja prvi');
      if (brezCene) t.push(brezCene + (brezCene === 1 ? ' kraj je brez cene' : ' krajev je brez cene') + ' — ne bo shranjen');
      op.textContent = t.join(' · ');
      op.style.display = t.length ? 'block' : 'none';
    }
  }

  function pripni(el) {
    el.addEventListener('input', function () { osvezi(el); });
    el.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.dz-brisi');
      if (!b) return;
      b.closest('.dz-vrstica').remove();
      osvezi(el);
    });
  }

  function izrisi(vsebnikId, zone) {
    var el = document.getElementById(vsebnikId);
    if (!el) return;
    poskrbiZaSlog();
    var vrstice = (zone && zone.length ? zone : [{ kraj: '', cena: '' }])
      .map(function (z) { return vrsticaHtml(z.kraj, z.cena); }).join('');

    el.innerHTML =
      '<div class="dz-glava"><span>Kraj</span><span>Cena (€)</span><span></span></div>'
      + '<div class="dz-tabela">' + vrstice + '</div>'
      + '<div class="dz-orodja">'
      + '<button type="button" class="dz-gumb" data-dz-dodaj>+ dodaj kraj</button>'
      + '<button type="button" class="dz-gumb" data-dz-hitri>Hitri vnos več krajev</button>'
      + '<span class="dz-stevec"></span>'
      + '</div>'
      + '<div class="dz-opozorilo" style="display:none"></div>'
      + '<div class="dz-hitri" style="display:none">'
      + '<div style="font-size:12px;color:var(--muted);margin-bottom:5px">Prilepi po vrsticah: <b>Vodice 2</b>, <b>Žeje pri Komendi 3</b>, <b>Domžale 4,00 €</b> … Vsak kraj v svojo vrstico; deluje tudi vejica ali pomišljaj med imenom in ceno.</div>'
      + '<textarea placeholder="Vodice 2&#10;Komenda 2&#10;Šenčur 3"></textarea>'
      + '<div class="dz-orodja">'
      + '<button type="button" class="dz-gumb" data-dz-dodaj-prilepljeno>Dodaj na seznam</button>'
      + '<button type="button" class="dz-gumb" data-dz-zamenjaj>Zamenjaj celoten seznam</button>'
      + '</div></div>';

    var tabela = el.querySelector('.dz-tabela');
    pripni(tabela);

    el.querySelector('[data-dz-dodaj]').addEventListener('click', function () {
      tabela.insertAdjacentHTML('beforeend', vrsticaHtml('', ''));
      var zadnja = tabela.lastElementChild;
      if (zadnja) zadnja.querySelector('.dz-kraj').focus();
      osvezi(tabela);
    });
    var hitri = el.querySelector('.dz-hitri');
    el.querySelector('[data-dz-hitri]').addEventListener('click', function () {
      hitri.style.display = hitri.style.display === 'none' ? 'block' : 'none';
      if (hitri.style.display === 'block') hitri.querySelector('textarea').focus();
    });
    el.querySelector('[data-dz-dodaj-prilepljeno]').addEventListener('click', function () {
      prilepi(el, tabela, false);
    });
    el.querySelector('[data-dz-zamenjaj]').addEventListener('click', function () {
      prilepi(el, tabela, true);
    });
    osvezi(tabela);
  }

  // "Vodice 2", "Žeje pri Komendi 3", "Domžale - 4,00 €", "Utik;5"
  function razcleni(besedilo) {
    var out = [];
    String(besedilo || '').split(/[\n\r]+/).forEach(function (vrstica) {
      var v = vrstica.trim();
      if (!v) return;
      // cena je zadnje število v vrstici
      var m = v.match(/^(.*?)[\s,;:\-–—]*(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur)?\s*$/i);
      if (!m) return;
      var kraj = m[1].replace(/[\s,;:\-–—]+$/, '').trim();
      var cena = parseFloat(m[2].replace(',', '.'));
      if (!kraj || isNaN(cena)) return;
      out.push({ kraj: kraj, cena: cena });
    });
    return out;
  }

  function prilepi(el, tabela, zamenjaj) {
    var ta = el.querySelector('.dz-hitri textarea');
    var novi = razcleni(ta.value);
    if (!novi.length) { osvezi(tabela); return; }
    if (zamenjaj) tabela.innerHTML = '';
    else {
      // pobriši prazne vrstice, da ne ostanejo vmes
      seznam(tabela).forEach(function (v) {
        if (!v.querySelector('.dz-kraj').value.trim()) v.remove();
      });
    }
    var obstojeci = {};
    seznam(tabela).forEach(function (v) {
      obstojeci[kljuc(v.querySelector('.dz-kraj').value)] = true;
    });
    novi.forEach(function (z) {
      if (obstojeci[kljuc(z.kraj)]) return;      // ne podvajamo
      obstojeci[kljuc(z.kraj)] = true;
      tabela.insertAdjacentHTML('beforeend', vrsticaHtml(z.kraj, z.cena));
    });
    ta.value = '';
    osvezi(tabela);
  }

  // Vrne [{kraj,cena}] ali null, če ni nobenega uporabnega kraja.
  function zberi(vsebnikId) {
    var el = document.getElementById(vsebnikId);
    if (!el) return null;
    var out = [], videni = {};
    seznam(el).forEach(function (v) {
      var kraj = v.querySelector('.dz-kraj').value.trim();
      var cenaN = v.querySelector('.dz-cena').value.trim();
      if (!kraj || cenaN === '') return;
      var cena = parseFloat(cenaN.replace(',', '.'));
      if (isNaN(cena) || cena < 0) return;
      var k = kljuc(kraj);
      if (!k || videni[k]) return;
      videni[k] = true;
      out.push({ kraj: kraj, cena: Math.round(cena * 100) / 100 });
    });
    return out.length ? out : null;
  }

  window.DostavaPolja = { izrisi: izrisi, zberi: zberi, razcleni: razcleni };
})();
