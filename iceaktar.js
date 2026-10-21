/*
  İÇE AKTARMA (Aşama 9): MusicXML (.musicxml, .xml, .mxl) ve MIDI (.mid, .midi) dosyalarını
  çalınabilir eser nesnesine çevirir (eser.js'teki veri modeli).
  Her şey bir kapsülün içinde tutulur; dışarıya yalnızca window.NOTA_IC verilir.

  Sınırlar (dürüstçe):
  - İki el vardır: sağ (sol anahtarı) ve sol (fa anahtarı). Diğer sesler bu ikisine paylaştırılır.
  - Tekrar işaretleri, volta, süslemeler, pedal, nüans ve ölçü değişimleri uygulanmaz.
  - Bemoller porte üzerinde diyez olarak gösterilir (çalınan ses doğrudur).
*/

(function () {
  'use strict';

  const ILK_MIDI = 21;
  const SON_MIDI = 108;
  const MAKS_NOTA = 3000;
  const MAKS_DOSYA = 20 * 1024 * 1024;
  const UZANTILAR = ['musicxml', 'xml', 'mxl', 'mid', 'midi'];
  const ADIM_YARIM = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function yuvarla(v) {
    return Math.round(v * 960) / 960;
  }

  function kisitla(v, en, buyuk) {
    return Math.min(Math.max(v, en), buyuk);
  }

  /* ---------- ORTAK: ESER NESNESİ KURMA ---------- */

  // ham: [{ el, midi, baslangic, sure }] (vuruş cinsinden). Kimlikleri ve sıralamayı kurar.
  function eserYap(baslik, besteci, pay, payda, tempo, ham, enAzOlcu) {
    const ov = (pay * 4) / payda;
    const liste = ham
      .filter((n) => n.midi >= ILK_MIDI && n.midi <= SON_MIDI && n.sure > 0 && n.baslangic >= 0)
      .sort((a, b) => a.baslangic - b.baslangic || a.midi - b.midi);
    let son = 0;
    const sayac = { sag: 0, sol: 0 };
    const notalar = liste.map((n) => {
      const bas = yuvarla(n.baslangic);
      const sure = Math.max(yuvarla(n.sure), 0.0625);
      if (bas + sure > son) son = bas + sure;
      return { id: n.el + '-' + sayac[n.el]++, el: n.el, midi: n.midi, baslangic: bas, sure: sure };
    });
    const olcuSayisi = Math.max(Math.ceil(son / ov - 1e-6), enAzOlcu || 1, 1);
    return {
      surum: 1,
      id: 'nota-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      baslik: baslik,
      besteci: besteci || '',
      olcu: { pay: pay, payda: payda },
      tempo: Math.round(kisitla(tempo, 25, 300)),
      olcuSayisi: olcuSayisi,
      notalar: notalar
    };
  }

  function bosEser(baslik, pay, payda, tempo, olcuSayisi) {
    return eserYap(baslik, '', pay, payda, tempo, [], olcuSayisi);
  }

  // Kayıtlı bir eser nesnesinin geçerli olup olmadığını denetler (bozuk dosyaya karşı)
  function dogrula(e) {
    if (!e || typeof e !== 'object') throw new Error('Eser verisi bozuk');
    const gecerliSayi = (v, en, buyuk) => typeof v === 'number' && isFinite(v) && v >= en && v <= buyuk;
    if (!e.olcu || ![2, 3, 4, 5, 6, 7, 9, 12].includes(e.olcu.pay) ||
        ![2, 4, 8, 16].includes(e.olcu.payda)) throw new Error('Ölçü bilgisi geçersiz');
    if (!gecerliSayi(e.tempo, 20, 400)) throw new Error('Tempo geçersiz');
    if (!Number.isInteger(e.olcuSayisi) || e.olcuSayisi < 1 || e.olcuSayisi > 2000) {
      throw new Error('Ölçü sayısı geçersiz');
    }
    if (!Array.isArray(e.notalar) || e.notalar.length > MAKS_NOTA + 2000) throw new Error('Nota listesi geçersiz');
    const idler = new Set();
    e.notalar.forEach((n) => {
      const iyi = n && typeof n.id === 'string' && (n.el === 'sag' || n.el === 'sol') &&
        Number.isInteger(n.midi) && n.midi >= ILK_MIDI && n.midi <= SON_MIDI &&
        gecerliSayi(n.baslangic, 0, 100000) && gecerliSayi(n.sure, 0.01, 1000) && !idler.has(n.id);
      if (!iyi) throw new Error('Notalardan biri geçersiz');
      idler.add(n.id);
    });
    e.baslik = typeof e.baslik === 'string' ? e.baslik.slice(0, 120) : 'Adsız';
    e.besteci = typeof e.besteci === 'string' ? e.besteci.slice(0, 120) : '';
    return e;
  }

  /* ---------- MUSICXML ---------- */

  function cocuk(el, ad) {
    for (let i = 0; i < el.children.length; i++) {
      if (el.children[i].nodeName === ad) return el.children[i];
    }
    return null;
  }

  function cocuklar(el, ad) {
    const s = [];
    for (let i = 0; i < el.children.length; i++) {
      if (el.children[i].nodeName === ad) s.push(el.children[i]);
    }
    return s;
  }

  function metin(el, ad) {
    const c = el ? cocuk(el, ad) : null;
    return c ? (c.textContent || '').trim() : '';
  }

  function vurusSayisi(yazi) {
    // "3" ya da "3+2" gibi
    const parcalar = String(yazi).split('+').map((p) => parseFloat(p));
    if (parcalar.some((p) => !isFinite(p) || p <= 0)) return 0;
    return parcalar.reduce((a, b) => a + b, 0);
  }

  function birimVurus(birim, nokta) {
    const t = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 };
    if (!t[birim]) return 0;
    return t[birim] * (nokta ? 1.5 : 1);
  }

  function xmlEser(yazi, dosyaAdi, uyari) {
    const doc = new DOMParser().parseFromString(yazi, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('XML okunamadı (dosya bozuk ya da MusicXML değil)');
    }
    const kok = doc.documentElement;
    if (kok.nodeName === 'score-timewise') {
      throw new Error('"score-timewise" biçimi desteklenmiyor. MuseScore ile tekrar dışa aktar');
    }
    if (kok.nodeName !== 'score-partwise') throw new Error('Bu bir MusicXML müzik dosyası değil');

    const baslikEl = cocuk(kok, 'work');
    const baslik = metin(baslikEl, 'work-title') || metin(kok, 'movement-title') || dosyaAdi;
    let besteci = '';
    const kimlik = cocuk(kok, 'identification');
    if (kimlik) {
      cocuklar(kimlik, 'creator').forEach((c) => {
        if (c.getAttribute('type') === 'composer' && !besteci) besteci = (c.textContent || '').trim();
      });
    }

    const bolumler = cocuklar(kok, 'part');
    if (bolumler.length === 0) throw new Error('Dosyada müzik bölümü bulunamadı');

    let tempo = 0;
    const zamanlar = {};   // ölçü indisi -> { beats, type }
    let tekrarVar = false;
    let birinciOlcuUzunlugu = 0;
    const akislar = {};    // "bolum|portre" -> { anahtar: ..., notalar: [], anahtarIsareti }
    const olcuUzunluklari = []; // [ölçü indisi] -> en uzun varılan vuruş (tüm bölümler)
    const olcuSayilari = [];
    let ilkOlcuImplicit = false;
    let atlananSes = 0;

    bolumler.forEach((bolum, bi) => {
      let bolme = 1;
      const acikBag = {};
      const olcuEls = cocuklar(bolum, 'measure');
      olcuSayilari.push(olcuEls.length);
      olcuEls.forEach((olcu, m) => {
        let pos = 0;
        let ulasilan = 0;
        let sonBaslangic = 0;
        if (bi === 0 && m === 0) {
          ilkOlcuImplicit = olcu.getAttribute('implicit') === 'yes' || olcu.getAttribute('number') === '0';
        }
        for (let i = 0; i < olcu.children.length; i++) {
          const e = olcu.children[i];
          const ad = e.nodeName;
          if (ad === 'attributes') {
            const d = parseFloat(metin(e, 'divisions'));
            if (d > 0) bolme = d;
            const z = cocuk(e, 'time');
            if (z) {
              const b = vurusSayisi(metin(z, 'beats'));
              const t = parseInt(metin(z, 'beat-type'), 10);
              if (b > 0 && [1, 2, 4, 8, 16].includes(t)) zamanlar[m] = { beats: b, type: t };
            }
            cocuklar(e, 'clef').forEach((c) => {
              const no = c.getAttribute('number') || '1';
              const anahtar = bi + '|' + no;
              if (!akislar[anahtar]) akislar[anahtar] = { notalar: [], isaret: '' };
              if (!akislar[anahtar].isaret) akislar[anahtar].isaret = metin(c, 'sign');
            });
          } else if (ad === 'direction') {
            if (!tempo) {
              const ses = e.getElementsByTagName('sound')[0];
              const ta = ses ? parseFloat(ses.getAttribute('tempo')) : 0;
              if (ta > 0) {
                tempo = ta;
              } else {
                const met = e.getElementsByTagName('metronome')[0];
                if (met) {
                  const dk = parseFloat(metin(met, 'per-minute'));
                  const bv = birimVurus(metin(met, 'beat-unit'), !!cocuk(met, 'beat-unit-dot'));
                  if (dk > 0 && bv > 0) tempo = dk * bv;
                }
              }
            }
          } else if (ad === 'sound') {
            const ta = parseFloat(e.getAttribute('tempo'));
            if (!tempo && ta > 0) tempo = ta;
          } else if (ad === 'barline') {
            if (cocuk(e, 'repeat')) tekrarVar = true;
          } else if (ad === 'backup') {
            pos -= parseFloat(metin(e, 'duration')) || 0;
            if (pos < 0) pos = 0;
          } else if (ad === 'forward') {
            pos += parseFloat(metin(e, 'duration')) || 0;
            ulasilan = Math.max(ulasilan, pos);
          } else if (ad === 'note') {
            const sure = parseFloat(metin(e, 'duration'));
            const sureVurus = sure > 0 ? sure / bolme : 0;
            const akor = !!cocuk(e, 'chord');
            const baslangicPos = akor ? sonBaslangic : pos;
            const gorev = !!cocuk(e, 'grace') || !!cocuk(e, 'cue');
            const seslik = cocuk(e, 'pitch');

            if (!akor && !cocuk(e, 'grace')) sonBaslangic = pos;
            if (seslik && !gorev && sureVurus > 0) {
              const adim = ADIM_YARIM[metin(seslik, 'step')];
              const oktav = parseInt(metin(seslik, 'octave'), 10);
              const degisim = parseFloat(metin(seslik, 'alter')) || 0;
              if (adim !== undefined && isFinite(oktav)) {
                const midi = 12 * (oktav + 1) + adim + Math.round(degisim);
                const portre = metin(e, 'staff') || '1';
                const anahtar = bi + '|' + portre;
                if (!akislar[anahtar]) akislar[anahtar] = { notalar: [], isaret: '' };
                const baglar = cocuklar(e, 'tie').map((t) => t.getAttribute('type'));
                const bagAnahtar = anahtar + '|' + midi;
                const bagSon = baglar.indexOf('stop') >= 0;
                const bagBas = baglar.indexOf('start') >= 0;
                if (bagSon && acikBag[bagAnahtar]) {
                  acikBag[bagAnahtar].sure += sureVurus;
                  if (!bagBas) delete acikBag[bagAnahtar];
                } else {
                  const nota = { m: m, p: baslangicPos / bolme, sure: sureVurus, midi: midi };
                  akislar[anahtar].notalar.push(nota);
                  if (bagBas) acikBag[bagAnahtar] = nota;
                }
              }
            } else if (!gorev && !cocuk(e, 'rest') && !seslik) {
              atlananSes++; // vurmalı çalgı vb.
            }
            if (!akor && !cocuk(e, 'grace')) {
              pos += sure > 0 ? sure : 0;
              ulasilan = Math.max(ulasilan, pos);
            }
          }
        }
        const uzunluk = ulasilan / bolme;
        if (olcuUzunluklari[m] === undefined || uzunluk > olcuUzunluklari[m]) olcuUzunluklari[m] = uzunluk;
        if (bi === 0 && m === 0) {
          birinciOlcuUzunlugu = uzunluk;
        }
      });
    });

    const olcuSayisiToplam = Math.max.apply(null, olcuSayilari);
    const ilkZaman = zamanlar[0] || { beats: 4, type: 4 };
    const ts = [];
    for (let m = 0; m < olcuSayisiToplam; m++) {
      if (zamanlar[m]) ts.push(zamanlar[m].beats + '/' + zamanlar[m].type);
    }
    const farkliZaman = ts.filter((x, i, arr) => arr.indexOf(x) === i);
    if (farkliZaman.length > 1) {
      uyari.push('Ölçü değişimi bulundu (' + farkliZaman.join(', ') + '). Zamanlama doğru, ama porte çizgileri ilk ölçüye göre çizilir.');
    }
    let payG = ilkZaman.beats;
    let paydaG = ilkZaman.type;
    if (!Number.isInteger(payG) || ![2, 3, 4, 5, 6, 7, 9, 12].includes(payG) || ![2, 4, 8, 16].includes(paydaG)) {
      uyari.push('Alışılmadık ölçü (' + ilkZaman.beats + '/' + ilkZaman.type + ') 4/4 olarak gösterildi.');
      payG = 4;
      paydaG = 4;
    }
    const paydaSon = paydaG;

    function nominal(m) {
      let z = ilkZaman;
      for (let k = m; k >= 0; k--) {
        if (zamanlar[k]) { z = zamanlar[k]; break; }
      }
      return (z.beats * 4) / z.type;
    }

    // Geri ölçüm payı: ilk ölçü eksikse (anakruz) sona doğru kaydır
    let kaydirma = 0;
    const nom0 = nominal(0);
    if (ilkOlcuImplicit && birinciOlcuUzunlugu > 0 && birinciOlcuUzunlugu < nom0 - 0.01) {
      kaydirma = nom0 - birinciOlcuUzunlugu;
    }

    const baslangiclar = [];
    let t = 0;
    for (let m = 0; m < olcuSayisiToplam; m++) {
      baslangiclar[m] = t;
      let uz = Math.max(nominal(m), olcuUzunluklari[m] || 0);
      if (m === 0 && kaydirma > 0) uz = nom0;
      t += uz;
    }

    // Akışları ellere dağıt
    const liste = Object.keys(akislar).map((k) => {
      const a = akislar[k];
      const ort = a.notalar.length ? a.notalar.reduce((s, n) => s + n.midi, 0) / a.notalar.length : 60;
      let el = ort >= 60 ? 'sag' : 'sol';
      if (a.isaret === 'F') el = 'sol';
      else if (a.isaret === 'G') el = 'sag';
      return { anahtar: k, a: a, ort: ort, el: el };
    }).filter((x) => x.a.notalar.length > 0);

    if (liste.length === 0) throw new Error('Dosyada çalınabilir nota bulunamadı');
    if (liste.length >= 2 && liste.every((x) => x.el === liste[0].el)) {
      liste.sort((x, y) => y.ort - x.ort);
      const yarim = Math.ceil(liste.length / 2);
      liste.forEach((x, i) => { x.el = i < yarim ? 'sag' : 'sol'; });
      uyari.push('Bölümlerin hepsi aynı anahtarda; yüksek sesler sağ ele, alçaklar sol ele paylaştırıldı.');
    }
    if (liste.length > 2) {
      uyari.push(liste.length + ' ayrı bölüm bulundu; hepsi iki ele paylaştırıldı.');
    }

    const ham = [];
    let disarida = 0;
    liste.forEach((x) => {
      x.a.notalar.forEach((n) => {
        if (n.midi < ILK_MIDI || n.midi > SON_MIDI) { disarida++; return; }
        ham.push({
          el: x.el,
          midi: n.midi,
          baslangic: baslangiclar[n.m] + n.p + (n.m === 0 ? kaydirma : 0),
          sure: n.sure
        });
      });
    });
    if (ham.length > MAKS_NOTA) {
      throw new Error('Eser çok büyük (' + ham.length + ' nota). En fazla ' + MAKS_NOTA + ' nota desteklenir');
    }
    if (disarida) uyari.push(disarida + ' nota piyano sınırları dışında olduğu için atlandı.');
    if (atlananSes) uyari.push('Vurmalı çalgı notaları atlandı.');
    if (tekrarVar) uyari.push('Tekrar işaretleri açılmadı; eser bir kez baştan sona çalınır.');
    if (kaydirma > 0) uyari.push('Anakruz (eksik ilk ölçü) tam ölçünün sonuna yerleştirildi.');

    if (!tempo) {
      tempo = 100;
      uyari.push('Dosyada tempo yoktu, ♩ = 100 kullanıldı. Tempoyu kaydırıcıdan değiştirebilirsin.');
    }
    const e = eserYap(baslik, besteci, payG, paydaSon, tempo, ham, olcuSayisiToplam);
    return e;
  }

  /* ---------- MXL (SIKIŞTIRILMIŞ MUSICXML) ---------- */

  async function zipOku(tampon) {
    const u8 = new Uint8Array(tampon);
    const dv = new DataView(tampon);
    let son = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { son = i; break; }
    }
    if (son < 0) throw new Error('Geçerli bir .mxl (zip) dosyası değil');
    const sayi = dv.getUint16(son + 10, true);
    let p = dv.getUint32(son + 16, true);
    const girdiler = {};
    for (let i = 0; i < sayi; i++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) break;
      const yontem = dv.getUint16(p + 10, true);
      const sikis = dv.getUint32(p + 20, true);
      const acik = dv.getUint32(p + 24, true);
      const ad = dv.getUint16(p + 28, true);
      const ek = dv.getUint16(p + 30, true);
      const yorum = dv.getUint16(p + 32, true);
      const yer = dv.getUint32(p + 42, true);
      const adi = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + ad));
      girdiler[adi] = { yontem: yontem, sikis: sikis, acik: acik, yer: yer };
      p += 46 + ad + ek + yorum;
    }
    async function oku(adi) {
      const g = girdiler[adi];
      if (!g) return null;
      if (g.acik > 60 * 1024 * 1024) throw new Error('Zip içindeki dosya çok büyük');
      const ad = dv.getUint16(g.yer + 26, true);
      const ek = dv.getUint16(g.yer + 28, true);
      const bas = g.yer + 30 + ad + ek;
      const ham = u8.subarray(bas, bas + g.sikis);
      if (g.yontem === 0) return ham;
      if (g.yontem !== 8) throw new Error('Desteklenmeyen zip sıkıştırması');
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('Bu tarayıcı .mxl açamıyor. MuseScore\'da ".musicxml" olarak dışa aktar');
      }
      const akis = new Response(new Blob([ham]).stream().pipeThrough(new DecompressionStream('deflate-raw')));
      return new Uint8Array(await akis.arrayBuffer());
    }
    return { adlar: Object.keys(girdiler), oku: oku };
  }

  async function mxlEser(tampon, dosyaAdi, uyari) {
    const zip = await zipOku(tampon);
    let yol = null;
    const kap = await zip.oku('META-INF/container.xml');
    if (kap) {
      const d = new DOMParser().parseFromString(new TextDecoder().decode(kap), 'application/xml');
      const kk = d.getElementsByTagName('rootfile')[0];
      if (kk) yol = kk.getAttribute('full-path');
    }
    if (!yol || zip.adlar.indexOf(yol) < 0) {
      yol = zip.adlar.find((a) => /\.(musicxml|xml)$/i.test(a) && a.indexOf('META-INF/') !== 0) || null;
    }
    if (!yol) throw new Error('.mxl içinde müzik dosyası bulunamadı');
    const veri = await zip.oku(yol);
    return xmlEser(new TextDecoder().decode(veri), dosyaAdi, uyari);
  }

  /* ---------- MIDI ---------- */

  function midiEser(tampon, dosyaAdi, uyari) {
    const u8 = new Uint8Array(tampon);
    const dv = new DataView(tampon);
    const yaziAl = (bas, uz) => String.fromCharCode.apply(null, u8.subarray(bas, bas + uz));
    if (u8.length < 14 || yaziAl(0, 4) !== 'MThd') throw new Error('Bu bir MIDI dosyası değil');
    const baslikUz = dv.getUint32(4);
    const izSayisi = dv.getUint16(10);
    const bolme = dv.getUint16(12);
    if (bolme & 0x8000) throw new Error('SMPTE zamanlı MIDI desteklenmiyor');
    if (bolme === 0) throw new Error('MIDI dosyası bozuk (zaman bölmesi yok)');

    let p = 8 + baslikUz;
    let tempo = 0;
    let pay = 0;
    let payda = 0;
    const akislar = {};
    let tempoDegisimi = 0;

    for (let iz = 0; iz < izSayisi; iz++) {
      if (p + 8 > u8.length || yaziAl(p, 4) !== 'MTrk') break;
      const uz = dv.getUint32(p + 4);
      let q = p + 8;
      const bitis = Math.min(q + uz, u8.length);
      p = q + uz;
      let tik = 0;
      let calisan = 0;
      const acik = {};

      const degisken = () => {
        let v = 0;
        for (let k = 0; k < 4 && q < bitis; k++) {
          const b = u8[q++];
          v = (v << 7) | (b & 0x7f);
          if (!(b & 0x80)) break;
        }
        return v;
      };
      const ekle = (kanal, nota, bas, son) => {
        if (kanal === 9) return; // vurmalı kanal
        const anahtar = iz + '|' + kanal;
        if (!akislar[anahtar]) akislar[anahtar] = [];
        akislar[anahtar].push({ midi: nota, bas: bas / bolme, son: Math.max(son, bas + 1) / bolme });
      };

      while (q < bitis) {
        tik += degisken();
        if (q >= bitis) break;
        let durum;
        const b = u8[q];
        if (b >= 0x80) {
          durum = b;
          q++;
          if (durum < 0xf0) calisan = durum;
        } else {
          durum = calisan;
          if (!durum) throw new Error('MIDI dosyası bozuk');
        }
        if (durum === 0xff) {
          const tur = u8[q++];
          const ml = degisken();
          if (tur === 0x51 && ml === 3) {
            const us = (u8[q] << 16) | (u8[q + 1] << 8) | u8[q + 2];
            if (us > 0) {
              if (!tempo) tempo = 60000000 / us;
              else if (Math.abs(60000000 / us - tempo) > 1) tempoDegisimi++;
            }
          } else if (tur === 0x58 && ml >= 2 && !pay) {
            pay = u8[q];
            payda = Math.pow(2, u8[q + 1]);
          }
          q += ml;
          if (tur === 0x2f) break;
        } else if (durum === 0xf0 || durum === 0xf7) {
          q += degisken();
        } else {
          const komut = durum & 0xf0;
          const kanal = durum & 0x0f;
          if (komut === 0x90 || komut === 0x80) {
            const nota = u8[q];
            const hiz = u8[q + 1];
            q += 2;
            const k = kanal + '|' + nota;
            if (komut === 0x90 && hiz > 0) {
              if (!acik[k]) acik[k] = [];
              acik[k].push(tik);
            } else if (acik[k] && acik[k].length) {
              ekle(kanal, nota, acik[k].shift(), tik);
            }
          } else if (komut === 0xc0 || komut === 0xd0) {
            q += 1;
          } else {
            q += 2;
          }
        }
      }
      // Kapanmamış notaları iz sonunda bitir
      Object.keys(acik).forEach((k) => {
        const ayr = k.split('|');
        acik[k].forEach((bas) => ekle(Number(ayr[0]), Number(ayr[1]), bas, Math.max(tik, bas + bolme)));
      });
    }

    const anahtarlar = Object.keys(akislar).filter((k) => akislar[k].length > 0);
    if (anahtarlar.length === 0) throw new Error('MIDI dosyasında çalınabilir nota bulunamadı');

    const tumu = [];
    anahtarlar.forEach((k) => akislar[k].forEach((n) => tumu.push({ midi: n.midi, bas: n.bas, son: n.son, k: k })));
    if (tumu.length > MAKS_NOTA) {
      throw new Error('Eser çok büyük (' + tumu.length + ' nota). En fazla ' + MAKS_NOTA + ' nota desteklenir');
    }

    // Eller: tam iki akış varsa yüksek olan sağ el; yoksa 60'ın (orta Do) üstü sağ, altı sol
    let elOf;
    if (anahtarlar.length === 2) {
      const ort = anahtarlar.map((k) => akislar[k].reduce((s, n) => s + n.midi, 0) / akislar[k].length);
      const sagAnahtar = ort[0] >= ort[1] ? anahtarlar[0] : anahtarlar[1];
      elOf = (n) => (n.k === sagAnahtar ? 'sag' : 'sol');
    } else {
      elOf = (n) => (n.midi >= 60 ? 'sag' : 'sol');
      uyari.push('El ayrımı tahminidir: orta Do (Do4) ve üstü sağ ele, altı sol ele verildi.');
    }

    // Ritim: zaten düzenliyse olduğu gibi, değilse onaltılık notaya yuvarla
    const duzenli = tumu.filter((n) => {
      const a = n.bas * 12;
      const b = n.bas * 4;
      return Math.abs(a - Math.round(a)) < 0.12 || Math.abs(b - Math.round(b)) < 0.04;
    }).length / tumu.length;
    const yuvarlaIzgara = duzenli < 0.95;
    if (yuvarlaIzgara) {
      uyari.push('Ritim onaltılık nota (¼ vuruş) kesinliğine yuvarlandı, çünkü dosya canlı çalınmış gibi görünüyor.');
    }
    if (tempoDegisimi > 0) uyari.push('Tempo değişimleri uygulanmadı; ilk tempo kullanıldı.');

    const ham = tumu.map((n) => {
      let bas = n.bas;
      let sure = n.son - n.bas;
      if (yuvarlaIzgara) {
        bas = Math.round(bas * 4) / 4;
        sure = Math.max(Math.round(sure * 4) / 4, 0.25);
      }
      return { el: elOf(n), midi: n.midi, baslangic: bas, sure: sure };
    });

    let payG = pay || 4;
    let paydaG = payda || 4;
    if (![2, 3, 4, 5, 6, 7, 9, 12].includes(payG) || ![2, 4, 8, 16].includes(paydaG)) {
      uyari.push('Alışılmadık ölçü (' + payG + '/' + paydaG + ') 4/4 olarak gösterildi.');
      payG = 4;
      paydaG = 4;
    }
    if (!tempo) {
      tempo = 120;
      uyari.push('Dosyada tempo yoktu, ♩ = 120 kullanıldı.');
    }
    return eserYap(dosyaAdi, '', payG, paydaG, tempo, ham, 1);
  }

  /* ---------- DOSYADAN ESER ---------- */

  async function dosyadanEser(dosya) {
    const tamAd = dosya.name || 'Adsız';
    const uzanti = tamAd.indexOf('.') >= 0 ? tamAd.split('.').pop().toLowerCase() : '';
    const ad = tamAd.replace(/\.[^.]+$/, '').slice(0, 120) || 'Adsız';
    if (UZANTILAR.indexOf(uzanti) < 0) throw new Error('"' + tamAd + '": desteklenmeyen dosya türü');
    if (dosya.size === 0) throw new Error('"' + tamAd + '": dosya boş');
    if (dosya.size > MAKS_DOSYA) throw new Error('"' + tamAd + '": çok büyük (en fazla 20 MB)');
    const uyari = [];
    let eser;
    if (uzanti === 'mid' || uzanti === 'midi') {
      eser = midiEser(await dosya.arrayBuffer(), ad, uyari);
    } else if (uzanti === 'mxl') {
      eser = await mxlEser(await dosya.arrayBuffer(), ad, uyari);
    } else {
      eser = xmlEser(await dosya.text(), ad, uyari);
    }
    eser.baslik = (eser.baslik || ad).slice(0, 120);
    return { eser: eser, uyari: uyari };
  }

  window.NOTA_IC = {
    uzantilar: UZANTILAR,
    dosyadanEser: dosyadanEser,
    bosEser: bosEser,
    dogrula: dogrula,
    eserYap: eserYap
  };
})();
