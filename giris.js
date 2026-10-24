/*
  GİRİŞ (Aşama 13): ekran klavyesi, MIDI klavye ve mikrofon
  - Ekran klavyesi: her zaman çalışır.
  - MIDI: dijital piyano / MIDI klavye USB ile bağlanır (Web MIDI). Tuşa basma anı doğrudan bildirilir.
  - Mikrofon: tek sesli nota algılama (YIN yöntemi). Akor (aynı anda birçok nota) algılanamaz,
    en baskın ses alınır. Mikrofonla çalarken uygulamanın sesi kapalıdır (yankı olmasın diye).
  Her şey bir kapsülün içinde tutulur; dışarıya yalnızca window.GIRIS verilir.
*/

(function () {
  'use strict';

  const ANAHTAR = 'piyano-giris';
  const ADLAR = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
  const TUR_ADI = { ekran: 'Yalnızca ekran klavyesi', midi: 'MIDI klavye', mikrofon: 'Mikrofon' };

  const $ = (id) => document.getElementById(id);
  let api = null;

  const G = { tur: 'ekran', midiSes: false };
  const M = { erisim: null, liste: [], durum: 'Kapalı', son: '–' };
  const MIK = { ctx: null, akis: null, kaynak: null, analiz: null, zaman: null, alg: null, durum: 'Kapalı', son: '–', seviye: 0 };

  function notaAdi(midi) {
    return ADLAR[midi % 12] + (Math.floor(midi / 12) - 1);
  }

  /* ---------- AYAR ---------- */

  function ayarOku() {
    try {
      const v = JSON.parse(localStorage.getItem(ANAHTAR));
      if (!v) return;
      if (v.tur === 'ekran' || v.tur === 'midi' || v.tur === 'mikrofon') G.tur = v.tur;
      if (typeof v.midiSes === 'boolean') G.midiSes = v.midiSes;
    } catch (e) {}
  }

  function ayarYaz() {
    try {
      localStorage.setItem(ANAHTAR, JSON.stringify({ tur: G.tur, midiSes: G.midiSes }));
    } catch (e) {}
  }

  /* ---------- MIDI ---------- */

  function midiMesaj(e) {
    if (G.tur !== 'midi') return;
    const d = e.data;
    if (!d || d.length < 2) return;
    const komut = d[0] & 0xf0;
    const nota = d[1];
    const hiz = d.length > 2 ? d[2] : 0;

    let an = e.timeStamp;
    const simdi = performance.now();
    if (!(an > 0) || Math.abs(an - simdi) > 2000 || an > simdi) an = simdi;

    if (komut === 0xb0 && nota === 64) {   // sustain pedalı
      if (window.pedalAyarla) window.pedalAyarla(hiz >= 64, an);
      return;
    }
    if (komut === 0x90 && hiz > 0) {
      api.bas(nota, an, 'midi', hiz);
      M.son = notaAdi(nota) + ' (hız ' + hiz + ')';
      arayuzYaz();
    } else if (komut === 0x80 || (komut === 0x90 && hiz === 0)) {
      api.birak(nota, an, 'midi');
    }
  }

  function midiYenile() {
    const liste = [];
    M.erisim.inputs.forEach((giris) => {
      giris.onmidimessage = midiMesaj;
      if (giris.state === 'connected') liste.push(giris.name || 'MIDI girişi');
    });
    M.liste = liste;
    M.durum = liste.length
      ? 'Bağlı: ' + liste.join(', ')
      : 'Cihaz bulunamadı. Piyanoyu USB ile bağla ve aç.';
    arayuzYaz();
  }

  async function midiBaglan() {
    if (!navigator.requestMIDIAccess) {
      M.durum = 'Bu tarayıcı MIDI desteklemiyor. Uygulamayı Brave ya da Chrome\'da aç.';
      arayuzYaz();
      return;
    }
    M.durum = 'İzin isteniyor…';
    arayuzYaz();
    try {
      if (!M.erisim) {
        M.erisim = await navigator.requestMIDIAccess();
        M.erisim.onstatechange = midiYenile;
      }
      midiYenile();
    } catch (e) {
      M.erisim = null;
      M.durum = 'MIDI açılamadı: ' + (e && e.message ? e.message : 'izin verilmedi') +
        '. Acode\'un içindeki önizlemede MIDI çalışmaz; Brave ya da Chrome\'da dene.';
      arayuzYaz();
    }
  }

  /* ---------- MİKROFON: YIN ile perde (nota) bulma ---------- */

  // x: ses örnekleri, sr: örnekleme hızı. Dönüş: { f: frekans, netlik: 0..1 } ya da null
  function yin(x, sr) {
    const fMin = 60, fMax = 2100;
    const tauMax = Math.floor(sr / fMin);
    const tauMin = Math.max(2, Math.floor(sr / fMax));
    const W = Math.min(1536, x.length - tauMax - 1);
    if (W < 256) return null;
    const bas = x.length - W - tauMax - 1;
    const d = new Float32Array(tauMax + 1);
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) {
        const fark = x[bas + j] - x[bas + j + tau];
        s += fark * fark;
      }
      d[tau] = s;
    }
    const dn = new Float32Array(tauMax + 1);
    dn[0] = 1;
    let toplam = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      toplam += d[tau];
      dn[tau] = toplam > 0 ? (d[tau] * tau) / toplam : 1;
    }
    let tau = -1;
    for (let t = tauMin; t < tauMax; t++) {
      if (dn[t] < 0.15) {
        while (t + 1 < tauMax && dn[t + 1] < dn[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) {
      let en = tauMin;
      for (let t = tauMin; t < tauMax; t++) if (dn[t] < dn[en]) en = t;
      if (dn[en] > 0.35) return null;
      tau = en;
    }
    let tauYeni = tau;
    if (tau > 1 && tau < tauMax) {
      const a = dn[tau - 1], b = dn[tau], c = dn[tau + 1];
      const payda = a - 2 * b + c;
      if (Math.abs(payda) > 1e-9) tauYeni = tau + (a - c) / (2 * payda);
    }
    return { f: sr / tauYeni, netlik: 1 - dn[tau] };
  }

  // Kare kare gelen sesten "nota başladı / bitti" olayları üretir
  function Algilayici() {
    this.caliyor = null;
    this.aday = null;
    this.adayN = 0;
    this.sessiz = 0;
    this.oncekiRms = 0;
    this.taban = 0.003;
    this.vurusBekle = null;
    this.adayAn = 0;
  }

  Algilayici.prototype.besle = function (x, sr, an) {
    const olaylar = [];
    let ks = 0;
    const n = Math.min(2048, x.length);
    for (let i = x.length - n; i < x.length; i++) ks += x[i] * x[i];
    const rms = Math.sqrt(ks / n);
    const esik = Math.max(0.01, this.taban * 4);
    if (rms < esik) this.taban = this.taban * 0.98 + rms * 0.02;

    if (rms < esik) {
      this.sessiz++;
      this.aday = null;
      this.adayN = 0;
      if (this.caliyor !== null && this.sessiz >= 2) {
        olaylar.push({ tur: 'birak', midi: this.caliyor, an: an });
        this.caliyor = null;
      }
      this.oncekiRms = rms;
      return { olaylar: olaylar, rms: rms, midi: null };
    }
    this.sessiz = 0;

    const r = yin(x, sr);
    let midi = null;
    if (r && r.netlik > 0.75) {
      const m = Math.round(69 + 12 * Math.log2(r.f / 440));
      if (m >= 36 && m <= 96) midi = m;
    }

    // Önceki karede ses aniden güçlenmişti (yeni vuruş): bu karedeki perde güvenilirdir
    if (this.vurusBekle) {
      const vb = this.vurusBekle;
      this.vurusBekle = null;
      if (midi === null) {
        vb.n++;
        if (vb.n < 3) this.vurusBekle = vb;
      } else {
        if (this.caliyor !== null) olaylar.push({ tur: 'birak', midi: this.caliyor, an: vb.an });
        olaylar.push({ tur: 'bas', midi: midi, an: vb.an });
        this.caliyor = midi;
        this.aday = null;
        this.adayN = 0;
      }
      this.oncekiRms = rms;
      return { olaylar: olaylar, rms: rms, midi: this.caliyor };
    }

    if (this.caliyor !== null && rms > this.oncekiRms * 1.7 && rms > esik * 2) {
      this.vurusBekle = { an: an, n: 0 };
      this.oncekiRms = rms;
      return { olaylar: olaylar, rms: rms, midi: this.caliyor };
    }

    if (midi !== null && midi !== this.caliyor) {
      let sahte = false;
      if (this.caliyor !== null) {
        const fark = midi - this.caliyor;
        // Sönen notanın üst/alt katları (oktav, on ikili) yanlış nota sayılmasın
        if ([12, 19, 24, -12, -19, -24].indexOf(fark) >= 0 && rms <= this.oncekiRms * 1.3) sahte = true;
      }
      if (!sahte) {
        if (midi === this.aday) {
          this.adayN++;
        } else {
          this.aday = midi;
          this.adayN = 1;
          this.adayAn = an;
        }
        if (this.adayN >= 2) {
          if (this.caliyor !== null) olaylar.push({ tur: 'birak', midi: this.caliyor, an: this.adayAn });
          olaylar.push({ tur: 'bas', midi: midi, an: this.adayAn });
          this.caliyor = midi;
          this.aday = null;
          this.adayN = 0;
        }
      }
    } else {
      this.aday = null;
      this.adayN = 0;
    }
    this.oncekiRms = rms;
    return { olaylar: olaylar, rms: rms, midi: this.caliyor };
  };

  Algilayici.prototype.bitir = function (an) {
    const o = [];
    if (this.caliyor !== null) o.push({ tur: 'birak', midi: this.caliyor, an: an });
    this.caliyor = null;
    return o;
  };

  const ALGI_ARALIK = 35;       // ms
  const ALGI_GECIKME = 60;      // ms: pencere ve bekleme payı (nota anından geri çekilir)

  function mikrofonKare() {
    if (!MIK.analiz) return;
    const tampon = MIK.tampon;
    MIK.analiz.getFloatTimeDomainData(tampon);
    const an = performance.now() - ALGI_GECIKME;
    const s = MIK.alg.besle(tampon, MIK.ctx.sampleRate, an);
    MIK.seviye = Math.min(1, s.rms * 8);
    s.olaylar.forEach((o) => {
      if (o.tur === 'bas') {
        api.bas(o.midi, o.an, 'mikrofon');
        MIK.son = notaAdi(o.midi);
      } else {
        api.birak(o.midi, o.an, 'mikrofon');
      }
    });
    seviyeYaz();
  }

  async function mikrofonAc() {
    if (MIK.analiz) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      MIK.durum = 'Bu tarayıcı mikrofon kullanamıyor. Uygulamayı Brave ya da Chrome\'da (https adresinden) aç.';
      arayuzYaz();
      return;
    }
    MIK.durum = 'İzin isteniyor…';
    arayuzYaz();
    try {
      MIK.akis = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      const AC = window.AudioContext || window.webkitAudioContext;
      MIK.ctx = new AC();
      if (MIK.ctx.state === 'suspended') await MIK.ctx.resume();
      MIK.kaynak = MIK.ctx.createMediaStreamSource(MIK.akis);
      MIK.analiz = MIK.ctx.createAnalyser();
      MIK.analiz.fftSize = 4096;
      MIK.analiz.smoothingTimeConstant = 0;
      MIK.kaynak.connect(MIK.analiz);   // hoparlöre bağlanmaz: yankı olmaz
      MIK.tampon = new Float32Array(MIK.analiz.fftSize);
      MIK.alg = new Algilayici();
      MIK.zaman = setInterval(mikrofonKare, ALGI_ARALIK);
      MIK.durum = 'Dinliyor. Tek tek nota çal.';
    } catch (e) {
      mikrofonKapat();
      MIK.durum = 'Mikrofon açılamadı: ' + (e && e.message ? e.message : 'izin verilmedi');
    }
    arayuzYaz();
  }

  function mikrofonKapat() {
    if (MIK.zaman) clearInterval(MIK.zaman);
    MIK.zaman = null;
    if (MIK.alg) {
      const an = performance.now();
      MIK.alg.bitir(an).forEach((o) => api.birak(o.midi, o.an, 'mikrofon'));
    }
    try { if (MIK.akis) MIK.akis.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { if (MIK.ctx) MIK.ctx.close(); } catch (e) {}
    MIK.ctx = MIK.akis = MIK.kaynak = MIK.analiz = MIK.alg = null;
    MIK.seviye = 0;
    MIK.durum = 'Kapalı';
  }

  /* ---------- ARAYÜZ ---------- */

  function seviyeYaz() {
    const e = $('gi-seviye');
    if (e) e.value = MIK.seviye;
    const s = $('gi-mik-son');
    if (s && s.textContent !== 'Son algılanan: ' + MIK.son) s.textContent = 'Son algılanan: ' + MIK.son;
  }

  function arayuzYaz() {
    document.querySelectorAll('[data-giris]').forEach((b) => {
      b.classList.toggle('aktif', b.dataset.giris === G.tur);
    });
    const set = (id, yazi) => { const e = $(id); if (e) e.textContent = yazi; };
    const goster = (id, ac) => { const e = $(id); if (e) e.hidden = !ac; };
    set('gi-durum', G.tur === 'midi' ? M.durum : G.tur === 'mikrofon' ? MIK.durum : 'Ekran klavyesi hazır.');
    goster('gi-midi-kutu', G.tur === 'midi');
    goster('gi-mik-kutu', G.tur === 'mikrofon');
    set('gi-midi-son', 'Son basılan: ' + M.son);
    set('gi-midi-ses', 'Uygulamanın piyano sesi: ' + (G.midiSes ? 'açık' : 'kapalı'));
    seviyeYaz();
  }

  function turDegistir(yeni) {
    const eski = G.tur;
    if (yeni === eski) {
      if (yeni === 'midi') midiBaglan();
      if (yeni === 'mikrofon') mikrofonAc();
      return;
    }
    if (eski === 'mikrofon') mikrofonKapat();
    G.tur = yeni;
    ayarYaz();
    if (yeni === 'midi') midiBaglan();
    if (yeni === 'mikrofon') mikrofonAc();
    arayuzYaz();
    if (api.degisti) api.degisti();
  }

  function kur(apiNesnesi) {
    api = apiNesnesi;
    ayarOku();

    document.querySelectorAll('[data-giris]').forEach((b) => {
      b.addEventListener('click', () => turDegistir(b.dataset.giris));
    });
    const ses = $('gi-midi-ses');
    if (ses) {
      ses.addEventListener('click', () => {
        G.midiSes = !G.midiSes;
        ayarYaz();
        arayuzYaz();
      });
    }

    // Mikrofon izni sayfa her açıldığında yeniden istenir; ilk dokunuşta başlatılır
    if (G.tur === 'mikrofon') G.tur = 'ekran';
    arayuzYaz();
    if (G.tur === 'midi') midiBaglan();
  }

  window.GIRIS = {
    kur: kur,
    mikrofonModu: () => G.tur === 'mikrofon',
    midiModu: () => G.tur === 'midi',
    midiSesi: () => G.midiSes,
    bilgi: () => ({ tur: G.tur, midi: M.durum, mikrofon: MIK.durum }),
    _test: { yin: yin, Algilayici: Algilayici }
  };
})();
