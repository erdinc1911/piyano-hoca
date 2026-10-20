const SURUM = 'Aşama 6';

const ILK_MIDI = 21;  // La0
const SON_MIDI = 108; // Do8

const MIN_BOYUT = 24;   // en küçük beyaz tuş genişliği (piksel)
const MAX_BOYUT = 120;  // en büyük beyaz tuş genişliği (piksel)
const BOYUT_ADIM = 8;
let beyazGenislik = 60;
let siyahGenislik = 36;

// Elle çalmada tuş bırakılınca sesin sönme hızı (saniye). Büyüdükçe ses daha uzun çınlar.
const BIRAKMA_SURESI = 0.3;

// "Önbelleği temizle" düğmesinin silmeyeceği önbellekler (indirilen sesler ve PDF desteği)
const KORUNAN_ONBELLEKLER = [PIYANO_ONBELLEK, 'piyano-pdf-v1'];

const ADLAR = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
const HARFLER = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const SIYAH_MI = [false, true, false, true, false, false, true, false, true, false, true, false];

let ctx = null;
let anaCikis = null;
const sesler = {};
const tuslar = {}; // midi -> { el, siyah, indeks, sol }
let klavyeKontrol = null;

/* ---------- SES ---------- */

// Ses bağlamını oluşturur (kullanıcı dokunmadan önce askıda kalır)
function baglamOlustur() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const sikistirici = ctx.createDynamicsCompressor();
    anaCikis = ctx.createGain();
    anaCikis.gain.value = 0.9;
    anaCikis.connect(sikistirici);
    sikistirici.connect(ctx.destination);
  }
}

function sesBaslat() {
  baglamOlustur();
  if (ctx.state === 'suspended') ctx.resume();
}

// Klavyeden elle çalma: parmak basılı kaldıkça sürer
function notaCal(midi) {
  sesBaslat();
  if (sesler[midi]) return;

  const t = ctx.currentTime;

  // Gerçek piyano sesi hazırsa onu kullan
  if (PIYANO.hazir) {
    const ses = piyanoSesBaslat(ctx, anaCikis, midi, t, null);
    if (ses) {
      sesler[midi] = ses;
      ses.osc[0].onended = () => {
        if (sesler[midi] === ses) delete sesler[midi];
        try { ses.cikis.disconnect(); } catch (e) {}
      };
      return;
    }
  }

  // Sentez ses (yedek)
  const frekans = 440 * Math.pow(2, (midi - 69) / 12);
  // Pes notalar uzun, tiz notalar kısa çınlar
  const sure = Math.min(Math.max(6 - (midi - 21) * 0.05, 1.2), 6);

  const cikis = ctx.createGain();
  cikis.gain.setValueAtTime(0.0001, t);
  cikis.gain.linearRampToValueAtTime(0.25, t + 0.006);
  cikis.gain.exponentialRampToValueAtTime(0.0001, t + sure);
  cikis.connect(anaCikis);

  const kismi = [1, 0.5, 0.28, 0.14, 0.08, 0.04];
  const osc = [];
  kismi.forEach((g, i) => {
    const f = frekans * (i + 1) * (1 + 0.0003 * i * i);
    if (f > 12000) return; // çok tiz kısmileri atla
    const o = ctx.createOscillator();
    const kazanc = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    kazanc.gain.value = g;
    o.connect(kazanc);
    kazanc.connect(cikis);
    o.start(t);
    o.stop(t + sure + 0.1);
    osc.push(o);
  });

  const kayit = { osc, cikis };
  sesler[midi] = kayit;
  if (osc.length > 0) {
    osc[0].onended = () => {
      if (sesler[midi] === kayit) delete sesler[midi];
    };
  }
}

// Tuş bırakılınca ses ani kesilmez, yumuşakça söner
function notaBirak(midi) {
  const s = sesler[midi];
  if (!s || !ctx) return;
  const t = ctx.currentTime;
  const g = s.cikis.gain;
  if (g.cancelAndHoldAtTime) {
    g.cancelAndHoldAtTime(t);
  } else {
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(g.value, 0.0001), t);
  }
  g.setTargetAtTime(0.0001, t, BIRAKMA_SURESI);
  s.osc.forEach((o) => {
    try { o.stop(t + BIRAKMA_SURESI * 7); } catch (e) {}
  });
  delete sesler[midi];
}

// Otomatik çalma: belirli bir zamanda başlar, belirli sürede biter
const programliSesler = new Set();

function programliNotaCal(midi, t, sure) {
  sesBaslat();
  sure = Math.max(sure, 0.04);

  // Gerçek piyano sesi hazırsa onu kullan
  if (PIYANO.hazir) {
    const ses = piyanoSesBaslat(ctx, anaCikis, midi, t, sure);
    if (ses) {
      programliSesler.add(ses);
      ses.osc[0].onended = () => {
        programliSesler.delete(ses);
        try { ses.cikis.disconnect(); } catch (e) {}
      };
      return;
    }
  }

  // Sentez ses (yedek)
  const frekans = 440 * Math.pow(2, (midi - 69) / 12);
  const dogal = Math.min(Math.max(6 - (midi - 21) * 0.05, 1.2), 6);
  const tepe = 0.25;
  const birakma = 0.18;

  const cikis = ctx.createGain();
  cikis.gain.setValueAtTime(0.0001, t);
  cikis.gain.linearRampToValueAtTime(tepe, t + 0.006);

  let bitis;
  if (sure >= dogal) {
    cikis.gain.exponentialRampToValueAtTime(0.0001, t + dogal);
    bitis = t + dogal + 0.1;
  } else {
    const oran = Math.max((sure - 0.006) / (dogal - 0.006), 0);
    const v = Math.max(tepe * Math.pow(0.0001 / tepe, oran), 0.0002);
    cikis.gain.exponentialRampToValueAtTime(v, t + sure);
    cikis.gain.exponentialRampToValueAtTime(0.0001, t + sure + birakma);
    bitis = t + sure + birakma + 0.1;
  }
  cikis.connect(anaCikis);

  const kismi = [1, 0.5, 0.28, 0.14, 0.08, 0.04];
  const osc = [];
  kismi.forEach((g, i) => {
    const f = frekans * (i + 1) * (1 + 0.0003 * i * i);
    if (f > 12000) return;
    const o = ctx.createOscillator();
    const kazanc = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    kazanc.gain.value = g;
    o.connect(kazanc);
    kazanc.connect(cikis);
    o.start(t);
    o.stop(bitis);
    osc.push(o);
  });

  const kayit = { osc, cikis, baslangic: t };
  programliSesler.add(kayit);
  if (osc.length > 0) {
    osc[0].onended = () => {
      programliSesler.delete(kayit);
      try { cikis.disconnect(); } catch (e) {}
    };
  }
}

// Çalan ve planlanmış tüm otomatik sesleri kısa sürede keser
function programliSesleriKes() {
  if (!ctx) return;
  const t = ctx.currentTime;
  programliSesler.forEach((s) => {
    if (s.baslangic > t) {
      // Henüz başlamamış: tamamen iptal et
      try { s.cikis.disconnect(); } catch (e) {}
      s.osc.forEach((o) => { try { o.stop(t); } catch (e) {} });
    } else {
      const g = s.cikis.gain;
      if (g.cancelAndHoldAtTime) {
        g.cancelAndHoldAtTime(t);
      } else {
        g.cancelScheduledValues(t);
        g.setValueAtTime(Math.max(g.value, 0.0001), t);
      }
      g.exponentialRampToValueAtTime(0.0001, t + 0.06);
      s.osc.forEach((o) => { try { o.stop(t + 0.1); } catch (e) {} });
    }
  });
  programliSesler.clear();
}

/* ---------- NOTA ADI ---------- */

function notaAdi(midi) {
  const oktav = Math.floor(midi / 12) - 1;
  const n = midi % 12;
  return ADLAR[n] + oktav + ' (' + HARFLER[n] + oktav + ')';
}

function kisaAd(midi) {
  return ADLAR[midi % 12] + (Math.floor(midi / 12) - 1);
}

/* ---------- DOKUNMA YÖNETİMİ ---------- */
// Her parmak (pointerId) şu an hangi tuşun üzerinde olduğunu hatırlar.
// Aynı tuşa birden fazla parmak basarsa, son parmak kalkana kadar nota sürer.

const parmaklar = new Map();   // pointerId -> midi (veya null)
const tusSahipleri = {};       // midi -> Set(pointerId)

function tusBas(midi, id) {
  if (!tusSahipleri[midi]) tusSahipleri[midi] = new Set();
  const kume = tusSahipleri[midi];
  const ilk = kume.size === 0;
  kume.add(id);
  if (ilk) {
    tuslar[midi].el.classList.add('basili');
    notaCal(midi);
  }
  document.getElementById('nota-bilgi').textContent = notaAdi(midi);
}

function tusBirak(midi, id) {
  const kume = tusSahipleri[midi];
  if (!kume) return;
  kume.delete(id);
  if (kume.size === 0) {
    tuslar[midi].el.classList.remove('basili');
    notaBirak(midi);
  }
}

function midiBul(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el || el.dataset.midi === undefined) return null;
  const m = Number(el.dataset.midi);
  return tuslar[m] ? m : null;
}

function parmakBirak(id) {
  if (!parmaklar.has(id)) return;
  const eski = parmaklar.get(id);
  if (eski !== null) tusBirak(eski, id);
  parmaklar.delete(id);
}

function hepsiniBirak() {
  Array.from(parmaklar.keys()).forEach(parmakBirak);
}

function dokunmaKur() {
  const klavye = document.getElementById('klavye');

  klavye.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { klavye.setPointerCapture(e.pointerId); } catch (err) {}
    const m = midiBul(e.clientX, e.clientY);
    parmaklar.set(e.pointerId, m);
    if (m !== null) tusBas(m, e.pointerId);
  });

  klavye.addEventListener('pointermove', (e) => {
    if (!parmaklar.has(e.pointerId)) return;
    e.preventDefault();
    const eski = parmaklar.get(e.pointerId);
    const yeni = midiBul(e.clientX, e.clientY);
    if (yeni === eski) return; // aynı tuşta bekliyor: ses yeniden başlamaz
    if (eski !== null) tusBirak(eski, e.pointerId);
    parmaklar.set(e.pointerId, yeni);
    if (yeni !== null) tusBas(yeni, e.pointerId);
  });

  const bitir = (e) => parmakBirak(e.pointerId);
  klavye.addEventListener('pointerup', bitir);
  klavye.addEventListener('pointercancel', bitir);
  klavye.addEventListener('lostpointercapture', bitir);

  klavye.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', hepsiniBirak);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hepsiniBirak();
  });
}

/* ---------- KLAVYE OLUŞTURMA VE YERLEŞİM ---------- */

function klavyeOlustur() {
  const klavye = document.getElementById('klavye');
  let beyazIndeks = 0;

  for (let m = ILK_MIDI; m <= SON_MIDI; m++) {
    const el = document.createElement('div');
    el.dataset.midi = m;
    const siyah = SIYAH_MI[m % 12];

    if (siyah) {
      el.className = 'siyah';
    } else {
      el.className = 'beyaz';
      const n = m % 12;
      if (n === 0 || m === ILK_MIDI) {
        el.textContent = ADLAR[n] + (Math.floor(m / 12) - 1);
      }
    }

    tuslar[m] = { el, siyah, indeks: beyazIndeks, sol: 0 };
    if (!siyah) beyazIndeks++;
    klavye.appendChild(el);
  }
  tuslar.beyazSayisi = beyazIndeks;
}

function yerlesimUygula() {
  const klavye = document.getElementById('klavye');
  siyahGenislik = Math.round(beyazGenislik * 0.6);
  klavye.style.width = (tuslar.beyazSayisi * beyazGenislik) + 'px';

  for (let m = ILK_MIDI; m <= SON_MIDI; m++) {
    const t = tuslar[m];
    if (t.siyah) {
      t.sol = t.indeks * beyazGenislik - siyahGenislik / 2;
      t.el.style.width = siyahGenislik + 'px';
    } else {
      t.sol = t.indeks * beyazGenislik;
      t.el.style.width = beyazGenislik + 'px';
      t.el.style.fontSize = (beyazGenislik < 40 ? 0.55 : 0.8) + 'rem';
    }
    t.el.style.left = t.sol + 'px';
  }
}

/* ---------- KAYDIRMA, OKTAV VE BOYUT ---------- */

function gezinmeKur() {
  const kutu = document.getElementById('kaydirma');
  const kaydirici = document.getElementById('kaydirici');
  const gorunen = document.getElementById('gorunen');
  const boyutYazi = document.getElementById('boyut-yazi');
  const kucultBtn = document.getElementById('kucult');
  const buyutBtn = document.getElementById('buyut');
  let kayitliKonum = 0;

  function sliderAyarla() {
    kaydirici.max = Math.max(kutu.scrollWidth - kutu.clientWidth, 1);
    kaydirici.value = kutu.scrollLeft;
  }

  function gorunenYaz() {
    let bulunan = ILK_MIDI;
    for (let m = ILK_MIDI; m <= SON_MIDI; m++) {
      if (tuslar[m].siyah) continue;
      if (tuslar[m].sol + beyazGenislik / 2 >= kutu.scrollLeft) {
        bulunan = m;
        break;
      }
    }
    const n = bulunan % 12;
    gorunen.textContent = 'Sol: ' + ADLAR[n] + (Math.floor(bulunan / 12) - 1);
  }

  function boyutYaz() {
    const yuzde = Math.round((beyazGenislik / 60) * 100);
    boyutYazi.textContent = 'Tuş %' + yuzde;
    kucultBtn.disabled = beyazGenislik <= MIN_BOYUT;
    buyutBtn.disabled = beyazGenislik >= MAX_BOYUT;
    kucultBtn.style.opacity = kucultBtn.disabled ? 0.4 : 1;
    buyutBtn.style.opacity = buyutBtn.disabled ? 0.4 : 1;
  }

  function boyutDegistir(yeni) {
    yeni = Math.min(Math.max(yeni, MIN_BOYUT), MAX_BOYUT);
    if (yeni === beyazGenislik) return;
    // Ekranın ortasındaki konumu koru
    const merkez = (kutu.scrollLeft + kutu.clientWidth / 2) / beyazGenislik;
    beyazGenislik = yeni;
    yerlesimUygula();
    kutu.scrollLeft = Math.max(merkez * beyazGenislik - kutu.clientWidth / 2, 0);
    sliderAyarla();
    gorunenYaz();
    boyutYaz();
  }

  kutu.addEventListener('scroll', () => {
    kaydirici.value = kutu.scrollLeft;
    gorunenYaz();
  });

  kaydirici.addEventListener('input', () => {
    kutu.scrollLeft = Number(kaydirici.value);
  });

  document.getElementById('oktav-sol').addEventListener('click', () => {
    kutu.scrollTo({ left: kutu.scrollLeft - 7 * beyazGenislik, behavior: 'smooth' });
  });
  document.getElementById('oktav-sag').addEventListener('click', () => {
    kutu.scrollTo({ left: kutu.scrollLeft + 7 * beyazGenislik, behavior: 'smooth' });
  });

  kucultBtn.addEventListener('click', () => boyutDegistir(beyazGenislik - BOYUT_ADIM));
  buyutBtn.addEventListener('click', () => boyutDegistir(beyazGenislik + BOYUT_ADIM));

  window.addEventListener('resize', sliderAyarla);

  // Sekme değişince kaydırma konumunu sakla / geri getir; tuşu görünür yap
  klavyeKontrol = {
    sakla() {
      kayitliKonum = kutu.scrollLeft;
    },
    geriYukle() {
      sliderAyarla();
      kutu.scrollLeft = kayitliKonum;
      sliderAyarla();
      gorunenYaz();
    },
    goster(midi) {
      const t = tuslar[midi];
      if (!t || kutu.clientWidth === 0) return;
      const genis = t.siyah ? siyahGenislik : beyazGenislik;
      if (t.sol < kutu.scrollLeft || t.sol + genis > kutu.scrollLeft + kutu.clientWidth) {
        kutu.scrollTo({
          left: Math.max(t.sol + genis / 2 - kutu.clientWidth / 2, 0),
          behavior: 'smooth'
        });
      }
    }
  };

  // Açılışta orta Do'yu (Do4) ortala
  yerlesimUygula();
  sliderAyarla();
  const hedef = tuslar[60].sol + beyazGenislik / 2 - kutu.clientWidth / 2;
  kutu.scrollLeft = Math.max(hedef, 0);
  sliderAyarla();
  gorunenYaz();
  boyutYaz();
}

/* ---------- ESER, PORTE VE EL SEÇİMİ ---------- */

let aktifEser = ORNEK_ESER;
const elGorunum = { sag: true, sol: true };
let seciliNotaId = null;
let notaZamanlayici = null;

// Çalınacak bölüm (ölçü numaraları, 1'den başlar) ve döngü
let bolumBas = 1;
let bolumSon = ORNEK_ESER.olcuSayisi;
let donguAcik = false;
let tempoYuzde = 100;

function eserBasligiYaz() {
  const e = aktifEser;
  document.getElementById('eser-baslik').textContent =
    e.baslik + ' · ' + e.olcu.pay + '/' + e.olcu.payda + ' · ♩ = ' + e.tempo;
}

function porteYenile() {
  oncekiCalanAnahtar = '';
  porteCiz(document.getElementById('porte-kutu'), aktifEser, {
    sag: elGorunum.sag,
    sol: elGorunum.sol,
    seciliId: seciliNotaId,
    tikla: notaSec,
    bolumBas: bolumBas,
    bolumSon: bolumSon
  });
  if (cal.durum === 'duraklat') porteCizgisiniKoy(cal.baslangic + cal.duraklatVB);
}

function klavyeIsaretiniTemizle() {
  document.querySelectorAll('.isaret-sag, .isaret-sol').forEach((el) => {
    el.classList.remove('isaret-sag');
    el.classList.remove('isaret-sol');
  });
}

function notaSec(n) {
  seciliNotaId = n.id;
  porteYenile();

  klavyeIsaretiniTemizle();
  if (tuslar[n.midi]) {
    tuslar[n.midi].el.classList.add(n.el === 'sag' ? 'isaret-sag' : 'isaret-sol');
  }
  if (klavyeKontrol) klavyeKontrol.goster(n.midi);

  document.getElementById('nota-bilgi').textContent =
    notaAdi(n.midi) + ' · ' + (n.el === 'sag' ? 'Sağ el' : 'Sol el');

  // Notayı kısa çal (parmakla basılı tutulan tuşu kesme)
  notaCal(n.midi);
  clearTimeout(notaZamanlayici);
  notaZamanlayici = setTimeout(() => {
    const kume = tusSahipleri[n.midi];
    if (!kume || kume.size === 0) notaBirak(n.midi);
  }, 700);
}

function elDugmeleriKur() {
  const dugmeler = { sag: document.getElementById('el-sag'), sol: document.getElementById('el-sol') };
  ['sag', 'sol'].forEach((el) => {
    dugmeler[el].addEventListener('click', () => {
      elGorunum[el] = !elGorunum[el];
      dugmeler[el].classList.toggle('aktif', elGorunum[el]);

      // Gizlenen elin notası seçiliyse seçimi kaldır
      if (!elGorunum[el] && seciliNotaId && seciliNotaId.indexOf(el + '-') === 0) {
        seciliNotaId = null;
        klavyeIsaretiniTemizle();
      }
      porteYenile();
      elDegisti();
    });
  });
}

function kutuphaneKur() {
  const e = aktifEser;
  document.getElementById('ornek-bilgi').textContent =
    e.baslik + ' (' + e.besteci + '), ' + e.olcuSayisi + ' ölçü, ' +
    e.olcu.pay + '/' + e.olcu.payda + '.';
  document.getElementById('btn-ornek-ac').addEventListener('click', () => sekmeGoster('cal'));
}

/* ---------- ÇALMA MOTORU ---------- */
// Zaman "vuruş" cinsinden tutulur (1 vuruş = dörtlük nota).
// Ses planlayıcısı, Web Audio saatine göre notaları kısa süre önceden planlar.

const ZAMAN_UFKU = 0.2; // saniye: notalar bu kadar önceden planlanır

const cal = {
  durum: 'durdu',     // 'durdu' | 'caliyor' | 'duraklat'
  olaylar: [],        // { id, el, midi, b (bölüm başından vuruş), sure }
  uzunluk: 0,         // bölümün uzunluğu (vuruş)
  baslangic: 0,       // bölümün eser içindeki başlangıcı (vuruş)
  idx: 0,             // sıradaki planlanacak olay
  sayac: 0,           // döngü sayacı
  refVB: 0,           // referans vuruş
  refZaman: 0,        // referans vuruşun ses saatindeki zamanı
  duraklatVB: 0,
  zamanlayici: null,
  raf: null
};

let oncekiCalanAnahtar = '';

function olcuVurusu() {
  return aktifEser.olcu.pay * 4 / aktifEser.olcu.payda;
}

function bpm() {
  return aktifEser.tempo * tempoYuzde / 100;
}

function vbSimdi() {
  return cal.refVB + (ctx.currentTime - cal.refZaman) * bpm() / 60;
}

function olaylariHazirla() {
  const ov = olcuVurusu();
  const bas = (bolumBas - 1) * ov;
  const son = bolumSon * ov;
  cal.baslangic = bas;
  cal.uzunluk = son - bas;
  cal.olaylar = aktifEser.notalar
    .filter((n) => elGorunum[n.el] && n.baslangic >= bas - 1e-6 && n.baslangic < son - 1e-6)
    .map((n) => ({
      id: n.id,
      el: n.el,
      midi: n.midi,
      b: n.baslangic - bas,
      sure: Math.min(n.sure, son - n.baslangic)
    }))
    .sort((a, b) => a.b - b.b);
}

// Çalmayı verilen konumdan (bölüm içi vuruş) yeniden kurar.
// ileriBak: çalma sürerken kullanılır; zaten planlanmış notalar tekrar planlanmaz.
function konumdanYenidenKur(pos, ileriBak, gecikme) {
  cal.sayac = 0;
  cal.refVB = pos;
  cal.refZaman = ctx.currentTime + (gecikme || 0);
  const esik = pos + (ileriBak ? ZAMAN_UFKU * bpm() / 60 : 0) - 0.001;
  const i = cal.olaylar.findIndex((o) => o.b >= esik);
  cal.idx = i < 0 ? cal.olaylar.length : i;
}

function zamanla() {
  if (cal.durum !== 'caliyor' || !ctx) return;
  const simdi = ctx.currentTime;
  const ufuk = simdi + ZAMAN_UFKU;
  const sn = 60 / bpm();
  const len = cal.uzunluk;

  let koruma = 0;
  while (koruma++ < 400) {
    if (cal.idx >= cal.olaylar.length) {
      if (donguAcik && cal.olaylar.length > 0) {
        cal.idx = 0;
        cal.sayac++;
        continue;
      }
      break;
    }
    const o = cal.olaylar[cal.idx];
    const vb = o.b + cal.sayac * len;
    const t = cal.refZaman + (vb - cal.refVB) * sn;
    if (t > ufuk) break;
    programliNotaCal(o.midi, Math.max(t, simdi + 0.005), o.sure * sn);
    cal.idx++;
  }

  // Döngü kapalıysa bölüm bitince dur
  if (!donguAcik && vbSimdi() >= len) calmaBitir();
}

async function calmaBaslat() {
  if (cal.durum === 'caliyor') return;
  if (!elGorunum.sag && !elGorunum.sol) {
    document.getElementById('nota-bilgi').textContent = 'Çalmak için en az bir el açık olmalı.';
    return;
  }
  sesBaslat();
  try {
    if (ctx.state !== 'running') await ctx.resume();
  } catch (e) {}
  if (cal.durum === 'caliyor') return;

  hepsiniBirak();
  olaylariHazirla();
  const pos = cal.durum === 'duraklat' ? cal.duraklatVB : 0;
  cal.durum = 'caliyor';
  konumdanYenidenKur(pos, false, 0.08);
  zamanla();
  cal.zamanlayici = setInterval(zamanla, 25);
  if (!cal.raf) cal.raf = requestAnimationFrame(cizimDongusu);
  dugmeleriGuncelle();
}

function calmaDuraklat() {
  if (cal.durum !== 'caliyor') return;
  const vb = Math.max(vbSimdi(), 0);
  const len = cal.uzunluk;
  cal.duraklatVB = len > 0 ? Math.min(vb % len, len) : 0;
  cal.durum = 'duraklat';
  clearInterval(cal.zamanlayici);
  cal.zamanlayici = null;
  programliSesleriKes();
  vurguUygula([]);
  porteCizgisiniKoy(cal.baslangic + cal.duraklatVB);
  dugmeleriGuncelle();
}

function calmaDurdur(sesiKes) {
  clearInterval(cal.zamanlayici);
  cal.zamanlayici = null;
  if (cal.raf) {
    cancelAnimationFrame(cal.raf);
    cal.raf = null;
  }
  if (sesiKes !== false) programliSesleriKes();
  cal.durum = 'durdu';
  cal.duraklatVB = 0;
  vurguUygula([]);
  porteCizgisiniKoy(null);
  document.getElementById('olcu-gosterge').textContent = '';
  dugmeleriGuncelle();
}

function calmaBitir() {
  // Bölüm doğal olarak bitti: son notaların sönmesine izin ver
  calmaDurdur(false);
}

function vurguUygula(calan) {
  const anahtar = calan.map((o) => o.id).join(',');
  if (anahtar === oncekiCalanAnahtar) return;
  oncekiCalanAnahtar = anahtar;

  document.querySelectorAll('.cal-sag, .cal-sol').forEach((el) => {
    el.classList.remove('cal-sag');
    el.classList.remove('cal-sol');
  });
  document.querySelectorAll('#porte-kutu .nota.calan').forEach((el) => {
    el.classList.remove('calan');
  });

  calan.forEach((o) => {
    if (tuslar[o.midi]) tuslar[o.midi].el.classList.add('cal-' + o.el);
    const g = document.querySelector('#porte-kutu .nota[data-id="' + o.id + '"]');
    if (g) g.classList.add('calan');
  });

  if (calan.length > 0) {
    document.getElementById('nota-bilgi').textContent =
      'Çalıyor: ' + calan.map((o) => kisaAd(o.midi)).join(' · ');
    const ilk = calan.find((o) => o.el === 'sag') || calan[0];
    if (klavyeKontrol) klavyeKontrol.goster(ilk.midi);
  }
}

function porteyiTakipEt(vurus) {
  const kutu = document.getElementById('porte-kutu');
  const x = porteVurusX(vurus);
  if (x > kutu.scrollLeft + kutu.clientWidth * 0.85 || x < kutu.scrollLeft + 10) {
    kutu.scrollLeft = Math.max(x - kutu.clientWidth * 0.2, 0);
  }
}

function cizimDongusu() {
  cal.raf = null;
  if (cal.durum !== 'caliyor' || !ctx) return;

  const len = cal.uzunluk;
  const vb = Math.max(vbSimdi(), 0);
  let pos = 0;
  if (len > 0) pos = (!donguAcik && vb >= len) ? len : vb % len;

  const calan = cal.olaylar.filter((o) => o.b <= pos + 1e-6 && pos < o.b + o.sure - 1e-6);
  vurguUygula(calan);

  const genel = cal.baslangic + pos;
  porteCizgisiniKoy(genel);
  porteyiTakipEt(genel);

  const ov = olcuVurusu();
  const olcu = Math.min(Math.floor(genel / ov + 1e-6) + 1, aktifEser.olcuSayisi);
  document.getElementById('olcu-gosterge').textContent = 'Ölçü ' + olcu;

  cal.raf = requestAnimationFrame(cizimDongusu);
}

function dugmeleriGuncelle() {
  const calBtn = document.getElementById('btn-cal');
  if (cal.durum === 'caliyor') {
    calBtn.textContent = '⏸ Duraklat';
    calBtn.classList.add('duraklat');
  } else {
    calBtn.textContent = cal.durum === 'duraklat' ? '▶ Devam' : '▶ Çal';
    calBtn.classList.remove('duraklat');
  }
  document.getElementById('btn-durdur').disabled = cal.durum === 'durdu';
}

function elDegisti() {
  if (!elGorunum.sag && !elGorunum.sol) {
    calmaDurdur();
    return;
  }
  if (cal.durum === 'caliyor') {
    const vb = Math.max(vbSimdi(), 0);
    olaylariHazirla();
    const pos = cal.uzunluk > 0 ? vb % cal.uzunluk : 0;
    konumdanYenidenKur(pos, true, 0);
  } else if (cal.durum === 'duraklat') {
    olaylariHazirla();
  }
}

function tempoYaz() {
  document.getElementById('tempo-yazi').textContent =
    '♩ = ' + Math.round(bpm()) + ' · %' + tempoYuzde;
  document.getElementById('tempo-kaydirici').value = tempoYuzde;
}

function tempoDegistir(yeni) {
  yeni = Math.min(Math.max(Math.round(yeni / 5) * 5, 25), 200);
  if (yeni === tempoYuzde) return;
  if (cal.durum === 'caliyor') {
    // Konum sürekliliğini koru: eski tempoyla şimdiki vuruşu hesapla
    cal.refVB = vbSimdi();
    cal.refZaman = ctx.currentTime;
  }
  tempoYuzde = yeni;
  tempoYaz();
}

function bolumYaz() {
  document.getElementById('bas-yazi').textContent = bolumBas;
  document.getElementById('son-yazi').textContent = bolumSon;
}

function bolumDegisti() {
  calmaDurdur();
  bolumYaz();
  porteYenile();
}

function calmaKur() {
  const $ = (id) => document.getElementById(id);
  const n = () => aktifEser.olcuSayisi;

  $('btn-cal').addEventListener('click', () => {
    if (cal.durum === 'caliyor') calmaDuraklat();
    else calmaBaslat();
  });
  $('btn-durdur').addEventListener('click', () => calmaDurdur());

  $('tempo-azalt').addEventListener('click', () => tempoDegistir(tempoYuzde - 5));
  $('tempo-artir').addEventListener('click', () => tempoDegistir(tempoYuzde + 5));
  $('tempo-kaydirici').addEventListener('input', (e) => tempoDegistir(Number(e.target.value)));

  $('bas-azalt').addEventListener('click', () => {
    bolumBas = Math.max(1, bolumBas - 1);
    bolumDegisti();
  });
  $('bas-artir').addEventListener('click', () => {
    bolumBas = Math.min(n(), bolumBas + 1);
    if (bolumBas > bolumSon) bolumSon = bolumBas;
    bolumDegisti();
  });
  $('son-azalt').addEventListener('click', () => {
    bolumSon = Math.max(1, bolumSon - 1);
    if (bolumSon < bolumBas) bolumBas = bolumSon;
    bolumDegisti();
  });
  $('son-artir').addEventListener('click', () => {
    bolumSon = Math.min(n(), bolumSon + 1);
    bolumDegisti();
  });
  $('bolum-tumu').addEventListener('click', () => {
    bolumBas = 1;
    bolumSon = n();
    bolumDegisti();
  });

  $('dongu').addEventListener('click', () => {
    donguAcik = !donguAcik;
    $('dongu').classList.toggle('aktif', donguAcik);
    if (!donguAcik && cal.durum === 'caliyor') {
      // Döngü kapandı: bulunduğumuz turu bitirip dur
      const vb = Math.max(vbSimdi(), 0);
      const pos = cal.uzunluk > 0 ? vb % cal.uzunluk : 0;
      konumdanYenidenKur(pos, true, 0);
    }
  });

  // Başka uygulamaya geçilirse çalmayı duraklat (arka planda zamanlama bozulur)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) calmaDuraklat();
  });

  bolumYaz();
  tempoYaz();
  dugmeleriGuncelle();
}

/* ---------- SEKMELER ---------- */

let aktifSekme = 'cal';

function sekmeGoster(ad) {
  if (ad === aktifSekme) return;

  if (aktifSekme === 'cal') {
    calmaDuraklat();
    hepsiniBirak();
    if (klavyeKontrol) klavyeKontrol.sakla();
  }

  document.querySelectorAll('.sekme').forEach((s) => {
    s.classList.toggle('aktif', s.id === 'sekme-' + ad);
  });
  document.querySelectorAll('.sekme-dugme').forEach((b) => {
    b.classList.toggle('aktif', b.dataset.sekme === ad);
  });
  aktifSekme = ad;

  if (ad === 'cal' && klavyeKontrol) klavyeKontrol.geriYukle();
  if (ad === 'kutuphane' && window.eserListesiYenile) window.eserListesiYenile();
  if (ad === 'ayarlar') ayarlarYenile();
}

function sekmeleriKur() {
  document.querySelectorAll('.sekme-dugme').forEach((b) => {
    b.addEventListener('click', () => sekmeGoster(b.dataset.sekme));
  });
}

/* ---------- BAĞLANTI VE SES DURUMU ---------- */

function sesEtiketi() {
  if (PIYANO.hazir) return '🎹 Gerçek piyano';
  if (PIYANO.yukleniyor) return 'Ses yükleniyor…';
  return 'Sentez ses';
}

function durumGuncelle() {
  const baglanti = navigator.onLine ? 'Çevrimiçi' : 'Çevrimdışı';
  document.getElementById('durum').textContent = baglanti + ' · ' + sesEtiketi();
  const ay = document.getElementById('ay-baglanti');
  if (ay) ay.textContent = baglanti;
}

/* ---------- PİYANO SESİ KARTI (AYARLAR) ---------- */

let sesIndiriliyor = false;

function sesMesaj(yazi) {
  document.getElementById('ses-mesaj').textContent = yazi;
}

async function sesKartiYenile() {
  const ay = document.getElementById('ay-ses');
  const indirBtn = document.getElementById('btn-ses-indir');
  const silBtn = document.getElementById('btn-ses-sil');
  const toplam = piyanoOrnekler().length;

  let sayi = 0;
  try { sayi = await piyanoOnbellekSayisi(); } catch (e) {}

  if (PIYANO.hazir) {
    ay.textContent = 'Gerçek piyano (hazır)';
    indirBtn.textContent = 'Piyano sesleri indirildi';
    indirBtn.disabled = true;
  } else if (PIYANO.yukleniyor) {
    ay.textContent = 'Yükleniyor…';
    indirBtn.disabled = true;
  } else if (sayi > 0) {
    ay.textContent = 'Eksik indirme (' + sayi + '/' + toplam + ')';
    indirBtn.textContent = 'İndirmeyi tamamla';
    indirBtn.disabled = sesIndiriliyor;
  } else {
    ay.textContent = 'Sentez ses (indirilmedi)';
    indirBtn.textContent = 'Piyano seslerini indir (≈5,4 MB)';
    indirBtn.disabled = sesIndiriliyor;
  }
  silBtn.disabled = sesIndiriliyor || sayi === 0;
}

async function sesleriIndir() {
  if (sesIndiriliyor) return;
  sesIndiriliyor = true;
  const indirBtn = document.getElementById('btn-ses-indir');
  const cubuk = document.getElementById('ses-ilerleme');
  const dolgu = document.getElementById('ses-ilerleme-dolgu');
  indirBtn.disabled = true;
  cubuk.hidden = false;
  dolgu.style.width = '0%';
  sesMesaj('İndiriliyor…');

  try {
    baglamOlustur();
    await piyanoIndir(ctx, (bitti, toplam) => {
      dolgu.style.width = Math.round((bitti / toplam) * 100) + '%';
      sesMesaj('İndiriliyor: ' + bitti + ' / ' + toplam);
    });
    sesMesaj('Piyano sesleri hazır. Artık internetsiz de çalışır.');
  } catch (e) {
    sesMesaj('İndirme tamamlanamadı: ' + (e && e.message ? e.message : 'bilinmeyen hata') +
      '. İndirilen kısım saklandı, düğmeye tekrar basınca kaldığı yerden sürer.');
  }

  sesIndiriliyor = false;
  cubuk.hidden = true;
  await sesKartiYenile();
  durumGuncelle();
}

async function sesleriSil() {
  if (!confirm('İndirilen piyano sesleri silinsin mi? Gerekirse tekrar indirebilirsin (≈5,4 MB).')) return;
  await piyanoSil();
  sesMesaj('İndirilen sesler silindi. Sentez ses kullanılacak.');
  await sesKartiYenile();
  durumGuncelle();
}

function sesKartiKur() {
  document.getElementById('btn-ses-indir').addEventListener('click', sesleriIndir);
  document.getElementById('btn-ses-sil').addEventListener('click', sesleriSil);
}

// Açılışta önbellekteki sesleri belleğe al (varsa)
function sesleriBaslangictaYukle() {
  baglamOlustur();
  durumGuncelle();
  piyanoYukle(ctx).then(() => {
    durumGuncelle();
    if (aktifSekme === 'ayarlar') sesKartiYenile();
  });
}

/* ---------- AYARLAR VE PWA ---------- */

let yuklemeIstegi = null;

function mesajYaz(yazi) {
  document.getElementById('ay-mesaj').textContent = yazi;
}

function megabayt(bayt) {
  return (bayt / (1024 * 1024)).toFixed(1) + ' MB';
}

async function onbellekHazirMi() {
  try {
    if (!('caches' in window)) return false;
    const adres = new URL('app.js', location.href).href;
    const kayit = await caches.match(adres);
    return !!kayit;
  } catch (e) {
    return false;
  }
}

async function ayarlarYenile() {
  document.getElementById('ay-surum').textContent = SURUM;
  document.getElementById('ay-adres').textContent = location.origin;
  durumGuncelle();
  sesKartiYenile();
  if (window.pdfKartiYenile) window.pdfKartiYenile();

  const cevrimdisi = document.getElementById('ay-cevrimdisi');
  if (!('serviceWorker' in navigator)) {
    cevrimdisi.textContent = 'Hayır (tarayıcı desteklemiyor)';
  } else {
    const hazir = await onbellekHazirMi();
    cevrimdisi.textContent = hazir ? 'Evet' : 'Henüz değil (sayfayı bir kez yenile)';
  }

  const depolama = document.getElementById('ay-depolama');
  const alan = document.getElementById('ay-alan');
  if (navigator.storage && navigator.storage.persisted) {
    try {
      depolama.textContent = (await navigator.storage.persisted()) ? 'Verildi' : 'Verilmedi';
    } catch (e) {
      depolama.textContent = 'Bilinmiyor';
    }
  } else {
    depolama.textContent = 'Desteklenmiyor';
  }
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const tahmin = await navigator.storage.estimate();
      alan.textContent = megabayt(tahmin.usage || 0);
    } catch (e) {
      alan.textContent = 'Bilinmiyor';
    }
  } else {
    alan.textContent = 'Bilinmiyor';
  }
}

function ayarlarKur() {
  document.getElementById('btn-kalici').addEventListener('click', async () => {
    if (!navigator.storage || !navigator.storage.persist) {
      mesajYaz('Bu tarayıcı kalıcı depolamayı desteklemiyor.');
      return;
    }
    try {
      const verildi = await navigator.storage.persist();
      mesajYaz(verildi
        ? 'Kalıcı depolama verildi.'
        : 'Tarayıcı şimdilik vermedi. Uygulama ana ekrana yüklenince tekrar denenebilir.');
    } catch (e) {
      mesajYaz('Kalıcı depolama istenemedi.');
    }
    ayarlarYenile();
  });

  document.getElementById('btn-temizle').addEventListener('click', async () => {
    if (!confirm('Uygulama dosyalarının önbelleği silinip sayfa yenilensin mi? Kayıtlı eserlerin, indirilen piyano sesleri ve PDF desteği korunur.')) return;
    try {
      if ('serviceWorker' in navigator) {
        const kayitlar = await navigator.serviceWorker.getRegistrations();
        await Promise.all(kayitlar.map((k) => k.unregister()));
      }
      if ('caches' in window) {
        const anahtarlar = await caches.keys();
        await Promise.all(
          anahtarlar
            .filter((a) => KORUNAN_ONBELLEKLER.indexOf(a) < 0)
            .map((a) => caches.delete(a))
        );
      }
    } catch (e) {}
    location.reload();
  });

  const yukleBtn = document.getElementById('btn-yukle');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    yuklemeIstegi = e;
    yukleBtn.hidden = false;
  });
  yukleBtn.addEventListener('click', async () => {
    if (!yuklemeIstegi) return;
    yuklemeIstegi.prompt();
    try { await yuklemeIstegi.userChoice; } catch (e) {}
    yuklemeIstegi = null;
    yukleBtn.hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    yukleBtn.hidden = true;
    mesajYaz('Uygulama yüklendi.');
  });
}

function servisCalisaniKaydet() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(() => {
      if (aktifSekme === 'ayarlar') setTimeout(ayarlarYenile, 1500);
    }).catch(() => {});
  });
}

/* ---------- BAŞLAT ---------- */

window.addEventListener('online', durumGuncelle);
window.addEventListener('offline', durumGuncelle);

klavyeOlustur();
dokunmaKur();
gezinmeKur();
eserBasligiYaz();
elDugmeleriKur();
porteYenile();
calmaKur();
kutuphaneKur();
sekmeleriKur();
sesKartiKur();
ayarlarKur();
durumGuncelle();
servisCalisaniKaydet();
sesleriBaslangictaYukle();
if (window.kutuphaneBaslat) window.kutuphaneBaslat();