/*
  GERÇEK PİYANO SESİ (örnek tabanlı)
  Kaynak: Salamander Grand Piano V3, Alexander Holm, lisans CC BY 3.0
  MP3 paketi: @audio-samples/piano-mp3-velocity10
  İki adresten denenir: unpkg, olmazsa jsDelivr.
  30 kayıt (her 3 notada bir), aradaki notalar kayıt hızı değiştirilerek üretilir.
  İndirilen dosyalar tarayıcı önbelleğinde ayrı bir kutuda saklanır.
*/

const PIYANO_ONBELLEK = 'piyano-sesler-v1';
const PIYANO_ADRESLER = [
  'https://unpkg.com/@audio-samples/piano-mp3-velocity10@1.0.5/audio/',
  'https://cdn.jsdelivr.net/npm/@audio-samples/piano-mp3-velocity10@1.0.5/audio/'
];
const PIYANO_NOT_ADLARI = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PIYANO_ILK = 21;   // La0
const PIYANO_SON = 108;  // Do8
const PIYANO_ARALIK = 3; // her 3 notada bir kayıt
const PIYANO_TEPE = 0.7;
const PIYANO_BIRAKMA = 0.15;      // otomatik çalmada nota sonu sönme hızı (saniye)
const PIYANO_ZAMAN_ASIMI = 30000; // milisaniye

const PIYANO = {
  hazir: false,
  yukleniyor: false,
  tamponlar: {} // kayıt midi numarası -> AudioBuffer
};

function piyanoOrnekler() {
  const liste = [];
  for (let m = PIYANO_ILK; m <= PIYANO_SON; m += PIYANO_ARALIK) {
    const ad = PIYANO_NOT_ADLARI[m % 12] + (Math.floor(m / 12) - 1);
    const dosya = ad.replace('#', '%23') + 'v10.mp3';
    liste.push({
      midi: m,
      ad: ad,
      adres: PIYANO_ADRESLER[0] + dosya,                 // önbellek anahtarı
      kaynaklar: PIYANO_ADRESLER.map((a) => a + dosya)   // denenecek adresler
    });
  }
  return liste;
}

function sesCoz(ctx, veri) {
  return new Promise((coz, reddet) => {
    const p = ctx.decodeAudioData(veri, coz, reddet);
    if (p && p.catch) p.catch(reddet);
  });
}

async function piyanoOnbellekSayisi() {
  if (!('caches' in window)) return 0;
  const onbellek = await caches.open(PIYANO_ONBELLEK);
  const anahtarlar = await onbellek.keys();
  return anahtarlar.length;
}

// Önbellekteki kayıtları çözüp belleğe alır. Hepsi varsa hazir = true olur.
async function piyanoYukle(ctx) {
  if (PIYANO.yukleniyor) return PIYANO.hazir;
  PIYANO.yukleniyor = true;
  try {
    if (!('caches' in window)) return false;
    const onbellek = await caches.open(PIYANO_ONBELLEK);
    const liste = piyanoOrnekler();
    const tamponlar = {};
    let eksik = 0;
    for (const o of liste) {
      const yanit = await onbellek.match(o.adres);
      if (!yanit) {
        eksik++;
        continue;
      }
      try {
        const veri = await yanit.arrayBuffer();
        tamponlar[o.midi] = await sesCoz(ctx, veri);
      } catch (e) {
        await onbellek.delete(o.adres); // bozuk dosyayı at, tekrar indirilsin
        eksik++;
      }
    }
    PIYANO.tamponlar = tamponlar;
    PIYANO.hazir = eksik === 0;
    return PIYANO.hazir;
  } catch (e) {
    PIYANO.hazir = false;
    return false;
  } finally {
    PIYANO.yukleniyor = false;
  }
}

// Tek bir adresten indirir (zaman aşımı var), veriyi ArrayBuffer olarak döner
async function piyanoAdresIndir(adres) {
  const denetci = new AbortController();
  const sayac = setTimeout(() => denetci.abort(), PIYANO_ZAMAN_ASIMI);
  try {
    const yanit = await fetch(adres, { mode: 'cors', signal: denetci.signal });
    if (!yanit.ok) throw new Error('HTTP ' + yanit.status);
    const veri = await yanit.arrayBuffer();
    if (veri.byteLength < 2000) throw new Error('dosya çok küçük');
    return veri;
  } finally {
    clearTimeout(sayac);
  }
}

// Bir kaydı sırayla tüm adreslerden, adres başına 2 deneme ile indirir
async function piyanoKayitIndir(o, onbellek) {
  const varMi = await onbellek.match(o.adres);
  if (varMi) return;

  let sonHata = 'bilinmiyor';
  for (const kaynak of o.kaynaklar) {
    const sunucu = new URL(kaynak).hostname;
    for (let deneme = 0; deneme < 2; deneme++) {
      try {
        const veri = await piyanoAdresIndir(kaynak);
        await onbellek.put(
          o.adres,
          new Response(veri, { headers: { 'Content-Type': 'audio/mpeg' } })
        );
        return;
      } catch (e) {
        const neden = e && e.name === 'AbortError' ? 'zaman aşımı' : (e && e.message ? e.message : 'hata');
        sonHata = sunucu + ': ' + neden;
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }
  throw new Error(o.ad + ' (' + sonHata + ')');
}

// Eksik kayıtları indirir (iki dosya aynı anda). ilerleme(bitti, toplam)
async function piyanoIndir(ctx, ilerleme) {
  if (!('caches' in window)) throw new Error('Tarayıcı önbelleği desteklemiyor');
  if (!navigator.onLine) throw new Error('İnternet bağlantısı yok');

  const onbellek = await caches.open(PIYANO_ONBELLEK);
  const liste = piyanoOrnekler();
  const toplam = liste.length;
  const sira = liste.slice();
  const hatalar = [];
  let bitti = 0;

  async function isci() {
    while (sira.length > 0) {
      const o = sira.shift();
      try {
        await piyanoKayitIndir(o, onbellek);
        bitti++;
        if (ilerleme) ilerleme(bitti, toplam);
      } catch (e) {
        hatalar.push(e && e.message ? e.message : o.ad);
      }
    }
  }

  await Promise.all([isci(), isci()]);

  if (hatalar.length > 0) {
    throw new Error(hatalar.length + ' dosya indirilemedi, ilki: ' + hatalar[0]);
  }
  await piyanoYukle(ctx);
  if (!PIYANO.hazir) throw new Error('Sesler indirildi ama çözülemedi');
}

async function piyanoSil() {
  PIYANO.hazir = false;
  PIYANO.tamponlar = {};
  if ('caches' in window) await caches.delete(PIYANO_ONBELLEK);
}

/*
  Tek bir notayı başlatır.
  sure = null: tuş basılı kaldıkça sürer (elle çalma), bırakma notaBirak ile yapılır.
  sure = sayı: o kadar saniye sonra kendiliğinden sönmeye başlar (otomatik çalma).
  Dönen nesne sentez sesle aynı biçimdedir: { osc: [...], cikis: GainNode, baslangic }
*/
function piyanoSesBaslat(ctx, cikis, midi, t, sure, guc) {
  if (!PIYANO.hazir) return null;
  let kayit = PIYANO_ILK + PIYANO_ARALIK * Math.round((midi - PIYANO_ILK) / PIYANO_ARALIK);
  kayit = Math.min(Math.max(kayit, PIYANO_ILK), PIYANO_SON);
  const tampon = PIYANO.tamponlar[kayit];
  if (!tampon) return null;

  const hiz = Math.pow(2, (midi - kayit) / 12);
  const tepe = PIYANO_TEPE * (guc > 0 ? Math.min(guc, 1) : 1);
  const kaynak = ctx.createBufferSource();
  kaynak.buffer = tampon;
  kaynak.playbackRate.value = hiz;

  const kazanc = ctx.createGain();
  kazanc.gain.setValueAtTime(0.0001, t);
  kazanc.gain.linearRampToValueAtTime(tepe, t + 0.004);

  kaynak.connect(kazanc);
  kazanc.connect(cikis);

  const dogalSure = tampon.duration / hiz;
  let bitis = t + dogalSure + 0.1;
  if (sure !== null && sure !== undefined) {
    const birak = t + Math.max(sure, 0.04);
    kazanc.gain.setValueAtTime(tepe, birak);
    kazanc.gain.setTargetAtTime(0.0001, birak, PIYANO_BIRAKMA);
    bitis = Math.min(bitis, birak + 1.6);
  }

  kaynak.start(t);
  kaynak.stop(bitis);
  return { osc: [kaynak], cikis: kazanc, baslangic: t };
}