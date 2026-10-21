/*
  NOTA OKUMA MOTORU (Aşama 11)
  Fotoğraf ya da PDF sayfasından notaları okur ve MusicXML üretir.
  - Görüntü hazırlama ve iki yapay zekâ modelinin çalıştırılması burada (onnxruntime-web).
  - Notaların çözümlenmesi (porte, nota, ritim) arka plan işçisinde (omr-isci.js, Pyodide + oemer, MIT lisansı).
  Her şey bir kapsülün içinde tutulur; dışarıya yalnızca window.OMR verilir.
*/

(function () {
  'use strict';

  const ORT_SURUM = '1.20.1';
  const ORT_TABAN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + ORT_SURUM + '/dist/';
  const PYODIDE_TABAN = 'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/';
  const HEDEF_PIKSEL = 3675000;
  const MODEL1 = { ad: 'm1', boyut: 256, sinif: 3 };
  const MODEL2 = { ad: 'm2', boyut: 288, sinif: 4 };
  const KALITE = { hizli: 256, dengeli: 192, hassas: 128 };   // yama adımı (küçük = daha doğru, daha yavaş)

  let ortSoz = null;
  let isci = null;
  let iptalEdildi = false;
  let satirlar = [];
  let t0 = 0;

  function kayitYaz(s) {
    const t = ((performance.now() - t0) / 1000).toFixed(1);
    satirlar.push('[' + t + ' s] ' + s);
    if (satirlar.length > 300) satirlar.shift();
  }

  function kontrol() {
    if (iptalEdildi) throw new Error('İptal edildi');
  }

  function bekle(ms) {
    return new Promise((c) => setTimeout(c, ms));
  }

  /* ---------- DESTEK KONTROLÜ ---------- */

  function destek() {
    const sorun = [];
    if (typeof WebAssembly === 'undefined') sorun.push('Tarayıcı WebAssembly desteklemiyor.');
    if (typeof Worker === 'undefined') sorun.push('Tarayıcı arka plan işçisi desteklemiyor.');
    if (typeof createImageBitmap === 'undefined') sorun.push('Tarayıcı görüntü çözmeyi desteklemiyor.');
    if (!navigator.onLine) sorun.push('İlk kullanımda internet gerekir (şu an çevrimdışısın).');
    const bellek = navigator.deviceMemory || 0;
    const uyari = [];
    if (bellek && bellek < 4) uyari.push('Cihaz belleği az (' + bellek + ' GB). Okuma yavaş olabilir ya da yarıda kalabilir.');
    return { tamam: sorun.length === 0, sorun: sorun, uyari: uyari };
  }

  function izParcacigi() {
    if (!self.crossOriginIsolated) return 1;
    const cekirdek = navigator.hardwareConcurrency || 2;
    return Math.max(1, Math.min(4, Math.floor(cekirdek / 2)));
  }

  /* ---------- onnxruntime-web ---------- */

  function ortYukle() {
    if (window.ort) return Promise.resolve(window.ort);
    if (ortSoz) return ortSoz;
    ortSoz = new Promise((coz, red) => {
      const s = document.createElement('script');
      s.src = ORT_TABAN + 'ort.min.js';
      s.onload = () => {
        if (!window.ort) return red(new Error('Model motoru başlatılamadı'));
        window.ort.env.wasm.wasmPaths = ORT_TABAN;
        window.ort.env.wasm.numThreads = izParcacigi();
        coz(window.ort);
      };
      s.onerror = () => red(new Error('Model motoru indirilemedi. İnternet bağlantını kontrol et.'));
      document.head.appendChild(s);
    });
    ortSoz.catch(() => { ortSoz = null; });
    return ortSoz;
  }

  /* ---------- MODEL DOSYALARI ---------- */

  let manifest = null;

  async function manifestAl() {
    if (manifest) return manifest;
    const r = await fetch('omr/model.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('Model bilgisi bulunamadı (omr/model.json). Model dosyaları yüklenmemiş.');
    manifest = await r.json();
    return manifest;
  }

  async function modelBaytlari(ad, ilerle) {
    const m = await manifestAl();
    const bilgi = m[ad];
    if (!bilgi) throw new Error('Model bilgisi eksik: ' + ad);
    const parcalar = [];
    let toplam = 0;
    for (let i = 0; i < bilgi.parcalar.length; i++) {
      kontrol();
      const p = bilgi.parcalar[i];
      const r = await fetch('omr/' + p.ad);
      if (!r.ok) throw new Error('Model parçası indirilemedi: ' + p.ad + ' (' + r.status + ')');
      const b = new Uint8Array(await r.arrayBuffer());
      if (b.length !== p.boyut) throw new Error('Model parçası eksik ya da bozuk: ' + p.ad);
      parcalar.push(b);
      toplam += b.length;
      if (ilerle) ilerle((i + 1) / bilgi.parcalar.length);
    }
    const hepsi = new Uint8Array(toplam);
    let konum = 0;
    parcalar.forEach((b) => { hepsi.set(b, konum); konum += b.length; });
    if (bilgi.boyut && hepsi.length !== bilgi.boyut) throw new Error('Model boyutu uyuşmuyor: ' + ad);
    return hepsi;
  }

  /* ---------- GÖRÜNTÜ ---------- */

  // kaynak: Blob, ImageBitmap ya da canvas. Dönüş: {w, h, rgba}
  async function goruntuHazirla(kaynak) {
    let bmp = kaynak;
    if (typeof Blob !== 'undefined' && kaynak instanceof Blob) {
      try {
        bmp = await createImageBitmap(kaynak, { imageOrientation: 'from-image' });
      } catch (e) {
        bmp = await createImageBitmap(kaynak);
      }
    }
    const bw = bmp.width, bh = bmp.height;
    if (!bw || !bh) throw new Error('Görüntü okunamadı');
    const oran = Math.sqrt(HEDEF_PIKSEL / (bw * bh));
    const w = Math.max(Math.round(bw * oran), 600);
    const h = Math.max(Math.round(bh * oran), 600);
    const tuval = document.createElement('canvas');
    tuval.width = w;
    tuval.height = h;
    const c = tuval.getContext('2d', { willReadFrequently: true });
    c.fillStyle = '#fff';
    c.fillRect(0, 0, w, h);
    c.imageSmoothingQuality = 'high';
    c.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) { try { bmp.close(); } catch (e) {} }
    const rgba = c.getImageData(0, 0, w, h).data;
    tuval.width = 1;
    tuval.height = 1;
    return { w: w, h: h, rgba: rgba };
  }

  /* ---------- MODEL ÇIKARIMI (yama yama) ---------- */

  function konumlar(uzunluk, boy, adim) {
    const l = [];
    for (let p = 0; p < uzunluk; p += adim) {
      const q = p + boy > uzunluk ? uzunluk - boy : p;
      if (l.length === 0 || l[l.length - 1] !== q) l.push(q);
    }
    return l;
  }

  // Yama neredeyse boş (düz beyaz kâğıt) mı?
  function yamaBos(res, x, y, boy) {
    let n = 0, top = 0, top2 = 0;
    for (let j = 0; j < boy; j += 6) {
      let p = ((y + j) * res.w + x) * 4;
      for (let i = 0; i < boy; i += 6) {
        const l = (res.rgba[p] * 3 + res.rgba[p + 1] * 6 + res.rgba[p + 2]) / 10;
        top += l;
        top2 += l * l;
        n++;
        p += 24;
      }
    }
    const ort = top / n;
    const sapma = Math.sqrt(Math.max(top2 / n - ort * ort, 0));
    return ort > 120 && sapma < 5;
  }

  async function haritaCikar(ort, model, bayt, res, adim, atla, ilerle) {
    const boy = model.boyut, C = model.sinif;
    const W = res.w, H = res.h;
    const ys = konumlar(H, boy, adim);
    const xs = konumlar(W, boy, adim);
    let liste = [];
    ys.forEach((y) => xs.forEach((x) => { liste.push([x, y]); }));
    liste = liste.filter((k) => !atla(k[0], k[1], boy));
    kayitYaz(model.ad + ': ' + liste.length + ' yama işlenecek (' + (ys.length * xs.length) + ' içinden)');

    const harita = new Uint8Array(W * H);
    if (liste.length === 0) {
      if (ilerle) ilerle(1, 0, 0);
      return harita;
    }

    kayitYaz(model.ad + ': oturum kuruluyor');
    let oturum;
    try {
      oturum = await ort.InferenceSession.create(bayt, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    } catch (e) {
      throw new Error('Model açılamadı: ' + ((e && e.message) || e));
    }
    const giris = oturum.inputNames[0];
    const cikis = oturum.outputNames[0];

    const acc = new Float32Array(W * H * C);
    const sayac = new Uint8Array(W * H);
    const GRUP = 4;
    const bir = boy * boy * 3;
    let bitti = 0;
    const tm = performance.now();

    for (let b0 = 0; b0 < liste.length; b0 += GRUP) {
      kontrol();
      const grup = liste.slice(b0, b0 + GRUP);
      const veri = new Uint8Array(grup.length * bir);
      grup.forEach((k, gi) => {
        let o = gi * bir;
        for (let j = 0; j < boy; j++) {
          let p = ((k[1] + j) * W + k[0]) * 4;
          for (let i = 0; i < boy; i++) {
            // oemer'in beklediği kanal sırası: B, G, R
            veri[o++] = res.rgba[p + 2];
            veri[o++] = res.rgba[p + 1];
            veri[o++] = res.rgba[p];
            p += 4;
          }
        }
      });
      const tensor = new ort.Tensor('uint8', veri, [grup.length, boy, boy, 3]);
      const sonuc = await oturum.run({ [giris]: tensor });
      const cikti = sonuc[cikis];
      const d = cikti.data;
      grup.forEach((k, gi) => {
        let o = gi * boy * boy * C;
        for (let j = 0; j < boy; j++) {
          let q = (k[1] + j) * W + k[0];
          for (let i = 0; i < boy; i++, q++) {
            const a = q * C;
            for (let c = 0; c < C; c++) acc[a + c] += d[o++];
            sayac[q]++;
          }
        }
      });
      bitti += grup.length;
      if (ilerle) {
        const gecen = (performance.now() - tm) / 1000;
        ilerle(bitti / liste.length, gecen, (gecen / bitti) * (liste.length - bitti));
      }
      await bekle(0);
    }
    try { await oturum.release(); } catch (e) {}
    kayitYaz(model.ad + ': çıkarım bitti (' + ((performance.now() - tm) / 1000).toFixed(0) + ' s)');

    for (let q = 0, a = 0; q < harita.length; q++, a += C) {
      if (sayac[q] === 0) continue;
      let en = 0;
      for (let c = 1; c < C; c++) if (acc[a + c] > acc[a + en]) en = c;
      harita[q] = en;
    }
    return harita;
  }

  /* ---------- PYODIDE İŞÇİSİ ---------- */

  function isciBaslat(ilerleme) {
    return new Promise((coz, red) => {
      const w = new Worker('omr-isci.js');
      isci = w;
      w.onerror = (e) => red(new Error('Okuma işçisi başlatılamadı' + (e && e.message ? ': ' + e.message : '')));
      w.onmessage = (e) => {
        const m = e.data;
        if (m.t === 'ilerleme') {
          kayitYaz('işçi: ' + m.ad);
          if (ilerleme) ilerleme(m.ad);
        } else if (m.t === 'hazir') {
          coz(w);
        } else if (m.t === 'hata') {
          red(new Error(m.mesaj));
        }
      };
      w.postMessage({
        t: 'baslat',
        pyodideTaban: PYODIDE_TABAN,
        zipAdres: new URL('omr/oemer_py.zip', location.href).href,
        svmAdres: new URL('omr/svm.bin', location.href).href
      });
    });
  }

  function isciCalistir(w, veri, ilerleme) {
    return new Promise((coz, red) => {
      w.onerror = (e) => red(new Error('Okuma işçisi çöktü' + (e && e.message ? ': ' + e.message : '')));
      w.onmessage = (e) => {
        const m = e.data;
        if (m.t === 'ilerleme') {
          kayitYaz('işçi: ' + m.ad);
          if (ilerleme) ilerleme(m.ad);
        } else if (m.t === 'bitti') {
          coz(m.xml);
        } else if (m.t === 'hata') {
          red(new Error(m.mesaj));
        }
      };
      w.postMessage(veri, [veri.h1.buffer, veri.h2.buffer, veri.goruntu.buffer]);
    });
  }

  function isciDurdur() {
    if (isci) {
      try { isci.terminate(); } catch (e) {}
      isci = null;
    }
  }

  /* ---------- ANA İŞLEV ---------- */

  /*
    oku(kaynak, secenek)
      kaynak: Blob (fotoğraf) ya da canvas / ImageBitmap (PDF sayfası)
      secenek: { kalite: 'hizli'|'dengeli'|'hassas', deskew: true/false, baslik: '...',
                 ilerle: function({asama, oran, ileti, kalanSn}) }
    Dönüş: { xml, sureSn }
  */
  async function oku(kaynak, secenek) {
    secenek = secenek || {};
    const adim = KALITE[secenek.kalite] || KALITE.hizli;
    const deskew = secenek.deskew !== false;
    const bildir = (asama, oran, ileti, kalanSn) => {
      if (secenek.ilerle) secenek.ilerle({ asama: asama, oran: oran, ileti: ileti || '', kalanSn: kalanSn });
    };
    iptalEdildi = false;
    satirlar = [];
    t0 = performance.now();
    kayitYaz('Başladı · kalite adımı ' + adim + ' · iş parçacığı ' + izParcacigi() +
      ' · çekirdek ' + navigator.hardwareConcurrency + ' · bellek ' + (navigator.deviceMemory || '?') + ' GB · izole ' +
      (self.crossOriginIsolated ? 'evet' : 'hayır'));

    try {
      bildir('hazirlik', 0, 'Görüntü hazırlanıyor');
      const res = await goruntuHazirla(kaynak);
      kayitYaz('Görüntü ' + res.w + 'x' + res.h);
      kontrol();

      bildir('hazirlik', 0.05, 'Model motoru yükleniyor');
      const ort = secenek.testHaritalari ? null : await ortYukle();
      kontrol();

      // Birinci model
      let harita1;
      if (secenek.testHaritalari) {
        harita1 = secenek.testHaritalari.m1;   // yalnızca testler için
      } else {
        bildir('model1', 0, 'Birinci model indiriliyor');
        let bayt = await modelBaytlari(MODEL1.ad, (o) => bildir('model1', o * 0.2, 'Birinci model indiriliyor'));
        kayitYaz('m1 indirildi');
        const bosAtla = (x, y, boy) => yamaBos(res, x, y, boy);
        harita1 = await haritaCikar(ort, MODEL1, bayt, res, adim, bosAtla, (o, gecen, kalan) => {
          bildir('model1', 0.2 + o * 0.8, 'Porte ve semboller aranıyor', kalan);
        });
        bayt = null;
      }
      kontrol();

      // Birinci modelin hiçbir şey bulamadığı yerlerde ikinci model çalıştırılmaz
      const W = res.w, H = res.h;
      const atla2 = (x, y, boy) => {
        let n = 0;
        for (let j = 0; j < boy; j += 3) {
          const s = (y + j) * W + x;
          for (let i = 0; i < boy; i += 3) if (harita1[s + i] !== 0) n++;
        }
        return n < 12;
      };
      let harita2;
      if (secenek.testHaritalari) {
        harita2 = secenek.testHaritalari.m2;
      } else {
        bildir('model2', 0, 'İkinci model indiriliyor');
        let bayt2 = await modelBaytlari(MODEL2.ad, (o) => bildir('model2', o * 0.2, 'İkinci model indiriliyor'));
        kayitYaz('m2 indirildi');
        harita2 = await haritaCikar(ort, MODEL2, bayt2, res, adim, atla2, (o, gecen, kalan) => {
          bildir('model2', 0.2 + o * 0.8, 'Notalar ve semboller aranıyor', kalan);
        });
        bayt2 = null;
      }
      kontrol();

      // Çözümleme (Python)
      bildir('cozumleme', 0, 'Okuma motoru hazırlanıyor');
      const w = await isciBaslat((ad) => bildir('cozumleme', 0.1, ad));
      kontrol();
      const bgr = new Uint8Array(W * H * 3);
      for (let q = 0, p = 0, o = 0; q < W * H; q++, p += 4) {
        bgr[o++] = res.rgba[p + 2];
        bgr[o++] = res.rgba[p + 1];
        bgr[o++] = res.rgba[p];
      }
      const xml = await isciCalistir(w, {
        t: 'calis', h1: harita1, h2: harita2, goruntu: bgr, h: H, w: W,
        deskew: deskew, baslik: secenek.baslik || 'Nota'
      }, (ad) => bildir('cozumleme', 0.5, ad));
      isciDurdur();
      const sure = (performance.now() - t0) / 1000;
      kayitYaz('Bitti · ' + sure.toFixed(0) + ' s · MusicXML ' + xml.length + ' karakter');
      bildir('bitti', 1, 'Tamamlandı');
      return { xml: xml, sureSn: sure };
    } catch (e) {
      isciDurdur();
      kayitYaz('HATA: ' + ((e && e.message) || e));
      throw e;
    }
  }

  function iptal() {
    iptalEdildi = true;
    isciDurdur();
  }

  window.OMR = {
    oku: oku,
    iptal: iptal,
    destek: destek,
    kayit: () => satirlar.join('\n'),
    hedefPiksel: HEDEF_PIKSEL,
    kaliteler: KALITE
  };
})();
