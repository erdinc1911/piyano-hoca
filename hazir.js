/*
  HAZIR ESERLER (Aşama 14)
  eserler.json dosyasındaki gömülü eserleri listeler; çalma ekranında açar ya da kütüphaneye ekler.
  Dosya biçimi (kısa): { b:başlık, s:besteci, p:pay, d:payda, t:tempo, o:ölçü sayısı,
  n:[[midi, başlangıç(1/24 vuruş), süre(1/24 vuruş), el(0=sağ,1=sol)], ...],
  pe:[[pedal basıldı, pedal bırakıldı] (1/24 vuruş), ...] (isteğe bağlı) }
*/
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let liste = [];
  let arama = '';

  function eleman(ad, sinif, yazi) {
    const e = document.createElement(ad);
    if (sinif) e.className = sinif;
    if (yazi != null) e.textContent = yazi;
    return e;
  }

  function eserYap(d, id) {
    const notalar = d.n.map((n, i) => ({
      id: 'n' + i,
      el: n[3] ? 'sol' : 'sag',
      midi: n[0],
      baslangic: n[1] / 24,
      sure: n[2] / 24
    }));
    const eser = {
      surum: 1,
      id: 'hazir-' + id,
      baslik: d.b,
      besteci: d.s,
      olcu: { pay: d.p, payda: d.d },
      tempo: d.t,
      olcuSayisi: d.o,
      notalar: notalar
    };
    if (d.pe && d.pe.length) eser.pedal = d.pe.map((r) => [r[0] / 24, r[1] / 24]);
    return window.NOTA_IC ? window.NOTA_IC.dogrula(eser) : eser;
  }

  let paket = null;
  async function paketAl() {
    if (paket) return paket;
    const y = await fetch('eserler.json');
    if (!y.ok) throw new Error('eserler.json alınamadı (internet gerekebilir)');
    paket = await y.json();
    return paket;
  }

  async function yukle(id) {
    const p = await paketAl();
    if (!p.veri[id]) throw new Error('eser bulunamadı');
    return eserYap(p.veri[id], id);
  }

  function mesaj(t) { const m = $('hz-mesaj'); if (m) m.textContent = t; }

  function satir(k) {
    const s = eleman('div', 'hz-satir');
    const bilgi = eleman('div', 'hz-bilgi');
    bilgi.appendChild(eleman('b', '', k.b));
    bilgi.appendChild(eleman('span', '', k.s + ' · ' + k.o + ' ölçü · ' + k.n + ' nota · ' + k.z + (k.pd ? ' · 🦶 pedal' : '')));
    s.appendChild(bilgi);
    const ac = eleman('button', '', 'Aç');
    ac.type = 'button';
    ac.addEventListener('click', async () => {
      try { mesaj('Açılıyor…'); window.eserAc(await yukle(k.id), null); mesaj(''); }
      catch (e) { mesaj('Açılamadı: ' + (e.message || e)); }
    });
    const ekle = eleman('button', 'ikinci', 'Kütüphaneme ekle');
    ekle.type = 'button';
    ekle.addEventListener('click', async () => {
      try {
        const eser = await yukle(k.id);
        eser.id = 'nota-' + Date.now().toString(36);
        await window.notaKayitOlustur(eser);
        if (window.eserListesiYenile) await window.eserListesiYenile();
        mesaj('"' + k.b + '" kütüphanene eklendi; düzenleyebilirsin.');
      } catch (e) { mesaj('Eklenemedi: ' + (e.message || e)); }
    });
    const dugme = eleman('div', 'hz-dugme');
    dugme.appendChild(ac);
    dugme.appendChild(ekle);
    s.appendChild(dugme);
    return s;
  }

  function ciz() {
    const kap = $('hz-liste');
    kap.replaceChildren();
    const q = arama.toLocaleLowerCase('tr');
    const f = liste.filter((k) => !q || (k.b + ' ' + k.s).toLocaleLowerCase('tr').indexOf(q) >= 0);
    if (!f.length) { kap.appendChild(eleman('p', 'ipucu', 'Eşleşen eser yok.')); return; }
    let son = '';
    f.forEach((k) => {
      if (k.s !== son) { son = k.s; kap.appendChild(eleman('p', 'hz-besteci', k.s)); }
      kap.appendChild(satir(k));
    });
  }

  async function baslat() {
    if (!$('hz-liste')) return;
    $('hz-ara').addEventListener('input', () => { arama = $('hz-ara').value.trim(); ciz(); });
    try {
      liste = (await paketAl()).liste;
      $('hz-sayi').textContent = liste.length + ' eser';
      ciz();
    } catch (e) {
      $('hz-liste').textContent = 'Hazır eserler yüklenemedi (internet gerekebilir).';
    }
  }

  window.hazirBaslat = baslat;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', baslat);
  else baslat();
})();
