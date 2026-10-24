/*
  PORTE ÇİZİMİ (SVG)
  Üstte sağ el (sol anahtarı), altta sol el (fa anahtarı).
*/

const SVG_AD = 'http://www.w3.org/2000/svg';

const PORTE_AYAR = {
  aralik: 12,       // iki çizgi arası (piksel)
  yarim: 6,         // çizgi-boşluk arası
  vurus: 60,        // bir dörtlük vuruşun genişliği (piksel)
  sol: 100,         // anahtar ve ölçü işareti için soldaki boşluk
  sagBosluk: 24,
  yukseklik: 322
};

const PORTELER = {
  sag: { ust: 64,  altNota: 30, harf: 'G' }, // alt çizgi Mi4
  sol: { ust: 184, altNota: 18, harf: 'F' }  // alt çizgi Sol2
};

const HARF_INDEKS = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const SIYAH_PC = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

let PORTE_CIZGI = null; // çalma sırasında ilerleyen kırmızı çizgi

function svgEl(ad, ozellik, ust) {
  const e = document.createElementNS(SVG_AD, ad);
  for (const k in ozellik) e.setAttribute(k, ozellik[k]);
  if (ust) ust.appendChild(e);
  return e;
}

function svgCizgi(ust, x1, y1, x2, y2, renk, kalinlik) {
  return svgEl('line', {
    x1: x1, y1: y1, x2: x2, y2: y2,
    stroke: renk, 'stroke-width': kalinlik
  }, ust);
}

function svgYazi(ust, yazi, ozellik) {
  const t = svgEl('text', ozellik, ust);
  t.textContent = yazi;
  return t;
}

function diyatonik(midi) {
  return (Math.floor(midi / 12) - 1) * 7 + HARF_INDEKS[midi % 12];
}

function figur(sure) {
  const tablo = [
    [4,    { bos: true,  sap: false, bayrak: 0, nokta: false }],
    [3,    { bos: true,  sap: true,  bayrak: 0, nokta: true }],
    [2,    { bos: true,  sap: true,  bayrak: 0, nokta: false }],
    [1.5,  { bos: false, sap: true,  bayrak: 0, nokta: true }],
    [1,    { bos: false, sap: true,  bayrak: 0, nokta: false }],
    [0.75, { bos: false, sap: true,  bayrak: 1, nokta: true }],
    [0.5,  { bos: false, sap: true,  bayrak: 1, nokta: false }],
    [0.375, { bos: false, sap: true, bayrak: 2, nokta: true }],
    [0.25, { bos: false, sap: true,  bayrak: 2, nokta: false }],
    [0.125, { bos: false, sap: true, bayrak: 3, nokta: false }]
  ];
  let en = tablo[0];
  tablo.forEach((t) => {
    if (Math.abs(t[0] - sure) < Math.abs(en[0] - sure)) en = t;
  });
  return en[1];
}

// Verilen vuruş konumunun porte üzerindeki yatay yeri (piksel)
function porteVurusX(vurus) {
  return PORTE_AYAR.sol + vurus * PORTE_AYAR.vurus + 8;
}

// Kırmızı ilerleme çizgisini yerleştirir. vurus = null ise gizler.
function porteCizgisiniKoy(vurus) {
  if (!PORTE_CIZGI) return;
  if (vurus === null || vurus === undefined) {
    PORTE_CIZGI.setAttribute('visibility', 'hidden');
    return;
  }
  const x = porteVurusX(vurus);
  PORTE_CIZGI.setAttribute('x1', x);
  PORTE_CIZGI.setAttribute('x2', x);
  PORTE_CIZGI.setAttribute('visibility', 'visible');
}

const EL_RENK = { sag: '#1d5fbf', sol: '#c2620a' };
const PARCA_DEGERLERI = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.375, 0.25, 0.125];

// Bir notayı gösterim parçalarına böler: ölçü çizgisini aşan ya da standart olmayan süreler
// birbirine bağlı (ligatür) birkaç nota olarak görünür. Çalma verisi değişmez.
function notaParcala(n, olcuVurus) {
  const parcalar = [];
  let bas = n.baslangic;
  let kalan = n.sure;
  let ilk = true;
  while (kalan >= 0.1) {
    if (!ilk && kalan < 0.2) break;
    const olcuSonu = (Math.floor(bas / olcuVurus + 1e-6) + 1) * olcuVurus;
    let tavan = Math.min(kalan, olcuSonu - bas);
    if (tavan < 0.1) {
      if (!ilk) break;
      tavan = 0.125;
    }
    let v = 0;
    for (let i = 0; i < PARCA_DEGERLERI.length; i++) {
      if (PARCA_DEGERLERI[i] <= tavan + 0.06) { v = PARCA_DEGERLERI[i]; break; }
    }
    if (!v) break;
    parcalar.push({ n: n, baslangic: bas, sure: v, ilk: ilk });
    bas += v;
    kalan -= v;
    ilk = false;
  }
  if (!parcalar.length) parcalar.push({ n: n, baslangic: n.baslangic, sure: 0.125, ilk: true });
  return parcalar;
}

function parcaKonum(c) {
  const A = PORTE_AYAR;
  const P = PORTELER[c.n.el];
  const alt = P.ust + 4 * A.aralik;
  c.p = diyatonik(c.n.midi) - P.altNota;   // 0 = alt çizgi, 8 = üst çizgi
  c.y = alt - c.p * A.yarim;
  c.x = A.sol + c.baslangic * A.vurus + 22;
  c.alt = alt;
}

// Nota başı (sap, kiriş ve bayraklar ayrı çizilir)
function notaCiz(ust, c, secili, tikla) {
  const A = PORTE_AYAR;
  const n = c.n;
  const p = c.p;
  const x = c.x;
  const y = c.y;
  const alt = c.alt;
  const f = figur(c.sure);

  const g = svgEl('g', {
    'class': 'nota el-' + n.el + (secili ? ' secili' : '') + (c.ilk ? '' : ' devam'),
    'data-id': n.id
  }, ust);
  svgEl('circle', { cx: x, cy: y, r: 17, fill: 'transparent' }, g);
  svgEl('circle', { cx: x, cy: y, r: 16, 'class': 'vurgu' }, g);
  if (secili) {
    svgEl('circle', { cx: x, cy: y, r: 15, fill: 'rgba(255,200,0,0.5)' }, g);
  }

  // Yardımcı çizgiler
  if (p < 0) {
    for (let q = -2; q >= p; q -= 2) {
      const yy = alt - q * A.yarim;
      svgCizgi(g, x - 14, yy, x + 14, yy, '#444', 1.4);
    }
  }
  if (p > 8) {
    for (let q = 10; q <= p; q += 2) {
      const yy = alt - q * A.yarim;
      svgCizgi(g, x - 14, yy, x + 14, yy, '#444', 1.4);
    }
  }

  // Diyez (bağlı devam notalarında tekrarlanmaz)
  if (c.ilk && SIYAH_PC[n.midi % 12]) {
    svgYazi(g, '♯', {
      x: x - 22, y: y, 'font-size': 20,
      'text-anchor': 'middle', 'dominant-baseline': 'central',
      fill: 'currentColor'
    });
  }

  svgEl('ellipse', {
    cx: x, cy: y, rx: 7.5, ry: 5.5,
    transform: 'rotate(-20 ' + x + ' ' + y + ')',
    fill: f.bos ? '#fdfcf6' : 'currentColor',
    stroke: 'currentColor', 'stroke-width': 1.8
  }, g);

  if (f.nokta) {
    svgEl('circle', { cx: x + 13, cy: y - 4, r: 2, fill: 'currentColor' }, g);
  }

  g.addEventListener('click', () => tikla(n));
}

// Saplar, kirişler, bayraklar ve ligatür yayları (dokunmaya kapalı üst katman)
function sapKirisCiz(svg, parcalar, olcu) {
  const A = PORTE_AYAR;
  const SAP = 40;
  const olaylar = {};
  parcalar.forEach((c) => {
    const k = c.n.el + '|' + Math.round(c.baslangic * 1000);
    if (!olaylar[k]) olaylar[k] = { el: c.n.el, bas: c.baslangic, x: c.x, parcalar: [] };
    olaylar[k].parcalar.push(c);
  });
  const liste = Object.keys(olaylar).map((k) => olaylar[k]);
  liste.forEach((o) => {
    let yUst = Infinity, yAlt = -Infinity, pMax = -Infinity, pMin = Infinity, kisa = Infinity, uzun = 0;
    o.parcalar.forEach((c) => {
      yUst = Math.min(yUst, c.y); yAlt = Math.max(yAlt, c.y);
      pMax = Math.max(pMax, c.p); pMin = Math.min(pMin, c.p);
      kisa = Math.min(kisa, c.sure); uzun = Math.max(uzun, c.sure);
    });
    o.yUst = yUst; o.yAlt = yAlt; o.kisa = kisa;
    o.sapVar = kisa < 4;
    o.asagi = (pMax - 4) >= (4 - pMin);
    o.bayrak = figur(kisa).bayrak;
  });

  const kat = svgEl('g', { 'pointer-events': 'none' }, svg);

  function sapUcuHesapla(o) {
    o.sx = o.asagi ? o.x - 7 : o.x + 7;
    o.bas0 = o.asagi ? o.yUst : o.yAlt;                 // sapın başladığı yer
    o.uc = o.asagi ? o.yAlt + SAP : o.yUst - SAP;       // varsayılan uç
  }

  // Kiriş zincirleri: aynı elde, aynı vuruş grubunda, aralıksız ardışık sekizlik/onaltılık
  const grupBoyu = (olcu.payda === 8 && olcu.pay >= 6 && olcu.pay % 3 === 0) ? 1.5 : 1;
  ['sag', 'sol'].forEach((el) => {
    const o = liste.filter((e) => e.el === el && e.sapVar).sort((a, b) => a.bas - b.bas);
    let zincir = [];
    const zincirler = [];
    const bitir = () => { if (zincir.length >= 2) zincirler.push(zincir); zincir = []; };
    o.forEach((e) => {
      if (e.bayrak < 1) { bitir(); return; }
      if (zincir.length) {
        const onceki = zincir[zincir.length - 1];
        const ayniGrup = Math.floor((e.bas + 1e-6) / grupBoyu) === Math.floor((onceki.bas + 1e-6) / grupBoyu);
        const bitisik = e.bas - onceki.bas <= onceki.kisa + 0.01;
        if (!ayniGrup || !bitisik) bitir();
      }
      zincir.push(e);
    });
    bitir();
    zincirler.forEach((z) => {
      let oy = 0;
      z.forEach((e) => { oy += e.asagi ? 1 : -1; });
      const asagi = oy > 0 || (oy === 0 && z[0].asagi);
      z.forEach((e) => { e.asagi = asagi; e.zincir = z; });
    });
    o.forEach((e) => sapUcuHesapla(e));
    zincirler.forEach((z) => {
      const ilk = z[0], son = z[z.length - 1];
      const dx = son.sx - ilk.sx;
      const egim = Math.max(-12, Math.min(12, son.uc - ilk.uc));
      const asagi = ilk.asagi;
      let c = asagi ? -Infinity : Infinity;
      z.forEach((e) => {
        e.s = dx ? egim * (e.sx - ilk.sx) / dx : 0;
        const aday = e.uc - e.s;
        c = asagi ? Math.max(c, aday) : Math.min(c, aday);
      });
      z.forEach((e) => { e.uc = c + e.s; });
      const m = dx ? egim / dx : 0;
      const yAt = (x) => ilk.uc + (x - ilk.sx) * m;
      const renk = EL_RENK[el];
      const ic = asagi ? -2.5 : 2.5;     // kiriş kalınlığı notaya doğru
      svgCizgi(kat, ilk.sx - 0.9, yAt(ilk.sx - 0.9) + ic, son.sx + 0.9, yAt(son.sx + 0.9) + ic, renk, 5);
      // üçüncü kiriş (otuzikilikler)
      {
        const kayma3 = asagi ? -15 : 15;
        let i3 = 0;
        while (i3 < z.length) {
          if (z[i3].bayrak < 3) { i3++; continue; }
          let j3 = i3;
          while (j3 + 1 < z.length && z[j3 + 1].bayrak >= 3) j3++;
          if (j3 > i3) {
            svgCizgi(kat, z[i3].sx, yAt(z[i3].sx) + kayma3, z[j3].sx, yAt(z[j3].sx) + kayma3, renk, 4);
          } else {
            const yon3 = i3 > 0 ? -1 : 1;
            const x3 = z[i3].sx + yon3 * 10;
            svgCizgi(kat, z[i3].sx, yAt(z[i3].sx) + kayma3, x3, yAt(x3) + kayma3, renk, 4);
          }
          i3 = j3 + 1;
        }
      }
      // ikinci kiriş (onaltılıklar)
      const kayma = asagi ? -9.5 : 9.5;
      let i = 0;
      while (i < z.length) {
        if (z[i].bayrak < 2) { i++; continue; }
        let j = i;
        while (j + 1 < z.length && z[j + 1].bayrak >= 2) j++;
        if (j > i) {
          svgCizgi(kat, z[i].sx, yAt(z[i].sx) + kayma, z[j].sx, yAt(z[j].sx) + kayma, renk, 4);
        } else {
          const yon = i > 0 ? -1 : 1;
          const x2 = z[i].sx + yon * 10;
          svgCizgi(kat, z[i].sx, yAt(z[i].sx) + kayma, x2, yAt(x2) + kayma, renk, 4);
        }
        i = j + 1;
      }
    });
  });

  // Saplar ve (kirişsiz notalar için) bayraklar
  liste.forEach((e) => {
    if (!e.sapVar) return;
    if (e.sx === undefined) sapUcuHesapla(e);
    const renk = EL_RENK[e.el];
    svgCizgi(kat, e.sx, e.bas0, e.sx, e.uc, renk, 1.8);
    if (!e.zincir) {
      for (let i = 0; i < e.bayrak; i++) {
        const yy = e.uc + (e.asagi ? -i * 7 : i * 7);
        const yol = e.asagi
          ? 'M' + e.sx + ' ' + yy + ' q 12 -6 7 -20'
          : 'M' + e.sx + ' ' + yy + ' q 12 6 7 20';
        svgEl('path', { d: yol, fill: 'none', stroke: renk, 'stroke-width': 2 }, kat);
      }
    }
  });

  // Ligatür yayları: aynı notanın ardışık parçaları arasında
  const sonrakiOlay = {};
  liste.forEach((e) => e.parcalar.forEach((c) => { c.olay = e; }));
  const notaParcalari = {};
  parcalar.forEach((c) => {
    (notaParcalari[c.n.id] = notaParcalari[c.n.id] || []).push(c);
  });
  Object.keys(notaParcalari).forEach((id) => {
    const dizi = notaParcalari[id];
    for (let i = 0; i + 1 < dizi.length; i++) {
      const a = dizi[i], b = dizi[i + 1];
      const yan = a.olay.sapVar && a.olay.asagi ? -1 : 1;
      const y0 = a.y + yan * 8;
      const yol = 'M' + (a.x + 3) + ' ' + y0 + ' Q' + ((a.x + b.x) / 2) + ' ' + (y0 + yan * 12) + ' ' + (b.x - 3) + ' ' + y0;
      svgEl('path', { d: yol, fill: 'none', stroke: EL_RENK[a.n.el], 'stroke-width': 1.8 }, kat);
    }
  });
}

// Bölüm gölgesini yerleştirir (tüm eser seçiliyse gizler)
function golgeKoy(golge, eser, bBas, bSon) {
  const A = PORTE_AYAR;
  const olcuVurus = eser.olcu.pay * 4 / eser.olcu.payda;
  if (bBas > 1 || bSon < eser.olcuSayisi) {
    const gx1 = A.sol + (bBas - 1) * olcuVurus * A.vurus;
    const gx2 = A.sol + bSon * olcuVurus * A.vurus;
    golge.setAttribute('x', gx1);
    golge.setAttribute('width', gx2 - gx1);
    golge.setAttribute('visibility', 'visible');
  } else {
    golge.setAttribute('visibility', 'hidden');
  }
}

// Porteyi yeniden çizmeden yalnızca bölüm gölgesini günceller
function porteGolgeGuncelle(kutu, eser, bBas, bSon) {
  const g = kutu.querySelector('.bolum-golge');
  if (g) golgeKoy(g, eser, bBas, bSon);
}

/*
  porteCiz(kutu, eser, sec)
  sec = {
    sag: true/false, sol: true/false,
    seciliId: '...', tikla: function(nota),
    bolumBas: 1, bolumSon: 8   (ölçü numaraları, 1'den başlar)
  }
*/
function porteCiz(kutu, eser, sec) {
  const A = PORTE_AYAR;
  const solKonum = kutu.scrollLeft;
  const ustKonum = kutu.scrollTop;

  const olcuVurus = eser.olcu.pay * 4 / eser.olcu.payda;
  const toplam = eser.olcuSayisi * olcuVurus;
  const bitisX = A.sol + toplam * A.vurus;
  const genislik = bitisX + A.sagBosluk;

  const svg = svgEl('svg', {
    width: genislik,
    height: A.yukseklik,
    viewBox: '0 0 ' + genislik + ' ' + A.yukseklik
  });

  const altPorteAlt = PORTELER.sol.ust + 4 * A.aralik;

  // Seçili bölümün gölgesi (tüm eser seçiliyse görünmez; kaydırırken yalnızca bu şekil güncellenir)
  const golge = svgEl('rect', {
    'class': 'bolum-golge',
    y: PORTELER.sag.ust - 26,
    height: altPorteAlt - PORTELER.sag.ust + 52,
    fill: 'rgba(255, 200, 0, 0.18)'
  }, svg);
  golgeKoy(golge, eser, sec.bolumBas || 1, sec.bolumSon || eser.olcuSayisi);

  // Porte çizgileri, anahtar harfleri, ölçü işareti
  ['sag', 'sol'].forEach((ad) => {
    const P = PORTELER[ad];
    for (let i = 0; i < 5; i++) {
      const yy = P.ust + i * A.aralik;
      svgCizgi(svg, 8, yy, bitisX, yy, '#444', 1.2);
    }
    const anahtarY = ad === 'sag'
      ? P.ust + 3 * A.aralik   // Sol çizgisi (alttan 2.)
      : P.ust + 1 * A.aralik;  // Fa çizgisi (üstten 2.)
    svgYazi(svg, P.harf, {
      x: 34, y: anahtarY, 'font-size': 50,
      'font-family': 'Georgia, serif', 'font-style': 'italic', 'font-weight': 'bold',
      'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#333'
    });
    svgYazi(svg, String(eser.olcu.pay), {
      x: 76, y: P.ust + A.aralik, 'font-size': 26, 'font-weight': 'bold',
      'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#333'
    });
    svgYazi(svg, String(eser.olcu.payda), {
      x: 76, y: P.ust + 3 * A.aralik, 'font-size': 26, 'font-weight': 'bold',
      'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#333'
    });
  });

  // Başlangıç çizgisi ve ölçü çizgileri (iki porteyi birleştirir)
  svgCizgi(svg, 8, PORTELER.sag.ust, 8, altPorteAlt, '#444', 2);
  for (let b = 1; b <= eser.olcuSayisi; b++) {
    const bx = A.sol + b * olcuVurus * A.vurus;
    if (b === eser.olcuSayisi) {
      svgCizgi(svg, bx - 5, PORTELER.sag.ust, bx - 5, altPorteAlt, '#444', 1.2);
      svgCizgi(svg, bx, PORTELER.sag.ust, bx, altPorteAlt, '#444', 4);
    } else {
      svgCizgi(svg, bx, PORTELER.sag.ust, bx, altPorteAlt, '#444', 1.2);
    }
  }

  // Ölçü numaraları
  for (let b = 0; b < eser.olcuSayisi; b++) {
    svgYazi(svg, String(b + 1), {
      x: A.sol + b * olcuVurus * A.vurus + 4, y: 16, 'font-size': 12, fill: '#888'
    });
  }

  // Notalar
  const parcalar = [];
  eser.notalar.forEach((n) => {
    if (!sec[n.el]) return;
    notaParcala(n, olcuVurus).forEach((c) => {
      parcaKonum(c);
      parcalar.push(c);
      notaCiz(svg, c, n.id === sec.seciliId, sec.tikla);
    });
  });
  sapKirisCiz(svg, parcalar, eser.olcu);

  // Pedal işaretleri (alt porte altında: Ped. ____/\____ *)
  if (Array.isArray(eser.pedal) && eser.pedal.length) {
    const py = altPorteAlt + 66;
    eser.pedal.forEach((r) => {
      const x1 = A.sol + r[0] * A.vurus + 22;
      const x2 = Math.max(A.sol + r[1] * A.vurus + 22, x1 + 14);
      svgYazi(svg, 'Ped.', {
        x: x1, y: py + 4, 'font-size': 14, 'font-style': 'italic',
        'font-family': 'Georgia, serif', 'font-weight': 'bold', fill: '#7a5a1a'
      });
      const ba = x1 + 30;
      if (x2 > ba + 6) {
        svgCizgi(svg, ba, py, x2, py, '#7a5a1a', 1.5);
        svgCizgi(svg, x2, py, x2, py - 8, '#7a5a1a', 1.5);
      }
    });
  }

  // İlerleme çizgisi (en üstte, başta gizli)
  PORTE_CIZGI = svgEl('line', {
    x1: 0, x2: 0,
    y1: PORTELER.sag.ust - 16, y2: altPorteAlt + 16,
    stroke: '#e11d48', 'stroke-width': 2.5,
    'pointer-events': 'none', visibility: 'hidden'
  }, svg);

  kutu.replaceChildren(svg);
  kutu.scrollLeft = solKonum;
  kutu.scrollTop = ustKonum;
}