/*
  KAYIT (Aşama 13): çaldığın notaları dinleyip porteye yazar
  - Kaynak ne olursa olsun (ekran klavyesi, MIDI, mikrofon) basılan her nota kaydedilir.
  - Başlayınca bir ölçü sayım yapılır (metronom tıklaması ya da ekranda sayı), sonra kayıt başlar.
  - Bitince notalar en yakın onaltılık vuruşa yuvarlanır, kütüphaneye yeni eser olarak eklenir
    ve açılır. Yanlışları ✏ Düzenle ile düzeltebilirsin.
  Her şey bir kapsülün içinde tutulur; dışarıya yalnızca window.KAYIT verilir.
*/

(function () {
  'use strict';

  const ANAHTAR = 'piyano-kayit';
  const OLCULER = { '4/4': [4, 4], '3/4': [3, 4], '2/4': [2, 4], '6/8': [6, 8] };
  const SURELER = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
  const KARE = 0.25;               // en küçük zaman birimi (onaltılık)
  const ONCE_PAYI = 120;           // ms: sayımın son anında biraz erken basılan nota kabul edilir

  const $ = (id) => document.getElementById(id);
  let api = null;

  const A = { tempo: 80, olcu: '4/4', metro: true };
  const K = {
    durum: 'bos',        // 'bos' | 'sayim' | 'kayit'
    t0: 0, msQ: 750, pay: 4, payda: 4,
    acik: {},            // midi -> başlangıç (ms)
    pedalOlay: [],       // { an, basili }
    pedalIlk: false,
    liste: [],           // { midi, bas, bit }
    zaman: null, sonrakiTik: 0, tikSayisi: 0, birimMs: 750, sayimTik: 0,
    ctx: null
  };

  /* ---------- AYAR ---------- */

  function ayarOku() {
    try {
      const v = JSON.parse(localStorage.getItem(ANAHTAR));
      if (!v) return;
      if (typeof v.tempo === 'number' && v.tempo >= 40 && v.tempo <= 200) A.tempo = Math.round(v.tempo);
      if (OLCULER[v.olcu]) A.olcu = v.olcu;
      if (typeof v.metro === 'boolean') A.metro = v.metro;
    } catch (e) {}
  }

  function ayarYaz() {
    try { localStorage.setItem(ANAHTAR, JSON.stringify(A)); } catch (e) {}
  }

  /* ---------- NOTALARI PORTEYE ÇEVİRME (saf işlev, test edilebilir) ---------- */

  function yakinSure(q) {
    let en = SURELER[0];
    SURELER.forEach((s) => {
      if (Math.abs(s - q) < Math.abs(en - q)) en = s;
    });
    return en;
  }

  // olaylar: [{ midi, bas, bit }] (ms), t0: kaydın sıfır anı (ms)
  function notalaraCevir(olaylar, t0, bpm, pay, payda) {
    const msQ = 60000 / bpm;
    const ov = (pay * 4) / payda;
    const ham = [];
    olaylar.forEach((o) => {
      if (!(o.midi >= 21 && o.midi <= 108)) return;
      const baslaQ = Math.max(0, (o.bas - t0) / msQ);
      const bitQ = Math.max(baslaQ, (o.bit - t0) / msQ);
      const bas = Math.round(baslaQ / KARE) * KARE;
      const sure = yakinSure(Math.max(bitQ - baslaQ, KARE));
      ham.push({ midi: o.midi, bas: bas, sure: sure });
    });
    ham.sort((a, b) => a.bas - b.bas || a.midi - b.midi);

    // Aynı nota üst üste biniyorsa kısalt, aynı anda aynı nota ise birini at
    const sonra = {};
    for (let i = ham.length - 1; i >= 0; i--) {
      const n = ham[i];
      const s = sonra[n.midi];
      if (s !== undefined) {
        if (s.bas === n.bas) { n.at = true; continue; }
        if (n.bas + n.sure > s.bas) n.sure = Math.max(s.bas - n.bas, KARE);
      }
      sonra[n.midi] = n;
    }
    const iyi = ham.filter((n) => !n.at);

    let son = 0;
    const sayac = { sag: 0, sol: 0 };
    const notalar = iyi.map((n) => {
      const el = n.midi >= 60 ? 'sag' : 'sol';
      if (n.bas + n.sure > son) son = n.bas + n.sure;
      return { id: el + '-' + sayac[el]++, el: el, midi: n.midi, baslangic: n.bas, sure: n.sure };
    });
    const olcuSayisi = Math.min(2000, Math.max(1, Math.ceil(son / ov - 1e-6)));
    return { notalar: notalar, olcuSayisi: olcuSayisi };
  }

  // olaylar: [{ an, basili }] (ms) -> [[basla, bit], ...] (vuruş, onaltılığa yuvarlı)
  function pedalCevir(olaylar, ilkDurum, t0, bitisMs, bpm, toplamVurus) {
    const msQ = 60000 / bpm;
    const q = (ms) => Math.min(toplamVurus, Math.max(0, Math.round(((ms - t0) / msQ) / KARE) * KARE));
    const aralik = [];
    let bas = ilkDurum ? 0 : null;
    olaylar.slice().sort((a, b) => a.an - b.an).forEach((o) => {
      if (o.basili && bas === null) bas = q(o.an);
      else if (!o.basili && bas !== null) {
        const bit = q(o.an);
        if (bit > bas) aralik.push([bas, bit]);
        bas = null;
      }
    });
    if (bas !== null) {
      const bit = Math.max(q(bitisMs), bas + KARE);
      if (bit > bas) aralik.push([bas, bit]);
    }
    return aralik;
  }

  // Dışarıdan: pedal basıldı / bırakıldı
  function pedal(basili, an) {
    if (K.durum === 'bos') return;
    if (K.durum === 'sayim' && an < K.t0) {
      K.pedalIlk = basili;               // sayım sırasında: kayıt başlarken pedalın durumu
    } else {
      K.pedalOlay.push({ an: Math.max(an, K.t0), basili: basili });
    }
  }

  /* ---------- METRONOM ---------- */

  function tikSesi(ms, vurgulu) {
    if (!K.ctx) return;
    try {
      const t = K.ctx.currentTime + Math.max(0, (ms - performance.now()) / 1000);
      const osc = K.ctx.createOscillator();
      const g = K.ctx.createGain();
      osc.frequency.value = vurgulu ? 1600 : 1100;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vurgulu ? 0.5 : 0.32, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      osc.connect(g);
      g.connect(K.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.08);
    } catch (e) {}
  }

  function sesliMetronom() {
    return A.metro && !(api.mikrofonMu && api.mikrofonMu());
  }

  /* ---------- KAYIT AKIŞI ---------- */

  function yaziGuncelle() {
    const dugme = $('kayit-bitir');
    const yazi = $('kayit-yazi');
    const iptal = $('kayit-iptal');
    const baslat = $('ky-baslat');
    const acik = K.durum !== 'bos';
    if (dugme) dugme.hidden = !acik;
    if (iptal) iptal.hidden = !acik;
    if (baslat) baslat.disabled = acik;
    if (!acik || !yazi) return;
    const simdi = performance.now();
    if (K.durum === 'sayim') {
      const kalan = Math.min(K.vurusOlcuda, Math.max(1, Math.ceil((K.t0 - simdi) / K.birimMs)));
      yazi.textContent = 'Sayım ' + kalan;
    } else {
      const q = Math.max(0, (simdi - K.t0) / K.msQ);
      const ov = (K.pay * 4) / K.payda;
      yazi.textContent = 'Ölçü ' + (Math.floor(q / ov) + 1) + ' · ' + K.liste.length + ' nota';
    }
  }

  function zamanlayici() {
    const simdi = performance.now();
    // Sesli tıklamalar: 300 ms ileriye kadar planla
    while (K.sonrakiTik * K.birimMs + K.sayimBas < simdi + 300) {
      const ms = K.sonrakiTik * K.birimMs + K.sayimBas;
      if (sesliMetronom()) tikSesi(ms, K.sonrakiTik % K.vurusOlcuda === 0);
      K.sonrakiTik++;
      if (K.sonrakiTik > 100000) break;
    }
    if (K.durum === 'sayim' && simdi >= K.t0) K.durum = 'kayit';
    yaziGuncelle();
  }

  function baslat() {
    if (K.durum !== 'bos') return;
    const neden = api.mesgul ? api.mesgul() : null;
    if (neden) {
      api.mesaj(neden);
      return;
    }
    const [pay, payda] = OLCULER[A.olcu];
    K.pay = pay;
    K.payda = payda;
    K.msQ = 60000 / A.tempo;
    const birimQ = payda === 8 && pay % 3 === 0 ? 1.5 : 4 / payda;
    K.birimMs = birimQ * K.msQ;
    K.vurusOlcuda = Math.round(((pay * 4) / payda) / birimQ);
    K.sayimBas = performance.now() + 400;
    K.t0 = K.sayimBas + K.vurusOlcuda * K.birimMs;
    K.sonrakiTik = 0;
    K.acik = {};
    K.liste = [];
    K.pedalOlay = [];
    K.pedalIlk = !!(window.pedalDurumu && window.pedalDurumu());
    K.durum = 'sayim';
    try {
      K.ctx = api.baglam ? api.baglam() : null;
    } catch (e) { K.ctx = null; }
    K.zaman = setInterval(zamanlayici, 25);
    zamanlayici();
    api.mesaj('Sayımdan sonra çalmaya başla.');
  }

  function durdur() {
    if (K.zaman) clearInterval(K.zaman);
    K.zaman = null;
  }

  function iptal() {
    if (K.durum === 'bos') return;
    durdur();
    K.durum = 'bos';
    K.acik = {};
    K.liste = [];
    yaziGuncelle();
    api.mesaj('Kayıt iptal edildi.');
  }

  async function bitir() {
    if (K.durum === 'bos') return;
    const simdi = performance.now();
    const sayimdaydi = K.durum === 'sayim';
    durdur();
    Object.keys(K.acik).forEach((m) => {
      K.liste.push({ midi: Number(m), bas: K.acik[m], bit: simdi });
    });
    K.acik = {};
    K.durum = 'bos';
    yaziGuncelle();

    if (sayimdaydi || !K.liste.length) {
      api.mesaj('Hiç nota kaydedilmedi.');
      return;
    }
    const sonuc = notalaraCevir(K.liste, K.t0, A.tempo, K.pay, K.payda);
    sonuc.pedal = pedalCevir(K.pedalOlay, K.pedalIlk, K.t0, simdi, A.tempo, sonuc.olcuSayisi * (K.pay * 4) / K.payda);
    if (!sonuc.notalar.length) {
      api.mesaj('Hiç nota kaydedilmedi.');
      return;
    }
    const d = new Date();
    const iki = (n) => (n < 10 ? '0' : '') + n;
    const ad = 'Kayıt ' + iki(d.getDate()) + '.' + iki(d.getMonth() + 1) + ' ' + iki(d.getHours()) + ':' + iki(d.getMinutes());
    try {
      const eser = api.bosEser(ad, K.pay, K.payda, A.tempo, sonuc.olcuSayisi);
      eser.notalar = sonuc.notalar;
      eser.olcuSayisi = sonuc.olcuSayisi;
      if (sonuc.pedal.length) eser.pedal = sonuc.pedal;
      const id = await api.kaydet(eser);
      api.mesaj('Kayıt eklendi: ' + sonuc.notalar.length + ' nota, ' + sonuc.olcuSayisi + ' ölçü' + (sonuc.pedal.length ? ', ' + sonuc.pedal.length + ' pedal' : '') + '.');
      api.ac(eser, id);
    } catch (e) {
      api.mesaj('Kayıt eklenemedi: ' + ((e && e.message) || e));
    }
  }

  // Dışarıdan: bir nota başladı (acik = true) ya da bitti (acik = false)
  function nota(midi, an, acik) {
    if (K.durum === 'bos') return;
    if (acik) {
      if (K.durum === 'sayim') {
        if (an < K.t0 - ONCE_PAYI) return;
        an = K.t0;
      }
      if (K.acik[midi] !== undefined) {
        K.liste.push({ midi: midi, bas: K.acik[midi], bit: an });
      }
      K.acik[midi] = an;
    } else {
      if (K.acik[midi] === undefined) return;
      K.liste.push({ midi: midi, bas: K.acik[midi], bit: Math.max(an, K.acik[midi]) });
      delete K.acik[midi];
    }
  }

  /* ---------- ARAYÜZ ---------- */

  function arayuzYaz() {
    const set = (id, yazi) => { const e = $(id); if (e) e.textContent = yazi; };
    set('ky-tempo-yazi', '♩ = ' + A.tempo);
    const sec = $('ky-olcu');
    if (sec) sec.value = A.olcu;
    const m = $('ky-metro');
    if (m) {
      m.classList.toggle('aktif', A.metro);
      m.textContent = 'Metronom: ' + (A.metro ? 'açık' : 'kapalı');
    }
    yaziGuncelle();
  }

  function kur(apiNesnesi) {
    api = apiNesnesi;
    ayarOku();
    const tempoDegistir = (d) => {
      A.tempo = Math.max(40, Math.min(200, A.tempo + d));
      ayarYaz();
      arayuzYaz();
    };
    $('ky-tempo-azalt').addEventListener('click', () => tempoDegistir(-5));
    $('ky-tempo-artir').addEventListener('click', () => tempoDegistir(5));
    $('ky-olcu').addEventListener('change', (e) => {
      if (OLCULER[e.target.value]) A.olcu = e.target.value;
      ayarYaz();
    });
    $('ky-metro').addEventListener('click', () => {
      A.metro = !A.metro;
      ayarYaz();
      arayuzYaz();
    });
    $('ky-baslat').addEventListener('click', baslat);
    $('kayit-bitir').addEventListener('click', bitir);
    $('kayit-iptal').addEventListener('click', iptal);
    arayuzYaz();
  }

  window.KAYIT = {
    kur: kur,
    nota: nota,
    pedal: pedal,
    kaydediyor: () => K.durum !== 'bos',
    _test: { notalaraCevir: notalaraCevir, pedalCevir: pedalCevir }
  };
})();
