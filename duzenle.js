/*
  DÜZENLE (Aşama 9): porteye dokunarak nota ekleme, silme ve değiştirme
  - Boş porteye dokun: seçili süre ve perdede nota eklenir (sağ el üst porte, sol el alt porte)
  - Bir notaya dokun: seçilir; Sil, yarım ton, oktav, süre ve el değiştirme düğmeleri çalışır
  - Her değişiklik kütüphanedeki eserin kaydına otomatik yazılır; Geri al düğmesi vardır
  Her şey bir kapsülün içinde tutulur; dışarıya yalnızca window.DUZ verilir.
*/

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SURELER = [4, 2, 1, 0.5, 0.25];            // Bütün, yarım, dörtlük, sekizlik, onaltılık
  const SURE_ADLARI = ['Bütün', 'Yarım', 'Dörtlük', 'Sekizlik', 'Onaltılık'];
  const SURE_LISTESI = [0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.5, 2, 3, 4];  // Kısalt / Uzat sırası
  const DOGAL = [0, 2, 4, 5, 7, 9, 11];
  const ILK_MIDI = 21;
  const SON_MIDI = 108;
  const GERI_SINIRI = 25;

  let api = null;
  const D = {
    aktif: false,
    sureIdx: 2,        // varsayılan: dörtlük
    nokta: false,
    diyez: false,
    geri: [],
    zaman: null,
    kirli: false
  };

  function eser() {
    return api.eser();
  }

  function secili() {
    const id = api.secili();
    if (!id) return null;
    return eser().notalar.find((n) => n.id === id) || null;
  }

  function durumYaz(yazi) {
    $('duz-durum').textContent = yazi;
  }

  /* ---------- KAYDETME ---------- */

  function kaydetPlanla() {
    D.kirli = true;
    clearTimeout(D.zaman);
    D.zaman = setTimeout(kaydetHemen, 800);
  }

  async function kaydetHemen() {
    clearTimeout(D.zaman);
    D.zaman = null;
    if (!D.kirli) return;
    const id = api.kayitId();
    if (!id) return;
    D.kirli = false;
    try {
      await api.kaydet(eser(), id);
      durumYaz('Kaydedildi · ' + eser().notalar.length + ' nota');
    } catch (e) {
      D.kirli = true;
      durumYaz('Kaydedilemedi: ' + (e && e.message ? e.message : 'bilinmeyen hata'));
    }
  }

  /* ---------- GERİ AL ---------- */

  function anlikAl() {
    D.geri.push(JSON.stringify({ n: eser().notalar, o: eser().olcuSayisi }));
    if (D.geri.length > GERI_SINIRI) D.geri.shift();
    $('duz-geri').disabled = false;
  }

  function geriAl() {
    if (!D.geri.length) return;
    const s = JSON.parse(D.geri.pop());
    const e = eser();
    const eskiOlcu = e.olcuSayisi;
    e.notalar = s.n;
    e.olcuSayisi = s.o;
    if (api.secili() && !e.notalar.some((n) => n.id === api.secili())) api.seciliYap(null);
    $('duz-geri').disabled = D.geri.length === 0;
    uygula(eskiOlcu);
    durumYaz('Geri alındı');
  }

  // Değişiklikten sonra ekranı yeniler ve kaydı planlar
  function uygula(eskiOlcu) {
    if (eskiOlcu !== undefined && eskiOlcu !== eser().olcuSayisi) api.olcuDegisti(eskiOlcu);
    else api.yenile();
    kaydetPlanla();
    araclariYaz();
  }

  /* ---------- İŞLEMLER ---------- */

  function sonrakiId(el) {
    let en = -1;
    eser().notalar.forEach((n) => {
      const s = n.id.split('-');
      if (s[0] === el) {
        const k = parseInt(s[s.length - 1], 10);
        if (isFinite(k) && k > en) en = k;
      }
    });
    return el + '-' + (en + 1);
  }

  function toplamVurus() {
    const e = eser();
    return e.olcuSayisi * (e.olcu.pay * 4) / e.olcu.payda;
  }

  function notaEkle(el, midi, baslangic) {
    const e = eser();
    const taban = SURELER[D.sureIdx];
    let sure = taban * (D.nokta ? 1.5 : 1);
    const kalan = toplamVurus() - baslangic;
    if (kalan <= 0.01) return false;
    if (sure > kalan) sure = kalan;
    if (e.notalar.some((n) => n.el === el && n.midi === midi && Math.abs(n.baslangic - baslangic) < 0.01)) {
      durumYaz('Orada zaten aynı nota var.');
      return false;
    }
    if (e.notalar.length >= 3500) {
      durumYaz('En fazla 3500 nota eklenebilir.');
      return false;
    }
    anlikAl();
    const nota = { id: sonrakiId(el), el: el, midi: midi, baslangic: baslangic, sure: sure };
    e.notalar.push(nota);
    e.notalar.sort((a, b) => a.baslangic - b.baslangic || a.midi - b.midi);
    api.seciliYap(nota.id);
    return nota;
  }

  function sil() {
    const n = secili();
    if (!n) return;
    anlikAl();
    const e = eser();
    e.notalar = e.notalar.filter((x) => x.id !== n.id);
    api.seciliYap(null);
    uygula();
    durumYaz('Nota silindi');
  }

  function perdeDegistir(fark) {
    const n = secili();
    if (!n) return;
    const yeni = n.midi + fark;
    if (yeni < ILK_MIDI || yeni > SON_MIDI) {
      durumYaz('Piyano sınırı');
      return;
    }
    anlikAl();
    n.midi = yeni;
    uygula();
    api.sesCal(yeni);
  }

  function sureDegistir(yon) {
    const n = secili();
    if (!n) return;
    let en = 0;
    SURE_LISTESI.forEach((s, i) => {
      if (Math.abs(s - n.sure) < Math.abs(SURE_LISTESI[en] - n.sure)) en = i;
    });
    let hedef = en;
    if (Math.abs(SURE_LISTESI[en] - n.sure) > 0.001) {
      // Listede olmayan süre: yöne göre en yakın değere git
      hedef = yon > 0
        ? SURE_LISTESI.findIndex((s) => s > n.sure)
        : SURE_LISTESI.map((s) => s < n.sure).lastIndexOf(true);
      if (hedef < 0) return;
    } else {
      hedef = Math.min(Math.max(en + yon, 0), SURE_LISTESI.length - 1);
      if (hedef === en) return;
    }
    let sure = SURE_LISTESI[hedef];
    const kalan = toplamVurus() - n.baslangic;
    if (sure > kalan) sure = kalan;
    anlikAl();
    n.sure = sure;
    uygula();
  }

  function elDegistir() {
    const n = secili();
    if (!n) return;
    const yeniEl = n.el === 'sag' ? 'sol' : 'sag';
    if (eser().notalar.some((x) => x.el === yeniEl && x.midi === n.midi && Math.abs(x.baslangic - n.baslangic) < 0.01)) {
      durumYaz('Diğer elde aynı nota var.');
      return;
    }
    anlikAl();
    n.el = yeniEl;
    n.id = sonrakiId(yeniEl);
    api.seciliYap(n.id);
    uygula();
  }

  function olcuEkle() {
    const e = eser();
    if (e.olcuSayisi >= 2000) return;
    anlikAl();
    const eski = e.olcuSayisi;
    e.olcuSayisi++;
    uygula(eski);
    durumYaz('Ölçü eklendi (' + e.olcuSayisi + ')');
  }

  function olcuSil() {
    const e = eser();
    if (e.olcuSayisi <= 1) return;
    const ov = (e.olcu.pay * 4) / e.olcu.payda;
    const sinir = (e.olcuSayisi - 1) * ov;
    const icindekiler = e.notalar.filter((n) => n.baslangic >= sinir - 0.001);
    if (icindekiler.length && !confirm('Son ölçüde ' + icindekiler.length + ' nota var. Ölçü ve notalar silinsin mi?')) return;
    anlikAl();
    const eski = e.olcuSayisi;
    e.notalar = e.notalar.filter((n) => n.baslangic < sinir - 0.001);
    // Kalan notaların sonu yeni sınırı aşıyorsa kısalt
    e.notalar.forEach((n) => {
      if (n.baslangic + n.sure > sinir) n.sure = Math.max(sinir - n.baslangic, 0.0625);
    });
    e.olcuSayisi--;
    if (api.secili() && !e.notalar.some((n) => n.id === api.secili())) api.seciliYap(null);
    uygula(eski);
    durumYaz('Son ölçü silindi (' + e.olcuSayisi + ')');
  }

  /* ---------- PORTEYE DOKUNMA ---------- */

  function portedenEkle(ev) {
    if (!D.aktif || !api.kayitId()) return;
    if (ev.target.closest && ev.target.closest('.nota')) return;  // notaya dokunma: seçim
    const kutu = $('porte-kutu');
    const svg = kutu.querySelector('svg');
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const x = ((ev.clientX - r.left) / r.width) * vb.width;
    const y = ((ev.clientY - r.top) / r.height) * vb.height;

    const A = PORTE_AYAR;
    const sagAlt = PORTELER.sag.ust + 4 * A.aralik;
    const ortaY = (sagAlt + PORTELER.sol.ust) / 2;
    const el = y < ortaY ? 'sag' : 'sol';
    const P = PORTELER[el];
    const alt = P.ust + 4 * A.aralik;
    const adim = Math.round((alt - y) / A.yarim);
    const d = P.altNota + adim;
    const oktav = Math.floor(d / 7);
    const idx = ((d % 7) + 7) % 7;
    let midi = (oktav + 1) * 12 + DOGAL[idx] + (D.diyez ? 1 : 0);
    if (midi < ILK_MIDI || midi > SON_MIDI) {
      durumYaz('Piyano sınırları dışında');
      return;
    }

    const izgara = SURELER[D.sureIdx];
    const vurus = (x - 22 - A.sol) / A.vurus;
    const baslangic = Math.max(Math.round(vurus / izgara) * izgara, 0);
    if (baslangic >= toplamVurus() - 0.01) {
      durumYaz('Eserin sonundasın. Önce "＋ Ölçü" ile ölçü ekle.');
      return;
    }
    const nota = notaEkle(el, midi, baslangic);
    if (nota) {
      uygula();
      api.sesCal(midi);
      durumYaz('Nota eklendi');
    }
  }

  /* ---------- ARAYÜZ ---------- */

  function araclariYaz() {
    const duzenlenebilir = !!api.kayitId();
    const n = duzenlenebilir ? secili() : null;
    ['duz-yukari', 'duz-asagi', 'duz-oktav-yukari', 'duz-oktav-asagi', 'duz-kisalt', 'duz-uzat', 'duz-el', 'duz-sil']
      .forEach((id) => { $(id).disabled = !n; });
    $('duz-olcu-ekle').disabled = !duzenlenebilir;
    $('duz-olcu-sil').disabled = !duzenlenebilir;
    $('duz-geri').disabled = !duzenlenebilir || D.geri.length === 0;
    $('duz-araclar').hidden = !duzenlenebilir;
    $('duz-kopya').hidden = duzenlenebilir;
    SURELER.forEach((s, i) => $('ds-' + i).classList.toggle('aktif', D.sureIdx === i));
    $('duz-nokta').classList.toggle('aktif', D.nokta);
    $('duz-diyez').classList.toggle('aktif', D.diyez);
    $('btn-duzenle').classList.toggle('aktif', D.aktif);
    if (!duzenlenebilir && D.aktif) {
      durumYaz('Bu eser kütüphanede kayıtlı değil, bu yüzden düzenlenemez.');
    }
  }

  function ac() {
    if (api.deneAcik()) {
      api.mesaj('Önce 🎯 Dene modunu kapat.');
      return;
    }
    D.aktif = true;
    api.calmaDurdur();
    $('duzenle-cubugu').hidden = false;
    D.geri = [];
    araclariYaz();
    if (api.kayitId()) durumYaz('Boş porteye dokunarak nota ekle; bir notaya dokunarak seç.');
  }

  async function kapat() {
    if (!D.aktif) return;
    D.aktif = false;
    await kaydetHemen();
    $('duzenle-cubugu').hidden = true;
    araclariYaz();
  }

  function kur(apiNesnesi) {
    api = apiNesnesi;

    $('btn-duzenle').addEventListener('click', () => (D.aktif ? kapat() : ac()));

    SURELER.forEach((s, i) => {
      const b = $('ds-' + i);
      b.textContent = SURE_ADLARI[i];
      b.addEventListener('click', () => {
        D.sureIdx = i;
        araclariYaz();
      });
    });
    $('duz-nokta').addEventListener('click', () => {
      D.nokta = !D.nokta;
      araclariYaz();
    });
    $('duz-diyez').addEventListener('click', () => {
      D.diyez = !D.diyez;
      araclariYaz();
    });

    $('duz-yukari').addEventListener('click', () => perdeDegistir(1));
    $('duz-asagi').addEventListener('click', () => perdeDegistir(-1));
    $('duz-oktav-yukari').addEventListener('click', () => perdeDegistir(12));
    $('duz-oktav-asagi').addEventListener('click', () => perdeDegistir(-12));
    $('duz-kisalt').addEventListener('click', () => sureDegistir(-1));
    $('duz-uzat').addEventListener('click', () => sureDegistir(1));
    $('duz-el').addEventListener('click', elDegistir);
    $('duz-sil').addEventListener('click', sil);
    $('duz-geri').addEventListener('click', geriAl);
    $('duz-olcu-ekle').addEventListener('click', olcuEkle);
    $('duz-olcu-sil').addEventListener('click', olcuSil);
    $('duz-kopya').addEventListener('click', () => api.kopyala());

    $('porte-kutu').addEventListener('click', portedenEkle);

    // Seçim değişince araçları güncelle (notaya dokunma app.js'te notaSec ile olur)
    $('porte-kutu').addEventListener('click', () => setTimeout(araclariYaz, 0));

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) kaydetHemen();
    });
    window.addEventListener('pagehide', kaydetHemen);

    araclariYaz();
  }


  window.DUZ = {
    kur: kur,
    aktif: () => D.aktif,
    eserDegisti: () => {
      D.geri = [];
      D.kirli = false;
      clearTimeout(D.zaman);
      araclariYaz();
      if (D.aktif && api.kayitId()) durumYaz('Boş porteye dokunarak nota ekle; bir notaya dokunarak seç.');
    },
    kapat: kapat,
    kaydet: kaydetHemen
  };
})();
