/*
  KÜTÜPHANE (Aşama 6)
  - Eser ekleme (PDF, JPG, JPEG, PNG), cihazda saklama (IndexedDB)
  - Görüntüleme (PDF sayfaları, yakınlaştırma; fotoğraflar)
  - Yedekleme (.piyanohoca dosyası) ve geri yükleme
  - PDF desteği (pdf.js 3.11.174) uygulama içinden bir kez indirilir
  Her şey bir kapsülün içinde tutulur; dışarıya yalnızca üç işlev verilir.
*/

(function () {
  'use strict';

  const DB_AD = 'piyano-hoca-db';
  const DB_SURUM = 1;
  const DEPO = 'eserler';
  const MAKS_BOYUT = 50 * 1024 * 1024; // 50 MB
  const YEDEK_IMZA = 'PIYANOHOCA1';
  const YEDEK_ANAHTAR = 'piyano-son-yedek';
  const PDF_ONBELLEK = 'piyano-pdf-v1';
  const PDF_ZAMAN_ASIMI = 60000;
  const PDF_DOSYALAR = [
    {
      ad: 'pdf.min.js',
      enAz: 200000,
      adresler: [
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
        'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js'
      ]
    },
    {
      ad: 'pdf.worker.min.js',
      enAz: 600000,
      adresler: [
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
        'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
      ]
    }
  ];

  const $ = (id) => document.getElementById(id);

  function bekle(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function hataYazi(e) {
    return e && e.message ? e.message : 'bilinmeyen hata';
  }

  function boyutYaz(b) {
    if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
    return Math.max(1, Math.round(b / 1024)) + ' KB';
  }

  function tarihYaz(ms) {
    try {
      return new Date(ms).toLocaleDateString('tr-TR');
    } catch (e) {
      return '';
    }
  }

  function dosyaAdiTemizle(ad) {
    return String(ad).replace(/[\\/:*?"<>|]+/g, '_').trim() || 'eser';
  }

  function eleman(ad, sinif, yazi) {
    const e = document.createElement(ad);
    if (sinif) e.className = sinif;
    if (yazi !== undefined) e.textContent = yazi;
    return e;
  }

  function mesajYaz(id, yazi) {
    const e = $(id);
    if (e) e.textContent = yazi;
  }
  const kutMesaj = (y) => mesajYaz('kut-mesaj', y);
  const yedekMesaj = (y) => mesajYaz('yedek-mesaj', y);
  const pdfMesaj = (y) => mesajYaz('pdf-mesaj', y);

  /* ---------- VERİTABANI (IndexedDB) ---------- */

  let dbSoz = null;

  function dbAc() {
    if (dbSoz) return dbSoz;
    dbSoz = new Promise((coz, red) => {
      if (!window.indexedDB) {
        red(new Error('Bu tarayıcı yerel veritabanını desteklemiyor'));
        return;
      }
      const ist = indexedDB.open(DB_AD, DB_SURUM);
      ist.onupgradeneeded = () => {
        const db = ist.result;
        if (!db.objectStoreNames.contains(DEPO)) {
          db.createObjectStore(DEPO, { keyPath: 'id' });
        }
      };
      ist.onsuccess = () => coz(ist.result);
      ist.onerror = () => {
        dbSoz = null;
        red(ist.error || new Error('Veritabanı açılamadı'));
      };
      ist.onblocked = () => {
        dbSoz = null;
        red(new Error('Veritabanı başka bir sekme tarafından kilitli'));
      };
    });
    return dbSoz;
  }

  // fn(store) bir istek (request) döndürebilir; sonuç işlem bitince verilir.
  async function dbIslem(mod, fn) {
    const db = await dbAc();
    return new Promise((coz, red) => {
      let sonuc;
      let tx;
      try {
        tx = db.transaction(DEPO, mod);
        const istek = fn(tx.objectStore(DEPO));
        if (istek && istek.addEventListener) {
          istek.addEventListener('success', () => {
            sonuc = istek.result;
          });
        }
      } catch (e) {
        red(e);
        return;
      }
      tx.oncomplete = () => coz(sonuc);
      tx.onerror = () => red(tx.error || new Error('Kayıt hatası'));
      tx.onabort = () => red(tx.error || new Error('İşlem iptal edildi'));
    });
  }

  function yeniKimlik() {
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------- PDF DESTEĞİ (pdf.js) ---------- */

  let pdfSoz = null;

  function pdfKutu() {
    return window.pdfjsLib || window['pdfjs-dist/build/pdf'] || null;
  }

  async function adresIndir(adres, enAz) {
    const denetci = new AbortController();
    const sayac = setTimeout(() => denetci.abort(), PDF_ZAMAN_ASIMI);
    try {
      const yanit = await fetch(adres, { mode: 'cors', signal: denetci.signal });
      if (!yanit.ok) throw new Error('HTTP ' + yanit.status);
      const veri = await yanit.arrayBuffer();
      if (veri.byteLength < enAz) throw new Error('dosya eksik geldi');
      return veri;
    } finally {
      clearTimeout(sayac);
    }
  }

  async function pdfDosyaSayisi() {
    if (!('caches' in window)) return 0;
    const onb = await caches.open(PDF_ONBELLEK);
    let n = 0;
    for (const d of PDF_DOSYALAR) {
      if (await onb.match(d.adresler[0])) n++;
    }
    return n;
  }

  async function pdfIndir(ilerleme) {
    if (!('caches' in window)) throw new Error('Tarayıcı önbelleği desteklemiyor');
    if (!navigator.onLine) throw new Error('İnternet bağlantısı yok');
    const onb = await caches.open(PDF_ONBELLEK);
    let bitti = 0;
    for (const d of PDF_DOSYALAR) {
      const anahtar = d.adresler[0];
      if (await onb.match(anahtar)) {
        bitti++;
        ilerleme(bitti, PDF_DOSYALAR.length);
        continue;
      }
      let basari = false;
      let sonHata = 'bilinmiyor';
      for (const adres of d.adresler) {
        const sunucu = new URL(adres).hostname;
        for (let deneme = 0; deneme < 2 && !basari; deneme++) {
          try {
            const veri = await adresIndir(adres, d.enAz);
            await onb.put(
              anahtar,
              new Response(veri, { headers: { 'Content-Type': 'text/javascript' } })
            );
            basari = true;
          } catch (e) {
            const neden = e && e.name === 'AbortError' ? 'zaman aşımı' : hataYazi(e);
            sonHata = sunucu + ': ' + neden;
            await bekle(400);
          }
        }
        if (basari) break;
      }
      if (!basari) throw new Error(d.ad + ' indirilemedi (' + sonHata + ')');
      bitti++;
      ilerleme(bitti, PDF_DOSYALAR.length);
    }
  }

  // Önbellekteki pdf.js'i sayfaya yükler (bir kez).
  function pdfHazirla() {
    if (pdfKutu() && pdfKutu().GlobalWorkerOptions && pdfKutu().GlobalWorkerOptions.workerSrc) {
      return Promise.resolve();
    }
    if (pdfSoz) return pdfSoz;
    pdfSoz = (async () => {
      if (!('caches' in window)) throw new Error('Tarayıcı önbelleği desteklemiyor');
      const onb = await caches.open(PDF_ONBELLEK);
      const ana = await onb.match(PDF_DOSYALAR[0].adresler[0]);
      const isci = await onb.match(PDF_DOSYALAR[1].adresler[0]);
      if (!ana || !isci) {
        throw new Error('PDF desteği indirilmemiş. Ayarlar > PDF desteği bölümünden indir.');
      }
      const anaBlob = new Blob([await ana.arrayBuffer()], { type: 'text/javascript' });
      const isciBlob = new Blob([await isci.arrayBuffer()], { type: 'text/javascript' });
      const anaUrl = URL.createObjectURL(anaBlob);
      await new Promise((coz, red) => {
        const s = document.createElement('script');
        s.src = anaUrl;
        s.onload = coz;
        s.onerror = () => red(new Error('PDF bileşeni yüklenemedi'));
        document.head.appendChild(s);
      });
      const kutu = pdfKutu();
      if (!kutu) throw new Error('PDF bileşeni başlatılamadı');
      kutu.GlobalWorkerOptions.workerSrc = URL.createObjectURL(isciBlob);
    })();
    pdfSoz.catch(() => {
      pdfSoz = null;
    });
    return pdfSoz;
  }

  async function pdfKartiYenile() {
    const durum = $('ay-pdf');
    const indirBtn = $('btn-pdf-indir');
    const silBtn = $('btn-pdf-sil');
    if (!durum) return;
    let sayi = 0;
    try {
      sayi = await pdfDosyaSayisi();
    } catch (e) {}
    if (sayi === PDF_DOSYALAR.length) {
      durum.textContent = 'Hazır';
      indirBtn.textContent = 'PDF desteği indirildi';
      indirBtn.disabled = true;
    } else if (sayi > 0) {
      durum.textContent = 'Eksik indirme (' + sayi + '/' + PDF_DOSYALAR.length + ')';
      indirBtn.textContent = 'İndirmeyi tamamla';
      indirBtn.disabled = false;
    } else {
      durum.textContent = 'İndirilmedi';
      indirBtn.textContent = 'PDF desteğini indir (≈1,4 MB)';
      indirBtn.disabled = false;
    }
    silBtn.disabled = sayi === 0;
  }

  let pdfIndiriliyor = false;

  function pdfKartiKur() {
    const indirBtn = $('btn-pdf-indir');
    const silBtn = $('btn-pdf-sil');
    const cubuk = $('pdf-ilerleme');
    const dolgu = $('pdf-ilerleme-dolgu');

    indirBtn.addEventListener('click', async () => {
      if (pdfIndiriliyor) return;
      pdfIndiriliyor = true;
      indirBtn.disabled = true;
      cubuk.hidden = false;
      dolgu.style.width = '0%';
      pdfMesaj('İndiriliyor…');
      try {
        await pdfIndir((bitti, toplam) => {
          dolgu.style.width = Math.round((bitti / toplam) * 100) + '%';
          pdfMesaj('İndiriliyor: ' + bitti + ' / ' + toplam);
        });
        pdfSoz = null;
        await pdfHazirla();
        pdfMesaj('PDF desteği hazır ve yüklendi. Artık internetsiz çalışır.');
      } catch (e) {
        pdfMesaj(
          'Tamamlanamadı: ' + hataYazi(e) +
          '. İndirilen kısım saklandı, düğmeye tekrar basınca kaldığı yerden sürer.'
        );
      }
      pdfIndiriliyor = false;
      cubuk.hidden = true;
      await pdfKartiYenile();
    });

    silBtn.addEventListener('click', async () => {
      if (!confirm('İndirilen PDF desteği silinsin mi? Kayıtlı eserlerin silinmez. PDF açmak için yeniden indirmen gerekir (≈1,4 MB).')) return;
      try {
        if ('caches' in window) await caches.delete(PDF_ONBELLEK);
        pdfMesaj('PDF desteği silindi. Sayfa yenilenince tamamen kalkar.');
      } catch (e) {
        pdfMesaj('Silinemedi: ' + hataYazi(e));
      }
      await pdfKartiYenile();
    });

    pdfKartiYenile();
  }

  /* ---------- ESER EKLEME ---------- */

  function resimYukle(url) {
    return new Promise((coz, red) => {
      const r = new Image();
      r.onload = () => coz(r);
      r.onerror = () => red(new Error('Görüntü açılamadı (bozuk ya da desteklenmeyen dosya)'));
      r.src = url;
    });
  }

  /* ---------- ÇALINABİLİR ESERLER (MusicXML, MIDI, düzenlenen eserler) ---------- */

  const NOTA_UZANTILARI = ['musicxml', 'xml', 'mxl', 'mid', 'midi'];

  // Eser nesnesini kütüphaneye yeni kayıt olarak ekler, kayıt kimliğini döndürür
  async function notaKayitOlustur(eser) {
    const blob = new Blob([JSON.stringify(eser)], { type: 'application/json' });
    const kayit = {
      id: yeniKimlik(),
      surum: 1,
      ad: String(eser.baslik || 'Adsız').slice(0, 120),
      tur: 'nota',
      mime: 'application/json',
      sayfa: 1,
      boyut: blob.size,
      eklenme: Date.now(),
      notaSayisi: eser.notalar.length,
      olcuSayisi: eser.olcuSayisi,
      tempo: eser.tempo,
      blob: blob
    };
    try {
      await dbIslem('readwrite', (s) => s.put(kayit));
    } catch (e) {
      if (e && e.name === 'QuotaExceededError') throw new Error('cihazda yeterli yer yok');
      throw e;
    }
    return kayit.id;
  }

  // Düzenlenen eseri mevcut kayda geri yazar
  async function notaKaydet(id, eser) {
    const kayit = await dbIslem('readonly', (s) => s.get(id));
    if (!kayit) throw new Error('kütüphane kaydı bulunamadı');
    const blob = new Blob([JSON.stringify(eser)], { type: 'application/json' });
    kayit.blob = blob;
    kayit.boyut = blob.size;
    kayit.notaSayisi = eser.notalar.length;
    kayit.olcuSayisi = eser.olcuSayisi;
    kayit.tempo = eser.tempo;
    await dbIslem('readwrite', (s) => s.put(kayit));
  }

  async function notaAc(id) {
    try {
      const kayit = await dbIslem('readonly', (s) => s.get(id));
      if (!kayit) throw new Error('eser bulunamadı');
      const eser = JSON.parse(await kayit.blob.text());
      window.NOTA_IC.dogrula(eser);
      eser.baslik = kayit.ad;
      if (!window.eserAc) throw new Error('çalma ekranı hazır değil');
      window.eserAc(eser, kayit.id);
    } catch (e) {
      kutMesaj('Eser açılamadı: ' + hataYazi(e));
    }
  }

  async function notaDosyasiEkle(dosya) {
    if (!window.NOTA_IC) throw new Error('içe aktarma modülü yüklenemedi');
    const sonuc = await window.NOTA_IC.dosyadanEser(dosya);
    await notaKayitOlustur(sonuc.eser);
    return sonuc.uyari;
  }

  async function dosyaEkle(dosya) {
    const tamAd = dosya.name || 'Adsız';
    const uzanti = tamAd.indexOf('.') >= 0 ? tamAd.split('.').pop().toLowerCase() : '';
    if (NOTA_UZANTILARI.indexOf(uzanti) >= 0) {
      try {
        return await notaDosyasiEkle(dosya);
      } catch (e) {
        throw new Error('"' + tamAd + '": ' + hataYazi(e));
      }
    }
    let tur = null;
    let mime = '';
    if (uzanti === 'pdf') {
      tur = 'pdf';
      mime = 'application/pdf';
    } else if (uzanti === 'jpg' || uzanti === 'jpeg') {
      tur = 'resim';
      mime = 'image/jpeg';
    } else if (uzanti === 'png') {
      tur = 'resim';
      mime = 'image/png';
    } else {
      throw new Error('"' + tamAd + '": yalnızca PDF, JPG, PNG, MusicXML (.musicxml, .xml, .mxl) ve MIDI (.mid) eklenebilir');
    }
    if (dosya.size === 0) throw new Error('"' + tamAd + '": dosya boş');
    if (dosya.size > MAKS_BOYUT) {
      throw new Error('"' + tamAd + '": ' + boyutYaz(dosya.size) + ', en fazla 50 MB eklenebilir');
    }

    let sayfa = 1;
    if (tur === 'pdf') {
      await pdfHazirla();
      const veri = await dosya.arrayBuffer();
      let doc;
      try {
        doc = await pdfKutu().getDocument({ data: veri }).promise;
      } catch (e) {
        if (e && e.name === 'PasswordException') {
          throw new Error('"' + tamAd + '": şifreli PDF desteklenmiyor');
        }
        throw new Error('"' + tamAd + '": PDF açılamadı (' + hataYazi(e) + ')');
      }
      sayfa = doc.numPages;
      try { doc.destroy(); } catch (e) {}
    } else {
      const url = URL.createObjectURL(dosya);
      try {
        await resimYukle(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    const kayit = {
      id: yeniKimlik(),
      surum: 1,
      ad: tamAd.replace(/\.[^.]+$/, '').slice(0, 120) || 'Adsız',
      tur: tur,
      mime: mime,
      sayfa: sayfa,
      boyut: dosya.size,
      eklenme: Date.now(),
      blob: new Blob([dosya], { type: mime })
    };
    try {
      await dbIslem('readwrite', (s) => s.put(kayit));
    } catch (e) {
      if (e && e.name === 'QuotaExceededError') {
        throw new Error('"' + tamAd + '": cihazda yeterli yer yok');
      }
      throw e;
    }
  }

  function eserEkleKur() {
    const girdi = $('dosya-sec');
    $('btn-eser-ekle').addEventListener('click', () => girdi.click());
    girdi.addEventListener('change', async () => {
      const dosyalar = Array.from(girdi.files || []);
      girdi.value = '';
      if (dosyalar.length === 0) return;

      try {
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
      } catch (e) {}

      const hatalar = [];
      const notlar = [];
      let eklenen = 0;
      for (let i = 0; i < dosyalar.length; i++) {
        kutMesaj('Ekleniyor: ' + dosyalar[i].name + ' (' + (i + 1) + '/' + dosyalar.length + ')');
        try {
          const uyari = await dosyaEkle(dosyalar[i]);
          if (uyari && uyari.length) notlar.push(dosyalar[i].name + ': ' + uyari.join(' '));
          eklenen++;
        } catch (e) {
          hatalar.push(hataYazi(e));
        }
      }
      let ozet = eklenen + ' eser eklendi.';
      if (hatalar.length) ozet += ' Eklenemeyenler: ' + hatalar.join(' | ');
      if (notlar.length) ozet += ' Dikkat: ' + notlar.join(' | ');
      kutMesaj(ozet);
      await eserListesiYenile();
    });
  }

  /* ---------- LİSTE ---------- */

  function sonYedekOku() {
    try {
      const v = Number(localStorage.getItem(YEDEK_ANAHTAR));
      return v ? tarihYaz(v) : 'Hiç yedek alınmadı';
    } catch (e) {
      return 'Bilinmiyor';
    }
  }

  function sonYedekYaz() {
    try {
      localStorage.setItem(YEDEK_ANAHTAR, String(Date.now()));
    } catch (e) {}
  }

  function uzantiBul(k) {
    if (k.tur === 'pdf') return '.pdf';
    return k.mime === 'image/png' ? '.png' : '.jpg';
  }

  function eserSatiri(k) {
    const satir = eleman('div', 'eser-satir');
    const bilgi = eleman('div', 'eser-bilgi');
    const nota = k.tur === 'nota';
    bilgi.appendChild(eleman('b', '', (nota ? '🎼 ' : k.tur === 'pdf' ? '📄 ' : '🖼 ') + k.ad));
    const meta = nota
      ? (k.notaSayisi || '?') + ' nota · ' + (k.olcuSayisi || '?') + ' ölçü · ♩ = ' +
        (k.tempo || '?') + ' · ' + tarihYaz(k.eklenme)
      : (k.tur === 'pdf' ? k.sayfa + ' sayfa · ' : 'Fotoğraf · ') +
        boyutYaz(k.boyut) + ' · ' + tarihYaz(k.eklenme);
    bilgi.appendChild(eleman('span', '', meta));
    satir.appendChild(bilgi);

    const islem = eleman('div', 'eser-islem');

    const ac = eleman('button', 'birincil', nota ? 'Çal / düzenle' : 'Aç');
    ac.type = 'button';
    ac.addEventListener('click', () => (nota ? notaAc(k.id) : gorunumAc(k.id)));

    const adDegistir = eleman('button', '', 'Adı değiştir');
    adDegistir.type = 'button';
    adDegistir.addEventListener('click', async () => {
      const yeni = prompt('Eserin yeni adı:', k.ad);
      if (yeni === null) return;
      const temiz = yeni.trim().slice(0, 120);
      if (!temiz) return;
      try {
        await dbIslem('readwrite', (s) => {
          const g = s.get(k.id);
          g.addEventListener('success', () => {
            const r = g.result;
            if (r) {
              r.ad = temiz;
              s.put(r);
            }
          });
          return g;
        });
        await eserListesiYenile();
      } catch (e) {
        kutMesaj('Ad değiştirilemedi: ' + hataYazi(e));
      }
    });

    const yedekle = eleman('button', '', 'Dışa aktar');
    yedekle.type = 'button';
    yedekle.addEventListener('click', async () => {
      try {
        const kayit = await dbIslem('readonly', (s) => s.get(k.id));
        if (!kayit) throw new Error('eser bulunamadı');
        dosyaIndir(yedekOlustur([kayit]), dosyaAdiTemizle(k.ad) + '.piyanohoca');
        kutMesaj('"' + k.ad + '" dışa aktarıldı (.piyanohoca). İndirilenler klasörüne bak.');
      } catch (e) {
        kutMesaj('Dışa aktarılamadı: ' + hataYazi(e));
      }
    });

    const indir = eleman('button', '', 'Orijinali indir');
    indir.type = 'button';
    indir.addEventListener('click', async () => {
      try {
        const kayit = await dbIslem('readonly', (s) => s.get(k.id));
        if (!kayit) throw new Error('eser bulunamadı');
        dosyaIndir(kayit.blob, dosyaAdiTemizle(k.ad) + uzantiBul(k));
      } catch (e) {
        kutMesaj('İndirilemedi: ' + hataYazi(e));
      }
    });

    const sil = eleman('button', 'uyari', 'Sil');
    sil.type = 'button';
    sil.addEventListener('click', async () => {
      if (!confirm('"' + k.ad + '" silinsin mi? Bu işlem geri alınamaz. Önce yedek almanı öneririm.')) return;
      try {
        await dbIslem('readwrite', (s) => s.delete(k.id));
        kutMesaj('"' + k.ad + '" silindi.');
        await eserListesiYenile();
      } catch (e) {
        kutMesaj('Silinemedi: ' + hataYazi(e));
      }
    });

    const oku = eleman('button', '', '🎼 Notayı oku');
    oku.type = 'button';
    oku.addEventListener('click', () => {
      if (window.OMRUI) window.OMRUI.ac(k);
      else kutMesaj('Nota okuma modülü yüklenemedi.');
    });

    (nota ? [ac, adDegistir, yedekle, sil] : [ac, oku, adDegistir, yedekle, indir, sil])
      .forEach((b) => islem.appendChild(b));
    satir.appendChild(islem);
    return satir;
  }

  async function eserListesiYenile() {
    const kap = $('eser-listesi');
    if (!kap) return;
    let kayitlar;
    try {
      kayitlar = await dbIslem('readonly', (s) => s.getAll());
    } catch (e) {
      kap.textContent = 'Kütüphane açılamadı: ' + hataYazi(e);
      return;
    }
    kayitlar = kayitlar || [];
    kayitlar.sort((a, b) => b.eklenme - a.eklenme);
    $('kut-sayi').textContent = String(kayitlar.length);
    const yedekYazisi = sonYedekOku();
    $('kut-yedek').textContent = yedekYazisi;
    kap.replaceChildren();
    if (kayitlar.length === 0) {
      kap.appendChild(eleman('p', 'ipucu', 'Henüz eser eklemedin.'));
      return;
    }
    kayitlar.forEach((k) => kap.appendChild(eserSatiri(k)));
  }

  /* ---------- YEDEKLEME VE GERİ YÜKLEME ---------- */

  function dosyaIndir(blob, ad) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = ad;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // Biçim: IMZA (11 bayt) + başlık uzunluğu (4 bayt) + başlık (JSON) + dosyalar art arda
  function yedekOlustur(kayitlar) {
    const baslik = {
      surum: 1,
      uygulama: 'Piyano Hoca',
      olusturma: Date.now(),
      eserler: kayitlar.map((k) => ({
        id: k.id,
        ad: k.ad,
        tur: k.tur,
        mime: k.mime,
        sayfa: k.sayfa,
        boyut: k.blob.size,
        eklenme: k.eklenme,
        notaSayisi: k.notaSayisi,
        olcuSayisi: k.olcuSayisi,
        tempo: k.tempo
      }))
    };
    const kodla = new TextEncoder();
    const baslikBayt = kodla.encode(JSON.stringify(baslik));
    const imza = kodla.encode(YEDEK_IMZA);
    const on = new Uint8Array(imza.length + 4);
    on.set(imza, 0);
    new DataView(on.buffer).setUint32(imza.length, baslikBayt.length, true);
    return new Blob([on, baslikBayt].concat(kayitlar.map((k) => k.blob)), {
      type: 'application/octet-stream'
    });
  }

  async function yedekOku(dosya) {
    const imzaUz = YEDEK_IMZA.length;
    if (dosya.size < imzaUz + 4) throw new Error('Bu bir Piyano Hoca yedek dosyası değil');
    const bas = await dosya.slice(0, imzaUz + 4).arrayBuffer();
    const imza = new TextDecoder().decode(bas.slice(0, imzaUz));
    if (imza !== YEDEK_IMZA) throw new Error('Bu bir Piyano Hoca yedek dosyası değil');
    const baslikUz = new DataView(bas).getUint32(imzaUz, true);
    if (baslikUz < 2 || baslikUz > 10 * 1024 * 1024 || imzaUz + 4 + baslikUz > dosya.size) {
      throw new Error('Yedek dosyası bozuk (başlık okunamadı)');
    }
    const baslikBuf = await dosya.slice(imzaUz + 4, imzaUz + 4 + baslikUz).arrayBuffer();
    let baslik;
    try {
      baslik = JSON.parse(new TextDecoder().decode(baslikBuf));
    } catch (e) {
      throw new Error('Yedek dosyası bozuk (başlık geçersiz)');
    }
    if (!baslik || !Array.isArray(baslik.eserler)) throw new Error('Yedek dosyası bozuk');
    if (baslik.surum > 1) {
      throw new Error('Bu yedek daha yeni bir sürümle alınmış. Önce uygulamayı güncelle');
    }

    let ofset = imzaUz + 4 + baslikUz;
    const ogeler = [];
    for (const m of baslik.eserler) {
      const gecerli =
        m && typeof m.id === 'string' && m.id.length > 0 && m.id.length < 80 &&
        typeof m.ad === 'string' &&
        (m.tur === 'pdf' || m.tur === 'resim' || m.tur === 'nota') &&
        (m.mime === 'application/pdf' || m.mime === 'image/jpeg' || m.mime === 'image/png' ||
          m.mime === 'application/json') &&
        Number.isInteger(m.boyut) && m.boyut > 0 && m.boyut <= MAKS_BOYUT;
      if (!gecerli) throw new Error('Yedek dosyası bozuk (eser bilgisi geçersiz)');
      if (ofset + m.boyut > dosya.size) throw new Error('Yedek dosyası eksik ya da yarım indirilmiş');
      ogeler.push({
        meta: {
          id: m.id,
          ad: m.ad.slice(0, 120) || 'Adsız',
          tur: m.tur,
          mime: m.mime,
          sayfa: Number.isInteger(m.sayfa) && m.sayfa >= 1 && m.sayfa <= 5000 ? m.sayfa : 1,
          boyut: m.boyut,
          eklenme: Number.isFinite(m.eklenme) ? m.eklenme : Date.now(),
          notaSayisi: Number.isInteger(m.notaSayisi) ? m.notaSayisi : undefined,
          olcuSayisi: Number.isInteger(m.olcuSayisi) ? m.olcuSayisi : undefined,
          tempo: Number.isFinite(m.tempo) ? m.tempo : undefined
        },
        blob: dosya.slice(ofset, ofset + m.boyut, m.mime)
      });
      ofset += m.boyut;
    }
    return ogeler;
  }

  function yedekKur() {
    $('btn-yedek-al').addEventListener('click', async () => {
      try {
        const kayitlar = await dbIslem('readonly', (s) => s.getAll());
        if (!kayitlar || kayitlar.length === 0) {
          yedekMesaj('Yedeklenecek eser yok.');
          return;
        }
        kayitlar.sort((a, b) => a.eklenme - b.eklenme);
        const d = new Date();
        const gun =
          d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
          String(d.getDate()).padStart(2, '0');
        const blob = yedekOlustur(kayitlar);
        dosyaIndir(blob, 'piyano-hoca-yedek-' + gun + '.piyanohoca');
        sonYedekYaz();
        $('kut-yedek').textContent = sonYedekOku();
        yedekMesaj(
          kayitlar.length + ' eser yedeklendi (' + boyutYaz(blob.size) +
          '). Dosya İndirilenler klasörüne iner. Bulutta ya da başka bir yerde de sakla.'
        );
      } catch (e) {
        yedekMesaj('Yedek alınamadı: ' + hataYazi(e));
      }
    });

    const girdi = $('yedek-sec');
    $('btn-yedek-yukle').addEventListener('click', () => girdi.click());
    girdi.addEventListener('change', async () => {
      const dosya = girdi.files && girdi.files[0];
      girdi.value = '';
      if (!dosya) return;
      yedekMesaj('Yedek dosyası okunuyor…');
      try {
        const ogeler = await yedekOku(dosya);
        let eklenen = 0;
        let atlanan = 0;
        for (const o of ogeler) {
          const var_ = await dbIslem('readonly', (s) => s.get(o.meta.id));
          if (var_) {
            atlanan++;
            continue;
          }
          await dbIslem('readwrite', (s) =>
            s.put({
              id: o.meta.id,
              surum: 1,
              ad: o.meta.ad,
              tur: o.meta.tur,
              mime: o.meta.mime,
              sayfa: o.meta.sayfa,
              boyut: o.meta.boyut,
              eklenme: o.meta.eklenme,
              notaSayisi: o.meta.notaSayisi,
              olcuSayisi: o.meta.olcuSayisi,
              tempo: o.meta.tempo,
              blob: o.blob
            })
          );
          eklenen++;
        }
        let ozet = eklenen + ' eser geri yüklendi.';
        if (atlanan) ozet += ' ' + atlanan + ' eser zaten kütüphanede olduğu için atlandı.';
        yedekMesaj(ozet);
        await eserListesiYenile();
      } catch (e) {
        if (e && e.name === 'QuotaExceededError') {
          yedekMesaj('Geri yüklenemedi: cihazda yeterli yer yok.');
        } else {
          yedekMesaj('Geri yüklenemedi: ' + hataYazi(e));
        }
        await eserListesiYenile();
      }
    });
  }

  /* ---------- GÖRÜNTÜLEYİCİ ---------- */

  const G = {
    acik: false,
    kayit: null,
    pdf: null,
    resim: null,
    url: null,
    sayfa: 1,
    toplam: 1,
    oran: 1,
    mod: 'genislik', // 'genislik' | 'sayfa'
    cizimNo: 0,
    gorev: null
  };

  const ORAN_MIN = 0.4;
  const ORAN_MAKS = 5;

  function mesajElemani(yazi) {
    return eleman('div', 'gor-mesaj', yazi);
  }

  function gorunumKapat() {
    G.cizimNo++;
    if (G.gorev) {
      try { G.gorev.cancel(); } catch (e) {}
    }
    if (G.pdf) {
      try { G.pdf.destroy(); } catch (e) {}
    }
    if (G.url) URL.revokeObjectURL(G.url);
    G.gorev = null;
    G.pdf = null;
    G.url = null;
    G.resim = null;
    G.kayit = null;
    G.acik = false;
    const g = $('gorunum');
    if (g) g.hidden = true;
    const alan = $('gor-alan');
    if (alan) alan.replaceChildren();
  }

  function gorunumEtiketleri() {
    $('gor-sayfa').textContent = G.sayfa + ' / ' + G.toplam;
    $('gor-yakinlik').textContent = '%' + Math.round(G.oran * 100);
    $('gor-onceki').disabled = G.sayfa <= 1;
    $('gor-sonraki').disabled = G.sayfa >= G.toplam;
    $('gor-uzak').disabled = G.oran <= ORAN_MIN + 1e-6;
    $('gor-yakin').disabled = G.oran >= ORAN_MAKS - 1e-6;
    $('gor-genislik').classList.toggle('secili', G.mod === 'genislik');
    $('gor-sigdir').classList.toggle('secili', G.mod === 'sayfa');
  }

  async function gorunumCiz(koru) {
    if (!G.acik || !G.kayit) return;
    const alan = $('gor-alan');
    const sira = ++G.cizimNo;
    gorunumEtiketleri();

    let oranX = 0;
    let oranY = 0;
    if (koru && alan.scrollWidth > 0 && alan.scrollHeight > 0) {
      oranX = (alan.scrollLeft + alan.clientWidth / 2) / alan.scrollWidth;
      oranY = (alan.scrollTop + alan.clientHeight / 2) / alan.scrollHeight;
    }
    const konumuGeriKoy = () => {
      if (koru) {
        alan.scrollLeft = Math.max(oranX * alan.scrollWidth - alan.clientWidth / 2, 0);
        alan.scrollTop = Math.max(oranY * alan.scrollHeight - alan.clientHeight / 2, 0);
      } else {
        alan.scrollLeft = 0;
        alan.scrollTop = 0;
      }
    };

    const gen = Math.max(alan.clientWidth - 16, 50);
    const yuk = Math.max(alan.clientHeight - 16, 50);

    if (G.kayit.tur === 'resim') {
      const nw = G.resim.naturalWidth;
      const nh = G.resim.naturalHeight;
      const taban = G.mod === 'sayfa' ? Math.min(gen / nw, yuk / nh) : gen / nw;
      const img = document.createElement('img');
      img.alt = G.kayit.ad;
      img.src = G.url;
      img.style.width = Math.round(nw * taban * G.oran) + 'px';
      img.style.height = 'auto';
      alan.replaceChildren(img);
      konumuGeriKoy();
      return;
    }

    // PDF
    if (G.gorev) {
      try { G.gorev.cancel(); } catch (e) {}
      G.gorev = null;
    }
    let sayfa;
    try {
      sayfa = await G.pdf.getPage(G.sayfa);
    } catch (e) {
      if (sira === G.cizimNo) alan.replaceChildren(mesajElemani('Sayfa açılamadı: ' + hataYazi(e)));
      return;
    }
    if (sira !== G.cizimNo) return;

    const v1 = sayfa.getViewport({ scale: 1 });
    const taban = G.mod === 'sayfa' ? Math.min(gen / v1.width, yuk / v1.height) : gen / v1.width;
    const olcek = Math.max(taban * G.oran, 0.05);
    const v = sayfa.getViewport({ scale: olcek });

    let cikis = Math.min(window.devicePixelRatio || 1, 2);
    const SINIR = 16e6; // en fazla 16 milyon piksel (bellek koruması)
    if (v.width * v.height * cikis * cikis > SINIR) {
      cikis = Math.sqrt(SINIR / (v.width * v.height));
    }

    const tuval = document.createElement('canvas');
    tuval.width = Math.max(Math.floor(v.width * cikis), 1);
    tuval.height = Math.max(Math.floor(v.height * cikis), 1);
    tuval.style.width = Math.floor(v.width) + 'px';
    tuval.style.height = Math.floor(v.height) + 'px';
    const c2 = tuval.getContext('2d');
    c2.fillStyle = '#ffffff';
    c2.fillRect(0, 0, tuval.width, tuval.height);

    const gorev = sayfa.render({
      canvasContext: c2,
      viewport: v,
      transform: cikis !== 1 ? [cikis, 0, 0, cikis, 0, 0] : null
    });
    G.gorev = gorev;
    try {
      await gorev.promise;
    } catch (e) {
      if (e && e.name === 'RenderingCancelledException') return;
      if (sira === G.cizimNo) alan.replaceChildren(mesajElemani('Sayfa çizilemedi: ' + hataYazi(e)));
      return;
    }
    if (sira !== G.cizimNo) return;
    G.gorev = null;
    alan.replaceChildren(tuval);
    konumuGeriKoy();
  }

  async function gorunumAc(id) {
    let kayit;
    try {
      kayit = await dbIslem('readonly', (s) => s.get(id));
    } catch (e) {
      kutMesaj('Eser açılamadı: ' + hataYazi(e));
      return;
    }
    if (!kayit) {
      kutMesaj('Eser bulunamadı.');
      return;
    }

    gorunumKapat();
    G.kayit = kayit;
    G.acik = true;
    G.sayfa = 1;
    G.toplam = kayit.sayfa || 1;
    G.oran = 1;
    G.mod = 'genislik';
    $('gorunum').hidden = false;
    $('gor-baslik').textContent = kayit.ad;
    $('gor-sayfa-grup').hidden = kayit.tur !== 'pdf';
    $('gor-alan').replaceChildren(mesajElemani('Açılıyor…'));
    gorunumEtiketleri();

    try {
      if (kayit.tur === 'pdf') {
        await pdfHazirla();
        const veri = await kayit.blob.arrayBuffer();
        if (!G.acik || G.kayit !== kayit) return;
        const doc = await pdfKutu().getDocument({ data: veri }).promise;
        if (!G.acik || G.kayit !== kayit) {
          try { doc.destroy(); } catch (e) {}
          return;
        }
        G.pdf = doc;
        G.toplam = doc.numPages;
      } else {
        const url = URL.createObjectURL(kayit.blob);
        G.url = url;
        G.resim = await resimYukle(url);
        if (!G.acik || G.kayit !== kayit) return;
      }
      await gorunumCiz(false);
    } catch (e) {
      if (G.acik && G.kayit === kayit) {
        $('gor-alan').replaceChildren(mesajElemani('Eser açılamadı: ' + hataYazi(e)));
      }
    }
  }

  function gorunumKur() {
    $('gor-geri').addEventListener('click', gorunumKapat);

    $('gor-onceki').addEventListener('click', () => {
      if (G.sayfa > 1) {
        G.sayfa--;
        gorunumCiz(false);
      }
    });
    $('gor-sonraki').addEventListener('click', () => {
      if (G.sayfa < G.toplam) {
        G.sayfa++;
        gorunumCiz(false);
      }
    });

    $('gor-yakin').addEventListener('click', () => {
      G.oran = Math.min(G.oran * 1.25, ORAN_MAKS);
      gorunumCiz(true);
    });
    $('gor-uzak').addEventListener('click', () => {
      G.oran = Math.max(G.oran / 1.25, ORAN_MIN);
      gorunumCiz(true);
    });
    $('gor-genislik').addEventListener('click', () => {
      G.mod = 'genislik';
      G.oran = 1;
      gorunumCiz(false);
    });
    $('gor-sigdir').addEventListener('click', () => {
      G.mod = 'sayfa';
      G.oran = 1;
      gorunumCiz(false);
    });

    let yenidenBoyutla = null;
    window.addEventListener('resize', () => {
      if (!G.acik) return;
      clearTimeout(yenidenBoyutla);
      yenidenBoyutla = setTimeout(() => gorunumCiz(true), 250);
    });
  }

  /* ---------- BAŞLAT ---------- */

  function bosEserKur() {
    $('btn-bos-eser').addEventListener('click', async () => {
      const ad = prompt('Yeni eserin adı:', 'Yeni eser');
      if (ad === null) return;
      const olcuYazi = prompt('Ölçü (örnek: 4/4, 3/4, 6/8):', '4/4');
      if (olcuYazi === null) return;
      const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(olcuYazi);
      if (!m || [2, 3, 4, 5, 6, 7, 9, 12].indexOf(Number(m[1])) < 0 || [2, 4, 8, 16].indexOf(Number(m[2])) < 0) {
        kutMesaj('Ölçü geçersiz. Örnek: 4/4, 3/4, 2/4, 6/8, 12/8');
        return;
      }
      const tempoYazi = prompt('Tempo (♩ = dakikadaki vuruş sayısı):', '90');
      if (tempoYazi === null) return;
      const tempo = Number(tempoYazi);
      if (!(tempo >= 25 && tempo <= 300)) {
        kutMesaj('Tempo 25 ile 300 arasında olmalı.');
        return;
      }
      const sayiYazi = prompt('Kaç ölçü olsun? (sonradan eklenebilir)', '8');
      if (sayiYazi === null) return;
      const sayi = parseInt(sayiYazi, 10);
      if (!(sayi >= 1 && sayi <= 200)) {
        kutMesaj('Ölçü sayısı 1 ile 200 arasında olmalı.');
        return;
      }
      try {
        const eser = window.NOTA_IC.bosEser(ad.trim().slice(0, 120) || 'Yeni eser', Number(m[1]), Number(m[2]), tempo, sayi);
        const id = await notaKayitOlustur(eser);
        await eserListesiYenile();
        kutMesaj('"' + eser.baslik + '" oluşturuldu. Çal sekmesinde ✏ Düzenle ile notaları ekle.');
        if (window.eserAc) window.eserAc(eser, id);
      } catch (e) {
        kutMesaj('Eser oluşturulamadı: ' + hataYazi(e));
      }
    });
  }

  function kutuphaneBaslat() {
    eserEkleKur();
    bosEserKur();
    yedekKur();
    pdfKartiKur();
    gorunumKur();
    eserListesiYenile();
  }

  window.kutuphaneBaslat = kutuphaneBaslat;
  window.notaKayitOlustur = notaKayitOlustur;
  window.notaKaydet = notaKaydet;
  window.eserListesiYenile = eserListesiYenile;
  window.pdfKartiYenile = pdfKartiYenile;
  window.KUT = {
    pdfHazirla: pdfHazirla,
    pdfKutu: pdfKutu,
    notaKayitOlustur: notaKayitOlustur,
    notaAc: notaAc,
    eserListesiYenile: eserListesiYenile
  };
})();
