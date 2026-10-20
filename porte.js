/*
  PORTE ÇİZİMİ (SVG)
  Üstte sağ el (sol anahtarı), altta sol el (fa anahtarı).
*/

const SVG_AD = 'http://www.w3.org/2000/svg';

const PORTE_AYAR = {
  aralik: 12,       // iki çizgi arası (piksel)
  yarim: 6,         // çizgi-boşluk arası
  vurus: 48,        // bir dörtlük vuruşun genişliği (piksel)
  sol: 100,         // anahtar ve ölçü işareti için soldaki boşluk
  sagBosluk: 24,
  yukseklik: 290
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
    [0.25, { bos: false, sap: true,  bayrak: 2, nokta: false }]
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

function notaCiz(ust, n, secili, tikla) {
  const A = PORTE_AYAR;
  const P = PORTELER[n.el];
  const alt = P.ust + 4 * A.aralik;
  const p = diyatonik(n.midi) - P.altNota; // 0 = alt çizgi, 8 = üst çizgi
  const y = alt - p * A.yarim;
  const x = A.sol + n.baslangic * A.vurus + 22;
  const f = figur(n.sure);

  const g = svgEl('g', {
    'class': 'nota el-' + n.el + (secili ? ' secili' : ''),
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

  // Diyez
  if (SIYAH_PC[n.midi % 12]) {
    svgYazi(g, '♯', {
      x: x - 22, y: y, 'font-size': 20,
      'text-anchor': 'middle', 'dominant-baseline': 'central',
      fill: 'currentColor'
    });
  }

  // Nota başı
  svgEl('ellipse', {
    cx: x, cy: y, rx: 7.5, ry: 5.5,
    transform: 'rotate(-20 ' + x + ' ' + y + ')',
    fill: f.bos ? '#fdfcf6' : 'currentColor',
    stroke: 'currentColor', 'stroke-width': 1.8
  }, g);

  // Nokta
  if (f.nokta) {
    svgEl('circle', { cx: x + 13, cy: y - 4, r: 2, fill: 'currentColor' }, g);
  }

  // Sap ve bayrak
  if (f.sap) {
    const asagi = p >= 4;
    const sx = asagi ? x - 7 : x + 7;
    const ey = asagi ? y + 40 : y - 40;
    svgCizgi(g, sx, y, sx, ey, 'currentColor', 1.8);
    for (let i = 0; i < f.bayrak; i++) {
      const yy = ey + (asagi ? -i * 7 : i * 7);
      const yol = asagi
        ? 'M' + sx + ' ' + yy + ' q 12 -6 7 -20'
        : 'M' + sx + ' ' + yy + ' q 12 6 7 20';
      svgEl('path', {
        d: yol, fill: 'none', stroke: 'currentColor', 'stroke-width': 2
      }, g);
    }
  }

  g.addEventListener('click', () => tikla(n));
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

  // Seçili bölümün gölgesi (tüm eser seçiliyse çizilmez)
  const bBas = sec.bolumBas || 1;
  const bSon = sec.bolumSon || eser.olcuSayisi;
  if (bBas > 1 || bSon < eser.olcuSayisi) {
    const gx1 = A.sol + (bBas - 1) * olcuVurus * A.vurus;
    const gx2 = A.sol + bSon * olcuVurus * A.vurus;
    svgEl('rect', {
      x: gx1, y: PORTELER.sag.ust - 26,
      width: gx2 - gx1, height: altPorteAlt - PORTELER.sag.ust + 52,
      fill: 'rgba(255, 200, 0, 0.18)'
    }, svg);
  }

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
  eser.notalar.forEach((n) => {
    if (!sec[n.el]) return;
    notaCiz(svg, n, n.id === sec.seciliId, sec.tikla);
  });

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