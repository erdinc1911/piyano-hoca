/*
  NOTA VERİ MODELİ
  - Süreler ve başlangıçlar "vuruş" cinsindendir: 1 = dörtlük nota.
  - el: 'sag' (sağ el, sol anahtarı) veya 'sol' (sol el, fa anahtarı)
  - midi: 60 = orta Do (Do4)
*/

const NOTA_SURUMU = 1;

function elNotalari(el, liste) {
  // liste: [[midi, sure], ...] ardışık yazılır, başlangıçlar otomatik hesaplanır
  const sonuc = [];
  let baslangic = 0;
  liste.forEach((oge, i) => {
    sonuc.push({
      id: el + '-' + i,
      el: el,
      midi: oge[0],
      baslangic: baslangic,
      sure: oge[1]
    });
    baslangic += oge[1];
  });
  return sonuc;
}

function eserOlustur() {
  // Sevinç Ezgisi (Ode to Joy), Do majör, 4/4, 8 ölçü. Sol el basitleştirilmiştir.
  const E = 64, F = 65, G = 67, D = 62, C = 60;

  const sagOlcu1 = [[E, 1], [E, 1], [F, 1], [G, 1]];
  const sagOlcu2 = [[G, 1], [F, 1], [E, 1], [D, 1]];
  const sagOlcu3 = [[C, 1], [C, 1], [D, 1], [E, 1]];
  const sagOlcu4 = [[E, 1.5], [D, 0.5], [D, 2]];
  const sagOlcu8 = [[D, 1.5], [C, 0.5], [C, 2]];

  const sag = [].concat(
    sagOlcu1, sagOlcu2, sagOlcu3, sagOlcu4,
    sagOlcu1, sagOlcu2, sagOlcu3, sagOlcu8
  );

  const sol = [
    [48, 2], [55, 2],   // 1. ölçü: Do3, Sol3
    [43, 2], [50, 2],   // 2. ölçü: Sol2, Re3
    [48, 2], [55, 2],   // 3. ölçü
    [43, 2], [50, 2],   // 4. ölçü
    [48, 2], [55, 2],   // 5. ölçü
    [43, 2], [50, 2],   // 6. ölçü
    [48, 2], [55, 2],   // 7. ölçü
    [43, 2], [48, 2]    // 8. ölçü
  ];

  return {
    surum: NOTA_SURUMU,
    id: 'ornek-sevinc-ezgisi',
    baslik: 'Sevinç Ezgisi',
    besteci: 'L. v. Beethoven (kamu malı, basitleştirilmiş)',
    olcu: { pay: 4, payda: 4 },
    tempo: 90,
    olcuSayisi: 8,
    notalar: elNotalari('sag', sag).concat(elNotalari('sol', sol))
  };
}

const ORNEK_ESER = eserOlustur();