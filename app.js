const SURUM = 'Aşama 13';

const ILK_MIDI = 21;  // La0
const SON_MIDI = 108; // Do8

const MIN_BOYUT = 24;   // en küçük beyaz tuş genişliği (piksel)
const MAX_BOYUT = 120;  // en büyük beyaz tuş genişliği (piksel)
const BOYUT_ADIM = 8;
let beyazGenislik = 60;
let siyahGenislik = 36;

// Elle çalmada tuş bırakılınca sesin sönme hızı (saniye). Büyüdükçe ses daha uzun çınlar.
const BIRAKMA_SURESI = 0.15;

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
const KAYAN = { tuval: null, c2: null, w: 0, h: 0, dpr: 1 };

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

const hariciBasili = new Set();   // MIDI klavye ve mikrofondan gelen basılı notalar
const parmaklar = new Map();   // pointerId -> midi (veya null)
const tusSahipleri = {};       // midi -> Set(pointerId)

// Bilgi yazısını el rengine göre boyayarak yazar: parcalar = [{ yazi, el }]
function bilgiRenkli(onek, parcalar, sonek) {
  const kap = document.getElementById('nota-bilgi');
  kap.replaceChildren();
  if (onek) kap.appendChild(document.createTextNode(onek));
  parcalar.forEach((p, i) => {
    if (i > 0) kap.appendChild(document.createTextNode(' · '));
    const s = document.createElement('span');
    s.className = 'bilgi-' + p.el;
    s.textContent = p.yazi;
    kap.appendChild(s);
  });
  if (sonek) kap.appendChild(document.createTextNode(sonek));
}

// Basılan tuşun hangi ele ait olduğunu bulur: eserde yalnızca bir elde varsa o el,
// yoksa 60'ın (orta Do) üstü sağ, altı sol
function basiliEl(midi) {
  let sag = false;
  let sol = false;
  const liste = aktifEser.notalar;
  for (let i = 0; i < liste.length; i++) {
    if (liste[i].midi !== midi) continue;
    if (liste[i].el === 'sag') sag = true;
    else sol = true;
    if (sag && sol) break;
  }
  if (sag && !sol) return 'sag';
  if (sol && !sag) return 'sol';
  return midi >= 60 ? 'sag' : 'sol';
}

function basiliIsaretle(midi, acik) {
  const c = tuslar[midi].el.classList;
  c.remove('basili', 'basili-sag', 'basili-sol');
  if (acik) c.add('basili', 'basili-' + basiliEl(midi));
}

function tusBas(midi, id) {
  if (!tusSahipleri[midi]) tusSahipleri[midi] = new Set();
  const kume = tusSahipleri[midi];
  const ilk = kume.size === 0;
  kume.add(id);
  if (ilk) {
    basiliIsaretle(midi, true);
    notaCal(midi);
    if (window.PERF) PERF.tusBasildi(midi, performance.now());
    if (window.KAYIT) KAYIT.nota(midi, performance.now(), true);
  }
  basiliNotalariYaz();
}

// Basılı olan bütün tuşların adlarını gösterir (en fazla 6)
function basiliNotalariYaz() {
  const kume = new Set(hariciBasili);
  Object.keys(tusSahipleri).forEach((m) => {
    if (tusSahipleri[m].size > 0) kume.add(Number(m));
  });
  const liste = Array.from(kume).sort((x, y) => x - y);
  if (!liste.length) return;
  bilgiRenkli('', liste.slice(0, 6).map((m) => ({ yazi: notaAdi(m), el: basiliEl(m) })),
    liste.length > 6 ? ' …' : '');
}

function tusBirak(midi, id) {
  const kume = tusSahipleri[midi];
  if (!kume) return;
  kume.delete(id);
  if (kume.size === 0) {
    basiliIsaretle(midi, false);
    notaBirak(midi);
    if (window.KAYIT) KAYIT.nota(midi, performance.now(), false);
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
  let otoSigdir = false;

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
    otoSigdir = false;
    if (yeni === beyazGenislik) return;
    // Ekranın ortasındaki konumu koru
    const merkez = (kutu.scrollLeft + kutu.clientWidth / 2) / beyazGenislik;
    beyazGenislik = yeni;
    yerlesimUygula();
    kutu.scrollLeft = Math.max(merkez * beyazGenislik - kutu.clientWidth / 2, 0);
    sliderAyarla();
    gorunenYaz();
    boyutYaz();
    kayanYenile();
  }

  kutu.addEventListener('scroll', () => {
    kaydirici.value = kutu.scrollLeft;
    gorunenYaz();
    kayanYenile();
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

  // Klavyeyi eserin nota aralığına (tam oktavlar) sığdırır: kaydırmaya gerek kalmaz
  function sigdir(eser) {
    const w = kutu.clientWidth;
    if (!w) return;
    let alt = null;
    let ust = null;
    eser.notalar.forEach((n) => {
      if (alt === null || n.midi < alt) alt = n.midi;
      if (ust === null || n.midi > ust) ust = n.midi;
    });
    if (alt === null) { alt = 48; ust = 83; }
    let bas = Math.max(alt - (alt % 12), 24);          // Do'dan başla
    let son = Math.min(ust - (ust % 12) + 11, 107);    // Si'de bitir
    // En az 2 oktav göster
    while ((son - bas + 1) / 12 < 2) {
      if (son + 12 <= 107) son += 12;
      else if (bas - 12 >= 24) bas -= 12;
      else break;
    }
    const beyazSayisi = ((son - bas + 1) / 12) * 7;
    beyazGenislik = Math.min(Math.max(Math.floor(w / beyazSayisi), MIN_BOYUT), MAX_BOYUT);
    yerlesimUygula();
    const bosluk = Math.max(w - beyazSayisi * beyazGenislik, 0);
    kutu.scrollLeft = Math.max(tuslar[bas].sol - bosluk / 2, 0);
    otoSigdir = true;
    sliderAyarla();
    gorunenYaz();
    boyutYaz();
    kayanYenile();
  }

  window.addEventListener('resize', () => {
    if (otoSigdir) sigdir(aktifEser);
  });

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
    sigdir: sigdir,
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
let aktifEserKayit = null;   // kütüphanedeki kayıt kimliği (örnek eserde null)
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

// Porte, bulunduğu alanın yüksekliğine sığacak şekilde ölçeklenir
let porteOlcek = 1;

function porteOlcekle() {
  const kutu = document.getElementById('porte-kutu');
  const svg = kutu.querySelector('svg');
  if (!svg || !kutu.clientHeight) return;
  const vb = svg.viewBox.baseVal;
  const hedef = Math.min(Math.max(kutu.clientHeight - 2, 110), vb.height * 1.5);
  porteOlcek = hedef / vb.height;
  svg.setAttribute('width', vb.width * porteOlcek);
  svg.setAttribute('height', hedef);
}

function porteYenile() {
  oncekiCalanAnahtar = '';
  const kutu0 = document.getElementById('porte-kutu');
  const eskiSol = kutu0.scrollLeft;
  const eskiUst = kutu0.scrollTop;
  porteCiz(document.getElementById('porte-kutu'), aktifEser, {
    sag: elGorunum.sag,
    sol: elGorunum.sol,
    seciliId: seciliNotaId,
    tikla: notaSec,
    bolumBas: bolumBas,
    bolumSon: bolumSon
  });
  porteOlcekle();
  if (window.PERF) PERF.isaretYenile();
  kutu0.scrollLeft = eskiSol;
  kutu0.scrollTop = eskiUst;
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

  bilgiRenkli('', [{ yazi: notaAdi(n.midi) + ' · ' + (n.el === 'sag' ? 'Sağ el' : 'Sol el'), el: n.el }], '');

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
  document.getElementById('btn-ornek-ac').addEventListener('click', () => eserAc(ORNEK_ESER, null));
  document.getElementById('btn-ornek-kopya').addEventListener('click', async () => {
    const mesaj = document.getElementById('kut-mesaj');
    try {
      const kopya = JSON.parse(JSON.stringify(ORNEK_ESER));
      kopya.id = 'nota-' + Date.now().toString(36);
      kopya.baslik = ORNEK_ESER.baslik + ' (kopya)';
      const id = await window.notaKayitOlustur(kopya);
      if (window.eserListesiYenile) await window.eserListesiYenile();
      mesaj.textContent = '"' + kopya.baslik + '" kütüphaneye eklendi. Çal sekmesinde ✏ Düzenle ile değiştirebilirsin.';
      eserAc(kopya, id);
    } catch (e) {
      mesaj.textContent = 'Kopya oluşturulamadı: ' + (e && e.message ? e.message : 'bilinmeyen hata');
    }
  });
}

// Verilen eseri Çal sekmesinde açar (örnek eser, içe aktarılan ya da kendi yazdığın eser)
async function eserAc(eser, kayitId) {
  if (window.DUZ) await DUZ.kaydet();   // önceki eserdeki bekleyen değişiklikleri kaydet
  if (window.PERF) PERF.kapat();
  calmaDurdur();
  hepsiniBirak();
  aktifEser = eser;
  aktifEserKayit = kayitId || null;
  bolumBas = 1;
  bolumSon = eser.olcuSayisi;
  tempoYuzde = 100;
  seciliNotaId = null;
  klavyeIsaretiniTemizle();
  eserBasligiYaz();
  bolumYaz();
  tempoYaz();
  porteYenile();
  document.getElementById('porte-kutu').scrollLeft = 0;
  kayanYenile();
  document.getElementById('nota-bilgi').textContent = 'Bir tuşa ya da notaya dokun';
  sekmeGoster('cal');
  if (klavyeKontrol) klavyeKontrol.sigdir(eser);
  if (window.DUZ) DUZ.eserDegisti();
}
window.eserAc = eserAc;

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
  kayanYenile();
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
  kayanYenile();
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
    bilgiRenkli('Çalıyor: ', calan.map((o) => ({ yazi: kisaAd(o.midi), el: o.el })), '');
    const ilk = calan.find((o) => o.el === 'sag') || calan[0];
    if (klavyeKontrol) klavyeKontrol.goster(ilk.midi);
  }
}

function porteyiTakipEt(vurus) {
  const kutu = document.getElementById('porte-kutu');
  const x = porteVurusX(vurus) * porteOlcek;
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

  kayanCiz(pos);

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
  kayanYenile();
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
    kayanYenile();
    if (!donguAcik && cal.durum === 'caliyor') {
      // Döngü kapandı: bulunduğumuz turu bitirip dur
      const vb = Math.max(vbSimdi(), 0);
      const pos = cal.uzunluk > 0 ? vb % cal.uzunluk : 0;
      konumdanYenidenKur(pos, true, 0);
    }
  });

  // Başka uygulamaya geçilirse çalmayı duraklat (arka planda zamanlama bozulur)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      calmaDuraklat();
      if (window.PERF) PERF.iptal();
    }
  });

  bolumYaz();
  tempoYaz();
  dugmeleriGuncelle();
}

/* ---------- KAYAN NOTALAR ---------- */
// Notalar yukarıdan aşağı akar ve klavyedeki tuşlarla aynı hizadadır.
// Zaman ekseni vuruş cinsindendir: tempo değişince akış hızı da değişir.

function yuvarlakDikdortgen(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function kayanCiz(pos) {
  const k = KAYAN;
  if (!k.c2 || !k.w || !k.h) return;
  const c = k.c2;
  c.setTransform(k.dpr, 0, 0, k.dpr, 0, 0);
  c.fillStyle = '#0e0e1c';
  c.fillRect(0, 0, k.w, k.h);

  const kayma = document.getElementById('kaydirma').scrollLeft;
  const alt = k.h;
  const ppb = Math.min(Math.max(k.h / 5, 30), 80); // vuruş başına piksel
  const len = cal.uzunluk;
  const denemede = !!(window.PERF && PERF.sahne());
  const kopya = donguAcik && len > 0 && !denemede ? 2 : 1;

  // Oktav ayırıcı çizgileri
  c.strokeStyle = '#1c1c34';
  c.lineWidth = 1;
  c.beginPath();
  for (let m = ILK_MIDI; m <= SON_MIDI; m++) {
    if (m % 12 !== 0) continue;
    const x = Math.round(tuslar[m].sol - kayma) + 0.5;
    if (x >= 0 && x <= k.w) {
      c.moveTo(x, 0);
      c.lineTo(x, alt);
    }
  }
  c.stroke();

  // Ölçü çizgileri ve numaraları
  const ov = olcuVurusu();
  c.font = '11px system-ui, sans-serif';
  c.textBaseline = 'bottom';
  for (let r = 0; r < kopya; r++) {
    for (let m = bolumBas - 1; m <= bolumSon; m++) {
      const bl = m * ov - cal.baslangic + r * len;
      const y = alt - (bl - pos) * ppb;
      if (y < 0 || y > alt) continue;
      c.fillStyle = 'rgba(255,255,255,0.14)';
      c.fillRect(0, Math.round(y), k.w, 1);
      if (m < bolumSon) {
        c.fillStyle = 'rgba(255,255,255,0.4)';
        c.fillText(String(m + 1), 4, y - 2);
      }
    }
  }

  // Notalar: önce beyaz tuşlar, sonra siyah tuşlar (üstte)
  [false, true].forEach((siyahTur) => {
    for (let r = 0; r < kopya; r++) {
      cal.olaylar.forEach((o) => {
        const t = tuslar[o.midi];
        if (!t || t.siyah !== siyahTur) return;
        const bb = o.b + r * len;
        const ybot = alt - (bb - pos) * ppb;
        const ytop = alt - (bb + o.sure - pos) * ppb;
        if (ybot < 0 || ytop > alt) return;
        const genis = (t.siyah ? siyahGenislik : beyazGenislik) - 3;
        const x = t.sol - kayma + 1.5;
        if (x + genis < 0 || x > k.w) return;
        const calan = bb <= pos + 1e-6 && pos < bb + o.sure - 1e-6;
        const h = Math.max(ybot - ytop - 1, 5);
        const sonucRenk = denemede ? PERF.renk(o.id) : null;
        if (sonucRenk) {
          c.fillStyle = sonucRenk;
        } else if (o.el === 'sag') {
          c.fillStyle = calan ? '#a9c9ff' : (t.siyah ? '#2f6fd8' : '#4f8df5');
        } else {
          c.fillStyle = calan ? '#ffd699' : (t.siyah ? '#d9822b' : '#f2a03d');
        }
        yuvarlakDikdortgen(c, x, ybot - 1 - h, genis, h, 4);
        c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.45)';
        c.lineWidth = 1;
        c.stroke();
      });
    }
  });

  // Vuruş çizgisi (notaların tuşa değdiği yer)
  c.fillStyle = 'rgba(255,255,255,0.45)';
  c.fillRect(0, alt - 2, k.w, 2);
}

// Çalma sürmüyorsa duran halini çizer (çalarken kareler zaten çiziliyor)
function kayanYenile() {
  if (window.PERF && PERF.sahne()) {
    PERF.kareCiz();
    return;
  }
  if (cal.durum === 'caliyor') return;
  olaylariHazirla();
  kayanCiz(cal.durum === 'duraklat' ? cal.duraklatVB : 0);
}

function kayanKur() {
  const kutu = document.getElementById('kayan-kutu');
  const tuval = document.getElementById('kayan-tuval');
  KAYAN.tuval = tuval;
  KAYAN.c2 = tuval.getContext('2d');

  const boyutla = () => {
    const w = kutu.clientWidth;
    const h = kutu.clientHeight;
    if (!w || !h) {
      KAYAN.w = 0;
      KAYAN.h = 0;
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    tuval.width = Math.round(w * dpr);
    tuval.height = Math.round(h * dpr);
    KAYAN.w = w;
    KAYAN.h = h;
    KAYAN.dpr = dpr;
    kayanYenile();
  };

  if (window.ResizeObserver) new ResizeObserver(boyutla).observe(kutu);
  else window.addEventListener('resize', boyutla);
  boyutla();
}

/* ---------- PANEL DÜZENİ (PORTE / KAYAN NOTA / KLAVYE) ---------- */
// Üç bölümün yüksekliği ayırıcılar sürüklenerek ayarlanır, her biri kapatılabilir.
// Ayar bu cihazda hatırlanır.

const PANEL_ANAHTAR = 'piyano-yerlesim';
const PANEL_ADLARI = ['porte', 'kayan', 'klavye'];
const PANEL_KIMLIK = { porte: 'porte-kutu', kayan: 'kayan-kutu', klavye: 'klavye-bolum' };
const PANEL_DUGME = { porte: 'pn-porte', kayan: 'pn-kayan', klavye: 'pn-klavye' };
const PANEL_VARSAYILAN = {
  acik: { porte: true, kayan: true, klavye: true },
  agirlik: { porte: 4, kayan: 3, klavye: 3 }
};
let panelDuzen = JSON.parse(JSON.stringify(PANEL_VARSAYILAN));

function panelEl(ad) {
  return document.getElementById(PANEL_KIMLIK[ad]);
}

function panelDuzenOku() {
  try {
    const v = JSON.parse(localStorage.getItem(PANEL_ANAHTAR));
    if (!v || !v.acik || !v.agirlik) return;
    PANEL_ADLARI.forEach((ad) => {
      if (typeof v.acik[ad] === 'boolean') panelDuzen.acik[ad] = v.acik[ad];
      const w = Number(v.agirlik[ad]);
      if (isFinite(w) && w > 0) panelDuzen.agirlik[ad] = w;
    });
  } catch (e) {}
}

function panelDuzenYaz() {
  try {
    localStorage.setItem(PANEL_ANAHTAR, JSON.stringify(panelDuzen));
  } catch (e) {}
}

function panelDuzenUygula() {
  PANEL_ADLARI.forEach((ad) => {
    const el = panelEl(ad);
    el.hidden = !panelDuzen.acik[ad];
    el.style.flexGrow = String(panelDuzen.agirlik[ad]);
    document.getElementById(PANEL_DUGME[ad]).classList.toggle('aktif', panelDuzen.acik[ad]);
  });
  const a = panelDuzen.acik;
  document.getElementById('ayirici-1').hidden = !(a.porte && (a.kayan || a.klavye));
  document.getElementById('ayirici-2').hidden = !(a.kayan && a.klavye);
}

function panelDugmeleriKur() {
  PANEL_ADLARI.forEach((ad) => {
    document.getElementById(PANEL_DUGME[ad]).addEventListener('click', () => {
      const aciktiydi = panelDuzen.acik[ad];
      if (ad === 'klavye' && aciktiydi) {
        hepsiniBirak();
        if (klavyeKontrol) klavyeKontrol.sakla();
      }
      panelDuzen.acik[ad] = !aciktiydi;
      panelDuzenUygula();
      panelDuzenYaz();
      if (ad === 'klavye' && !aciktiydi && klavyeKontrol) klavyeKontrol.geriYukle();
      porteOlcekle();
      kayanYenile();
    });
  });

  document.getElementById('pn-sifirla').addEventListener('click', () => {
    panelDuzen = JSON.parse(JSON.stringify(PANEL_VARSAYILAN));
    panelDuzenUygula();
    panelDuzenYaz();
    if (klavyeKontrol) klavyeKontrol.geriYukle();
  });
}

function ayiriciKur(kimlik) {
  const ay = document.getElementById(kimlik);
  let d = null;

  ay.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const gorunur = PANEL_ADLARI.filter((ad) => panelDuzen.acik[ad]);
    let ust;
    let alt;
    if (kimlik === 'ayirici-1') {
      ust = 'porte';
      alt = panelDuzen.acik.kayan ? 'kayan' : 'klavye';
    } else {
      ust = 'kayan';
      alt = 'klavye';
    }
    const yuk = {};
    gorunur.forEach((ad) => {
      yuk[ad] = panelEl(ad).offsetHeight;
    });
    // Mevcut piksel yüksekliklerini ağırlık yap: oranlar değişmeden sabitlenir
    gorunur.forEach((ad) => {
      panelDuzen.agirlik[ad] = Math.max(yuk[ad], 1);
      panelEl(ad).style.flexGrow = String(panelDuzen.agirlik[ad]);
    });
    const enAz = (ad) => parseFloat(getComputedStyle(panelEl(ad)).minHeight) || 40;
    d = { ust: ust, alt: alt, yuk: yuk, y0: e.clientY, minU: enAz(ust), minA: enAz(alt) };
    try { ay.setPointerCapture(e.pointerId); } catch (err) {}
    ay.classList.add('surukle');
  });

  ay.addEventListener('pointermove', (e) => {
    if (!d) return;
    e.preventDefault();
    let dy = e.clientY - d.y0;
    dy = Math.min(Math.max(dy, d.minU - d.yuk[d.ust]), d.yuk[d.alt] - d.minA);
    panelDuzen.agirlik[d.ust] = d.yuk[d.ust] + dy;
    panelDuzen.agirlik[d.alt] = d.yuk[d.alt] - dy;
    panelEl(d.ust).style.flexGrow = String(panelDuzen.agirlik[d.ust]);
    panelEl(d.alt).style.flexGrow = String(panelDuzen.agirlik[d.alt]);
  });

  const bitir = () => {
    if (!d) return;
    d = null;
    ay.classList.remove('surukle');
    panelDuzenYaz();
  };
  ay.addEventListener('pointerup', bitir);
  ay.addEventListener('pointercancel', bitir);
  ay.addEventListener('lostpointercapture', bitir);
}

function panelDuzeniKur() {
  panelDuzenOku();
  panelDugmeleriKur();
  ayiriciKur('ayirici-1');
  ayiriciKur('ayirici-2');
  panelDuzenUygula();
  if (window.ResizeObserver) {
    new ResizeObserver(porteOlcekle).observe(document.getElementById('porte-kutu'));
  }
}

/* ---------- PERFORMANS (ÇALDIĞINI KONTROL) ---------- */
// Kontrol mantığı performans.js içindedir; burada yalnızca gereken bağlantılar verilir.

function performansKur() {
  if (!window.PERF) return;
  PERF.kur({
    hazirla: () => {
      olaylariHazirla();
      return { olaylar: cal.olaylar, baslangic: cal.baslangic, uzunluk: cal.uzunluk };
    },
    bpm: bpm,
    olcuVurusu: olcuVurusu,
    baglam: () => {
      sesBaslat();
      return ctx;
    },
    kayanCiz: kayanCiz,
    kayanYenile: kayanYenile,
    porteCizgi: porteCizgisiniKoy,
    porteTakip: porteyiTakipEt,
    tusEl: (midi) => (tuslar[midi] ? tuslar[midi].el : null),
    mikrofonMu: () => !!(window.GIRIS && GIRIS.mikrofonModu()),
    eserAdi: () => aktifEser.baslik,
    calmaDurdur: () => calmaDurdur(),
    bolumAyarla: (bas, son) => {
      bolumBas = bas;
      bolumSon = son;
      bolumDegisti();
    }
  });
}

/* ---------- DÜZENLEME ---------- */
// Düzenleme mantığı duzenle.js içindedir; burada yalnızca gereken bağlantılar verilir.

function duzenleKur() {
  if (!window.DUZ) return;
  DUZ.kur({
    eser: () => aktifEser,
    kayitId: () => aktifEserKayit,
    secili: () => seciliNotaId,
    seciliYap: (id) => {
      seciliNotaId = id;
      if (!id) klavyeIsaretiniTemizle();
    },
    yenile: () => {
      calmaDurdur();
      porteYenile();
      kayanYenile();
    },
    olcuDegisti: (eski) => {
      if (bolumSon === eski || bolumSon > aktifEser.olcuSayisi) bolumSon = aktifEser.olcuSayisi;
      if (bolumBas > bolumSon) bolumBas = bolumSon;
      calmaDurdur();
      bolumYaz();
      porteYenile();
      kayanYenile();
    },
    sesCal: (midi) => {
      notaCal(midi);
      setTimeout(() => {
        const kume = tusSahipleri[midi];
        if (!kume || kume.size === 0) notaBirak(midi);
      }, 500);
    },
    mesaj: (yazi) => {
      document.getElementById('nota-bilgi').textContent = yazi;
    },
    deneAcik: () => !!(window.PERF && PERF.aktif()),
    calmaDurdur: () => calmaDurdur(),
    kaydet: (eser, id) => window.notaKaydet(id, eser),
    kopyala: async () => {
      try {
        const kopya = JSON.parse(JSON.stringify(aktifEser));
        kopya.id = 'nota-' + Date.now().toString(36);
        kopya.baslik = String(aktifEser.baslik).slice(0, 100) + ' (kopya)';
        const id = await window.notaKayitOlustur(kopya);
        if (window.eserListesiYenile) window.eserListesiYenile();
        await eserAc(kopya, id);
      } catch (e) {
        document.getElementById('nota-bilgi').textContent =
          'Kopya oluşturulamadı: ' + (e && e.message ? e.message : 'bilinmeyen hata');
      }
    }
  });
}

/* ---------- SEKMELER ---------- */

let aktifSekme = 'cal';

function sekmeGoster(ad) {
  if (ad === aktifSekme) return;

  if (aktifSekme === 'cal') {
    calmaDuraklat();
    if (window.PERF) PERF.iptal();
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
  if (ad === 'cal') porteOlcekle();
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

/* ---------- GİRİŞ (MIDI / MİKROFON) VE KAYIT ---------- */
// MIDI ve mikrofon mantığı giris.js, kayıt mantığı kayit.js içindedir; burada yalnızca bağlantılar verilir.

const hariciSesli = new Set();   // uygulamanın sesiyle çalınan harici notalar

function girisBas(midi, an, kaynak) {
  if (!tuslar[midi]) return;
  hariciBasili.add(midi);
  basiliIsaretle(midi, true);
  // MIDI'de piyanonun kendi sesi varsa uygulama susar; mikrofonda hiç çalmaz (yankı olmasın)
  if (kaynak === 'midi' && window.GIRIS && GIRIS.midiSesi()) {
    notaCal(midi);
    hariciSesli.add(midi);
  }
  if (window.PERF) PERF.tusBasildi(midi, an);
  if (window.KAYIT) KAYIT.nota(midi, an, true);
  basiliNotalariYaz();
}

function girisBirak(midi, an, kaynak) {
  if (!tuslar[midi]) return;
  hariciBasili.delete(midi);
  const parmakVar = tusSahipleri[midi] && tusSahipleri[midi].size > 0;
  if (!parmakVar) basiliIsaretle(midi, false);
  if (hariciSesli.has(midi)) {
    hariciSesli.delete(midi);
    if (!parmakVar) notaBirak(midi);
  }
  if (window.KAYIT) KAYIT.nota(midi, an, false);
}

function girisKur() {
  if (!window.GIRIS) return;
  GIRIS.kur({
    bas: girisBas,
    birak: girisBirak,
    degisti: () => {
      Array.from(hariciBasili).forEach((m) => girisBirak(m, performance.now(), 'midi'));
    }
  });
}

function kayitKur() {
  if (!window.KAYIT) return;
  KAYIT.kur({
    bosEser: (ad, pay, payda, tempo, sayi) => window.NOTA_IC.bosEser(ad, pay, payda, tempo, sayi),
    kaydet: (eser) => window.notaKayitOlustur(eser),
    ac: (eser, id) => {
      if (window.eserListesiYenile) window.eserListesiYenile();
      window.eserAc(eser, id);
    },
    mesgul: () => {
      if (window.PERF && PERF.sahne()) return 'Önce Dene modunu kapat.';
      calmaDurdur();
      return null;
    },
    baglam: () => {
      sesBaslat();
      return ctx;
    },
    mikrofonMu: () => !!(window.GIRIS && GIRIS.mikrofonModu()),
    mesaj: (yazi) => {
      document.getElementById('nota-bilgi').textContent = yazi;
    }
  });
}

/* ---------- MENÜ ÇEKMECESİ VE GEÇİCİ BİLGİ YAZISI ---------- */

function cekmeceKur() {
  const cek = document.getElementById('cekmece');
  const perde = document.getElementById('cekmece-perde');
  const ac = (acik) => {
    cek.classList.toggle('acik', acik);
    cek.setAttribute('aria-hidden', acik ? 'false' : 'true');
    perde.hidden = !acik;
  };
  document.getElementById('kl-sigdir').addEventListener('click', () => {
    if (klavyeKontrol) klavyeKontrol.sigdir(aktifEser);
    ac(false);
  });
  document.getElementById('cekmece-ac').addEventListener('click', () => ac(!cek.classList.contains('acik')));
  document.getElementById('cekmece-kapat').addEventListener('click', () => ac(false));
  perde.addEventListener('click', () => ac(false));
  // Dene ve Düzenle başlayınca menü kendiliğinden kapanır
  ['btn-dene', 'btn-duzenle', 'ky-baslat'].forEach((id) => {
    document.getElementById(id).addEventListener('click', () => ac(false));
  });

  // Bilgi yazısı başlığın üstünde kısa süre görünür, sonra başlığa geri döner
  const bilgi = document.getElementById('nota-bilgi');
  const alan = document.getElementById('baslik-alan');
  let zaman = null;
  new MutationObserver(() => {
    const t = bilgi.textContent;
    if (!t || t === 'Bir tuşa ya da notaya dokun') return;
    alan.classList.add('bilgi-var');
    clearTimeout(zaman);
    zaman = setTimeout(() => alan.classList.remove('bilgi-var'), 2600);
  }).observe(bilgi, { childList: true, characterData: true, subtree: true });
}

/* ---------- BAŞLAT ---------- */

window.addEventListener('resize', porteOlcekle);
window.addEventListener('online', durumGuncelle);
window.addEventListener('offline', durumGuncelle);

klavyeOlustur();
cekmeceKur();
dokunmaKur();
gezinmeKur();
eserBasligiYaz();
elDugmeleriKur();
porteYenile();
if (klavyeKontrol) klavyeKontrol.sigdir(aktifEser);
calmaKur();
panelDuzeniKur();
kayanKur();
performansKur();
duzenleKur();
girisKur();
kayitKur();
kutuphaneKur();
sekmeleriKur();
sesKartiKur();
ayarlarKur();
durumGuncelle();
servisCalisaniKaydet();
sesleriBaslangictaYukle();
if (window.kutuphaneBaslat) window.kutuphaneBaslat();
