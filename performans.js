/*
  PERFORMANS (Aşama 7): çaldığını kontrol etme (ekran klavyesiyle)
  - "Beni bekle": doğru notaya basmanı bekler, zaman baskısı yok
  - "Tempoda": bir ölçü sayımdan sonra notalar akar, ritim de değerlendirilir
  - Sonuçlar porte ve kayan notalarda renkle gösterilir, bitişte özet çıkar
  Her şey bir kapsülün içinde tutulur; dışarıya yalnızca window.PERF verilir.
  Sadece notanın başladığı an kontrol edilir (süre, pedal ve nüans değerlendirilmez).
*/

(function () {
  'use strict';

  const HASSASIYET = [
    { ad: 'Rahat', tol: 250 }, // doğru sayılan zaman penceresi (± milisaniye)
    { ad: 'Normal', tol: 150 },
    { ad: 'Sıkı', tol: 80 }
  ];
  const EK_PENCERE = 300;        // doğru pencereden sonra "erken/geç" sayılan ek süre (ms)
  const BITIS_BEKLEME = 500;     // son nota sonrası özetten önce bekleme (ms)
  const GECMIS_ANAHTAR = 'piyano-gecmis';
  const AYAR_ANAHTAR = 'piyano-dene-ayar';
  const RENK = {
    dogru: '#22c55e',
    erken: '#facc15',
    gec: '#facc15',
    tekrar: '#facc15',
    eksik: '#ef4444'
  };
  const SINIF = {
    dogru: 'sonuc-dogru',
    erken: 'sonuc-sari',
    gec: 'sonuc-sari',
    tekrar: 'sonuc-sari',
    eksik: 'sonuc-eksik'
  };
  // Çalışma sürerken kilitlenen düğmeler (tempo, ölçü, döngü, el seçimi)
  const KILITLI = [
    'tempo-azalt', 'tempo-artir', 'tempo-kaydirici',
    'bas-azalt', 'bas-artir', 'son-azalt', 'son-artir', 'bolum-tumu',
    'dongu', 'el-sag', 'el-sol'
  ];
  const BAR_DUGMELERI = ['dene-bekle', 'dene-tempo', 'dh-0', 'dh-1', 'dh-2', 'dene-metro'];

  const $ = (id) => document.getElementById(id);

  let api = null;

  const P = {
    aktif: false,
    mod: 'bekle',       // 'bekle' | 'tempo'
    hass: 1,
    metro: true,
    durum: 'hazir',     // 'hazir' | 'sayim' | 'calisiyor' | 'bitti'
    olaylar: [],
    baslangic: 0,
    uzunluk: 0,
    ov: 4,
    sonuc: {},          // id -> { d: 'dogru'|'erken'|'gec'|'eksik'|'tekrar', dt }
    fazla: [],          // { midi, olcu }
    raf: null,
    // tempo kipi
    t0: 0,
    tBaslangic: 0,
    msB: 500,
    gecik: 0,
    sayimVurus: 4,
    sonrakiTik: 0,
    bitisZamani: 0,
    // bekle kipi
    adimlar: [],
    adim: 0,
    adimYanlis: 0,
    adimBasilan: null,
    gorPos: 0,
    sonKare: 0,
    bitisPlani: null,
    // gösterim
    isaretliTuslar: [],
    ozetOlaylar: []
  };

  /* ---------- AYAR VE GEÇMİŞ ---------- */

  function ayarOku() {
    try {
      const v = JSON.parse(localStorage.getItem(AYAR_ANAHTAR));
      if (!v) return;
      if (v.mod === 'bekle' || v.mod === 'tempo') P.mod = v.mod;
      if (v.hass === 0 || v.hass === 1 || v.hass === 2) P.hass = v.hass;
      if (typeof v.metro === 'boolean') P.metro = v.metro;
    } catch (e) {}
  }

  function ayarYaz() {
    try {
      localStorage.setItem(AYAR_ANAHTAR, JSON.stringify({ mod: P.mod, hass: P.hass, metro: P.metro }));
    } catch (e) {}
  }

  function gecmisOku() {
    try {
      const v = JSON.parse(localStorage.getItem(GECMIS_ANAHTAR));
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  function gecmisYaz(liste) {
    try {
      localStorage.setItem(GECMIS_ANAHTAR, JSON.stringify(liste.slice(-30)));
    } catch (e) {}
  }

  /* ---------- İŞARETLER (PORTE, KLAVYE) ---------- */

  function porteIsaretleriTemizle() {
    document.querySelectorAll('#porte-kutu .nota').forEach((g) => {
      g.classList.remove('sonuc-dogru');
      g.classList.remove('sonuc-sari');
      g.classList.remove('sonuc-eksik');
    });
  }

  function isaretYenile() {
    porteIsaretleriTemizle();
    if (!P.aktif) return;
    Object.keys(P.sonuc).forEach((id) => {
      const g = document.querySelector('#porte-kutu .nota[data-id="' + id + '"]');
      if (g) g.classList.add(SINIF[P.sonuc[id].d]);
    });
  }

  function tusIsaretiTemizle() {
    P.isaretliTuslar.forEach((x) => x.el.classList.remove(x.sinif));
    P.isaretliTuslar = [];
  }

  function tuslariIsaretle(liste) {
    // liste: [{ midi, el }]: şu an çalınması beklenen tuşlar
    const yeni = [];
    liste.forEach((o) => {
      const el = api.tusEl(o.midi);
      if (el) yeni.push({ el: el, sinif: 'bekle-' + o.el });
    });
    const eskiAnahtar = P.isaretliTuslar.map((x) => x.sinif + x.el.dataset.midi).join(',');
    const yeniAnahtar = yeni.map((x) => x.sinif + x.el.dataset.midi).join(',');
    if (eskiAnahtar === yeniAnahtar) return;
    tusIsaretiTemizle();
    yeni.forEach((x) => x.el.classList.add(x.sinif));
    P.isaretliTuslar = yeni;
  }

  function yanlisYanip(midi) {
    const el = api.tusEl(midi);
    if (!el) return;
    el.classList.add('yanlis');
    setTimeout(() => el.classList.remove('yanlis'), 280);
  }

  /* ---------- METRONOM ---------- */

  function tik(msZamani, vurgulu) {
    const c = api.baglam();
    const sesT = Math.max(c.currentTime + (msZamani - performance.now()) / 1000, c.currentTime);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = vurgulu ? 1568 : 1046;
    g.gain.setValueAtTime(0.0001, sesT);
    g.gain.linearRampToValueAtTime(0.3, sesT + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, sesT + 0.07);
    o.connect(g);
    g.connect(c.destination);
    o.start(sesT);
    o.stop(sesT + 0.1);
  }

  /* ---------- DÜZEN VE YARDIMCILAR ---------- */

  function olcuNo(vurusMutlak) {
    return Math.floor(vurusMutlak / P.ov + 1e-6) + 1;
  }

  function olayOlcusu(o) {
    return olcuNo(P.baslangic + o.b);
  }

  function kilitle(kilitli) {
    KILITLI.forEach((id) => {
      const e = $(id);
      if (e) e.disabled = kilitli;
    });
    BAR_DUGMELERI.forEach((id) => {
      const e = $(id);
      if (e) e.disabled = kilitli;
    });
  }

  function barYaz() {
    $('dene-bekle').classList.toggle('aktif', P.mod === 'bekle');
    $('dene-tempo').classList.toggle('aktif', P.mod === 'tempo');
    for (let i = 0; i < 3; i++) $('dh-' + i).classList.toggle('aktif', P.hass === i);
    $('dene-metro').classList.toggle('aktif', P.metro);
    $('dene-hass').hidden = P.mod !== 'tempo';
    $('dene-metro').hidden = P.mod !== 'tempo';
    const caliyor = P.durum === 'sayim' || P.durum === 'calisiyor';
    $('dene-basla').textContent = caliyor ? '■ Bitir' : (P.durum === 'bitti' ? '↻ Yeniden' : '▶ Başla');
    $('dene-basla').classList.toggle('duraklat', caliyor);
  }

  function durumYaz(yazi) {
    $('dene-durum').textContent = yazi;
  }

  function hazirYazisi() {
    return P.mod === 'bekle'
      ? 'Başla\'ya bas, sonra parlayan tuşlara bas.'
      : 'Başla\'ya bas: bir ölçü sayım, sonra tempoya uyarak çal.';
  }

  /* ---------- BAŞLAT / BİTİR ---------- */

  async function basla() {
    if (!P.aktif) return;
    const c = api.baglam();
    try {
      if (c.state !== 'running') await c.resume();
    } catch (e) {}

    const h = api.hazirla();
    P.baslangic = h.baslangic;
    P.uzunluk = h.uzunluk;
    P.ov = api.olcuVurusu();
    P.olaylar = h.olaylar.map((o) => Object.assign({}, o));
    if (P.olaylar.length === 0) {
      durumYaz('Çalınacak nota yok. Sağ el / sol el ve ölçü seçimini kontrol et.');
      return;
    }

    P.sonuc = {};
    P.fazla = [];
    P.bitisPlani = null;
    P.bitisZamani = 0;
    tusIsaretiTemizle();
    isaretYenile();
    kilitle(true);

    if (P.mod === 'bekle') {
      const harita = [];
      P.olaylar.forEach((o) => {
        const son = harita[harita.length - 1];
        if (son && Math.abs(son.b - o.b) < 1e-6) son.olaylar.push(o);
        else harita.push({ b: o.b, olaylar: [o] });
      });
      P.adimlar = harita;
      P.adim = 0;
      P.adimYanlis = 0;
      P.adimBasilan = new Set();
      P.gorPos = harita[0].b;
      P.sonKare = performance.now();
      P.durum = 'calisiyor';
    } else {
      P.msB = 60000 / api.bpm();
      P.gecik = Math.min(Math.max(((c.outputLatency || 0) + (c.baseLatency || 0)) * 1000, 0), 200);
      const simdi = performance.now();
      P.sayimVurus = Math.max(1, Math.round(P.ov));
      P.tBaslangic = simdi + 250;
      P.t0 = P.tBaslangic + P.sayimVurus * P.msB;
      P.sonrakiTik = 0;
      P.olaylar.forEach((o) => {
        o.T = P.t0 + o.b * P.msB;
      });
      for (let i = 0; i < P.sayimVurus; i++) {
        tik(P.tBaslangic + i * P.msB, i === 0);
      }
      P.durum = 'sayim';
    }

    barYaz();
    if (!P.raf) P.raf = requestAnimationFrame(dongu);
  }

  function ilerlemeSifirla() {
    P.durum = 'hazir';
    P.sonuc = {};
    P.fazla = [];
    P.bitisPlani = null;
    tusIsaretiTemizle();
    isaretYenile();
  }

  // Çalışmayı hiç özet göstermeden iptal eder (sekme değişince vb.)
  function iptal() {
    if (P.durum !== 'sayim' && P.durum !== 'calisiyor') return;
    clearTimeout(P.bitisPlani);
    ilerlemeSifirla();
    kilitle(false);
    barYaz();
    durumYaz(hazirYazisi());
    api.porteCizgi(null);
    api.kayanYenile();
  }

  function bitir(elle) {
    if (P.durum !== 'sayim' && P.durum !== 'calisiyor') return;
    clearTimeout(P.bitisPlani);
    P.bitisPlani = null;
    P.durum = 'bitti';
    kilitle(false);
    tusIsaretiTemizle();
    api.porteCizgi(null);

    // Elle bitirildiyse yalnızca değerlendirilmiş notalar sayılır
    P.ozetOlaylar = P.olaylar.filter((o) => P.sonuc[o.id]);
    barYaz();
    if (P.ozetOlaylar.length === 0) {
      ilerlemeSifirla();
      barYaz();
      durumYaz(hazirYazisi());
      api.kayanYenile();
      return;
    }
    ozetGoster(ozetHesapla());
    api.kayanYenile();
  }

  /* ---------- NOTA BASILMASI ---------- */

  function tusBasildi(midi, an) {
    if (!P.aktif || P.durum !== 'calisiyor') return;
    if (P.mod === 'bekle') beklePress(midi);
    else tempoPress(midi, an);
  }

  function tempoPress(midi, an) {
    const W = HASSASIYET[P.hass].tol + EK_PENCERE;
    const tol = HASSASIYET[P.hass].tol;
    let en = null;
    let enMs = Infinity;
    P.olaylar.forEach((o) => {
      if (o.midi !== midi || P.sonuc[o.id]) return;
      const dt = an - (o.T + P.gecik);
      if (Math.abs(dt) <= W && Math.abs(dt) < enMs) {
        en = o;
        enMs = Math.abs(dt);
      }
    });
    if (en) {
      const dt = an - (en.T + P.gecik);
      let d = 'dogru';
      if (Math.abs(dt) > tol) d = dt < 0 ? 'erken' : 'gec';
      P.sonuc[en.id] = { d: d, dt: dt };
      isaretYenile();
    } else {
      const vurus = Math.min(Math.max((an - P.t0) / P.msB, 0), P.uzunluk);
      P.fazla.push({ midi: midi, olcu: olcuNo(P.baslangic + vurus) });
      yanlisYanip(midi);
    }
  }

  function beklePress(midi) {
    const adim = P.adimlar[P.adim];
    if (!adim) return;
    const beklenen = adim.olaylar.some((o) => o.midi === midi);
    if (beklenen && !P.adimBasilan.has(midi)) {
      P.adimBasilan.add(midi);
      const gerekli = new Set(adim.olaylar.map((o) => o.midi));
      if (P.adimBasilan.size >= gerekli.size) {
        const d = P.adimYanlis === 0 ? 'dogru' : 'tekrar';
        adim.olaylar.forEach((o) => {
          P.sonuc[o.id] = { d: d, dt: 0 };
        });
        P.adim++;
        P.adimYanlis = 0;
        P.adimBasilan = new Set();
        isaretYenile();
        if (P.adim >= P.adimlar.length) {
          clearTimeout(P.bitisPlani);
          P.bitisPlani = setTimeout(() => bitir(false), BITIS_BEKLEME);
        }
      }
    } else {
      P.adimYanlis++;
      P.fazla.push({ midi: midi, olcu: olayOlcusu(adim.olaylar[0]) });
      yanlisYanip(midi);
    }
  }

  /* ---------- ÇİZİM DÖNGÜSÜ ---------- */

  function guncelle(an) {
    if (P.mod !== 'tempo') return;
    if (P.durum === 'sayim' && an >= P.t0) P.durum = 'calisiyor';

    // Metronom: önümüzdeki 400 ms içindeki vuruşları planla
    if (P.metro) {
      for (let k = 0; k < 20; k++) {
        const t = P.t0 + P.sonrakiTik * P.msB;
        if (t > an + 400 || P.sonrakiTik >= P.uzunluk - 1e-6) break;
        tik(t, ((P.baslangic + P.sonrakiTik) % P.ov) < 1e-6);
        P.sonrakiTik++;
      }
    }

    if (P.durum !== 'calisiyor') return;
    const W = HASSASIYET[P.hass].tol + EK_PENCERE;
    let degisti = false;
    let hepsi = true;
    P.olaylar.forEach((o) => {
      if (!P.sonuc[o.id]) {
        if (an > o.T + P.gecik + W) {
          P.sonuc[o.id] = { d: 'eksik' };
          degisti = true;
        } else {
          hepsi = false;
        }
      }
    });
    if (degisti) isaretYenile();
    if (hepsi) {
      if (!P.bitisZamani) P.bitisZamani = an + BITIS_BEKLEME;
      else if (an >= P.bitisZamani) bitir(false);
    } else {
      P.bitisZamani = 0;
    }
  }

  function sayimlar() {
    const s = { dogru: 0, erken: 0, gec: 0, eksik: 0, tekrar: 0 };
    P.olaylar.forEach((o) => {
      const r = P.sonuc[o.id];
      if (r) s[r.d]++;
    });
    return s;
  }

  function kareCiz(an) {
    if (!P.aktif || !api) return;
    an = an === undefined ? performance.now() : an;
    const calisiyor = P.durum === 'sayim' || P.durum === 'calisiyor';

    if (P.durum === 'hazir') {
      const h = api.hazirla();
      P.baslangic = h.baslangic;
      P.uzunluk = h.uzunluk;
      P.ov = api.olcuVurusu();
    }

    let pos = 0;
    if (calisiyor) {
      if (P.mod === 'tempo') {
        pos = (an - P.t0) / P.msB;
      } else {
        const hedef = P.adimlar[Math.min(P.adim, P.adimlar.length - 1)].b;
        const gecen = Math.max(an - P.sonKare, 0);
        P.gorPos += (hedef - P.gorPos) * (1 - Math.exp(-gecen / 90));
        P.sonKare = an;
        pos = P.gorPos;
      }
    }
    api.kayanCiz(pos);

    if (calisiyor) {
      const mutlak = P.baslangic + Math.max(pos, 0);
      api.porteCizgi(mutlak);
      api.porteTakip(mutlak);

      // Şu an çalınması beklenen tuşlar
      const bekleyen = [];
      if (P.mod === 'bekle') {
        const adim = P.adimlar[P.adim];
        if (adim) {
          adim.olaylar.forEach((o) => {
            if (!P.adimBasilan.has(o.midi)) bekleyen.push({ midi: o.midi, el: o.el });
          });
        }
      } else if (P.durum === 'calisiyor' || P.durum === 'sayim') {
        const W = HASSASIYET[P.hass].tol + EK_PENCERE;
        P.olaylar.forEach((o) => {
          if (!P.sonuc[o.id] && an >= o.T - 120 && an <= o.T + P.gecik + W) {
            bekleyen.push({ midi: o.midi, el: o.el });
          }
        });
      }
      tuslariIsaretle(bekleyen);

      // Durum yazısı
      const s = sayimlar();
      if (P.mod === 'bekle') {
        durumYaz('Adım ' + Math.min(P.adim + 1, P.adimlar.length) + '/' + P.adimlar.length +
          ' · Yanlış basış: ' + P.fazla.length);
      } else if (P.durum === 'sayim') {
        const kalan = P.sayimVurus - Math.floor((an - P.tBaslangic) / P.msB);
        durumYaz('Hazırlan… ' + Math.max(1, Math.min(kalan, P.sayimVurus)));
      } else {
        durumYaz('Ölçü ' + Math.min(Math.max(olcuNo(P.baslangic + Math.max(pos, 0)), 1), 999) +
          ' · Doğru ' + s.dogru + ' · Erken/geç ' + (s.erken + s.gec) +
          ' · Eksik ' + s.eksik + ' · Fazla ' + P.fazla.length);
      }
    }
  }

  function dongu() {
    P.raf = null;
    if (!P.aktif || (P.durum !== 'sayim' && P.durum !== 'calisiyor')) return;
    const an = performance.now();
    guncelle(an);
    if (P.durum === 'sayim' || P.durum === 'calisiyor') kareCiz(an);
    if (P.durum === 'sayim' || P.durum === 'calisiyor') P.raf = requestAnimationFrame(dongu);
  }

  /* ---------- ÖZET ---------- */

  function ozetHesapla() {
    const ol = P.ozetOlaylar;
    const s = { dogru: 0, erken: 0, gec: 0, eksik: 0, tekrar: 0 };
    const olculer = {};
    const olcu = (n) => {
      if (!olculer[n]) olculer[n] = { eksik: 0, erken: 0, gec: 0, tekrar: 0, fazla: 0 };
      return olculer[n];
    };
    let toplamDt = 0;
    let dtSayisi = 0;
    ol.forEach((o) => {
      const r = P.sonuc[o.id];
      s[r.d]++;
      if (r.d !== 'dogru') olcu(olayOlcusu(o))[r.d]++;
      if (P.mod === 'tempo' && r.d !== 'eksik') {
        toplamDt += r.dt;
        dtSayisi++;
      }
    });
    P.fazla.forEach((f) => {
      olcu(f.olcu).fazla++;
    });

    const toplam = ol.length;
    const fazla = P.fazla.length;
    let puan;
    if (P.mod === 'tempo') puan = (s.dogru + 0.5 * (s.erken + s.gec)) / (toplam + fazla);
    else puan = (s.dogru + 0.5 * s.tekrar) / toplam;
    puan = Math.round(Math.max(Math.min(puan, 1), 0) * 100);

    let egilim = '';
    if (P.mod === 'tempo' && dtSayisi >= 3) {
      const ort = Math.round(toplamDt / dtSayisi);
      if (Math.abs(ort) < 30) egilim = 'Ritmin genel olarak düzgün (ortalama sapma ' + Math.abs(ort) + ' ms).';
      else egilim = 'Genelde ortalama ' + Math.abs(ort) + ' ms ' + (ort < 0 ? 'erken' : 'geç') + ' çalıyorsun.';
    }

    const zayif = Object.keys(olculer).map((n) => {
      const c = olculer[n];
      const agirlik = c.eksik + 0.5 * (c.erken + c.gec + c.tekrar + c.fazla);
      const parcalar = [];
      if (c.eksik) parcalar.push(c.eksik + ' eksik');
      if (c.erken) parcalar.push(c.erken + ' erken');
      if (c.gec) parcalar.push(c.gec + ' geç');
      if (c.tekrar) parcalar.push(c.tekrar + ' tekrar denenen');
      if (c.fazla) parcalar.push(c.fazla + ' fazla');
      return { olcu: Number(n), agirlik: agirlik, yazi: parcalar.join(', ') };
    }).filter((x) => x.agirlik > 0).sort((a, b) => b.agirlik - a.agirlik).slice(0, 3);

    return { sayim: s, toplam: toplam, fazla: fazla, puan: puan, egilim: egilim, zayif: zayif };
  }

  function chip(sinif, sayi, ad) {
    const d = document.createElement('div');
    d.className = 'ozet-chip ' + sinif;
    const b = document.createElement('b');
    b.textContent = String(sayi);
    const sp = document.createElement('span');
    sp.textContent = ad;
    d.appendChild(b);
    d.appendChild(sp);
    return d;
  }

  function ozetGoster(r) {
    const ad = P.mod === 'tempo' ? 'Tempoda · ' + HASSASIYET[P.hass].ad + ' · ♩ = ' + Math.round(api.bpm()) : 'Beni bekle';
    $('ozet-baslik').textContent = 'Sonuç · ' + ad;
    $('ozet-puan').textContent = '%' + r.puan;

    const sayilar = $('ozet-sayilar');
    sayilar.replaceChildren();
    sayilar.appendChild(chip('c-dogru', r.sayim.dogru, 'Doğru'));
    if (P.mod === 'tempo') {
      sayilar.appendChild(chip('c-sari', r.sayim.erken, 'Erken'));
      sayilar.appendChild(chip('c-sari', r.sayim.gec, 'Geç'));
      sayilar.appendChild(chip('c-eksik', r.sayim.eksik, 'Eksik'));
    } else {
      sayilar.appendChild(chip('c-sari', r.sayim.tekrar, 'Tekrar denenen'));
    }
    sayilar.appendChild(chip('c-fazla', r.fazla, P.mod === 'tempo' ? 'Fazla nota' : 'Yanlış basış'));

    $('ozet-egilim').textContent = r.egilim;
    $('ozet-egilim').hidden = !r.egilim;

    const zayifKutu = $('ozet-zayif');
    zayifKutu.replaceChildren();
    if (r.zayif.length) {
      const b = document.createElement('p');
      b.className = 'ozet-alt';
      b.textContent = 'Zorlandığın ölçüler';
      zayifKutu.appendChild(b);
      r.zayif.forEach((z) => {
        const p = document.createElement('p');
        p.textContent = 'Ölçü ' + z.olcu + ': ' + z.yazi;
        zayifKutu.appendChild(p);
      });
    } else {
      const p = document.createElement('p');
      p.className = 'ozet-alt';
      p.textContent = 'Tüm ölçüler temiz, tebrikler!';
      zayifKutu.appendChild(p);
    }
    $('ozet-zayif-calis').hidden = r.zayif.length === 0;
    P.enZayifOlcu = r.zayif.length ? r.zayif[0].olcu : 0;

    // Geçmiş: aynı eser ve aynı kip
    const gecmis = gecmisOku();
    const bu = {
      t: Date.now(), eser: api.eserAdi(), mod: P.mod, hass: P.hass,
      bpm: Math.round(api.bpm()), puan: r.puan, notalar: r.toplam
    };
    gecmis.push(bu);
    gecmisYaz(gecmis);
    const oncekiler = gecmis.filter((g) => g.eser === bu.eser && g.mod === bu.mod).slice(-6, -1).reverse();
    const gk = $('ozet-gecmis');
    gk.replaceChildren();
    if (oncekiler.length) {
      const b = document.createElement('p');
      b.className = 'ozet-alt';
      b.textContent = 'Önceki denemeler';
      gk.appendChild(b);
      oncekiler.forEach((g) => {
        const p = document.createElement('p');
        let tarih = '';
        try { tarih = new Date(g.t).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }); } catch (e) {}
        p.textContent = tarih + ' · %' + g.puan + (g.mod === 'tempo' ? ' · ♩ = ' + g.bpm : '');
        gk.appendChild(p);
      });
    }

    $('ozet-yanit').textContent = P.mod === 'tempo'
      ? 'Puan: (doğru + yarım puanla erken/geç) ÷ (notalar + fazla notalar). Yalnızca notanın başladığı an kontrol edilir.'
      : 'Puan: ilk denemede doğru + yarım puanla tekrar denenenler. Yalnızca doğru notaya basma kontrol edilir.';
    $('ozet').hidden = false;
  }

  function ozetKapat() {
    $('ozet').hidden = true;
    durumYaz('Bitti. Yeniden denemek için "Yeniden"e bas.');
  }

  /* ---------- AÇ / KAPAT VE ARAYÜZ ---------- */

  function acKapat() {
    if (!P.aktif) {
      P.aktif = true;
      api.calmaDurdur();
      P.durum = 'hazir';
      P.sonuc = {};
      P.fazla = [];
      $('dene-cubugu').hidden = false;
      $('btn-dene').classList.add('aktif');
      $('btn-cal').disabled = true;
      barYaz();
      durumYaz(hazirYazisi());
      api.kayanYenile();
    } else {
      iptal();
      clearTimeout(P.bitisPlani);
      P.aktif = false;
      P.durum = 'hazir';
      P.sonuc = {};
      P.fazla = [];
      porteIsaretleriTemizle();
      tusIsaretiTemizle();
      kilitle(false);
      $('btn-cal').disabled = false;
      $('dene-cubugu').hidden = true;
      $('ozet').hidden = true;
      $('btn-dene').classList.remove('aktif');
      api.porteCizgi(null);
      api.kayanYenile();
    }
  }

  function modDegistir(yeni) {
    if (P.durum === 'sayim' || P.durum === 'calisiyor') return;
    P.mod = yeni;
    ayarYaz();
    ilerlemeSifirla();
    barYaz();
    durumYaz(hazirYazisi());
    api.kayanYenile();
  }

  function kur(apiNesnesi) {
    api = apiNesnesi;
    ayarOku();

    $('btn-dene').addEventListener('click', acKapat);
    $('dene-bekle').addEventListener('click', () => modDegistir('bekle'));
    $('dene-tempo').addEventListener('click', () => modDegistir('tempo'));
    for (let i = 0; i < 3; i++) {
      $('dh-' + i).addEventListener('click', () => {
        if (P.durum === 'sayim' || P.durum === 'calisiyor') return;
        P.hass = i;
        ayarYaz();
        barYaz();
      });
    }
    $('dene-metro').addEventListener('click', () => {
      P.metro = !P.metro;
      ayarYaz();
      barYaz();
    });
    $('dene-basla').addEventListener('click', () => {
      if (P.durum === 'sayim' || P.durum === 'calisiyor') bitir(true);
      else {
        if (P.durum === 'bitti') ilerlemeSifirla();
        basla();
      }
    });

    $('ozet-kapat').addEventListener('click', ozetKapat);
    $('ozet-tekrar').addEventListener('click', () => {
      $('ozet').hidden = true;
      ilerlemeSifirla();
      barYaz();
      basla();
    });
    $('ozet-zayif-calis').addEventListener('click', () => {
      const n = P.enZayifOlcu;
      $('ozet').hidden = true;
      if (n) api.bolumAyarla(n, n);
      ilerlemeSifirla();
      barYaz();
      durumYaz('Ölçü ' + n + ' seçildi. Başla\'ya bas.');
      api.kayanYenile();
    });

    barYaz();
  }

  window.PERF = {
    kur: kur,
    aktif: () => P.aktif,
    sahne: () => P.aktif,
    kareCiz: () => kareCiz(),
    tusBasildi: tusBasildi,
    isaretYenile: isaretYenile,
    iptal: iptal,
    kapat: () => {
      if (P.aktif) acKapat();
    },
    renk: (id) => {
      if (!P.aktif) return null;
      const r = P.sonuc[id];
      return r ? RENK[r.d] : null;
    },
    bilgi: () => ({ durum: P.durum, mod: P.mod, t0: P.t0, msB: P.msB, gecik: P.gecik, olaylar: P.olaylar, ozet: P.ozetOlaylar.length })
  };
})();
