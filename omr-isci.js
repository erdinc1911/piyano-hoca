/*
  NOTA OKUMA İŞÇİSİ (arka plan): Pyodide (tarayıcıda Python) ile oemer'in nota çözümleme hattını çalıştırır.
  Ana sayfa ile mesajlaşır; ekranı dondurmaz.
  Mesajlar:
    {t:'baslat', pyodideTaban, zipAdres, svmAdres}    -> {t:'hazir'} | {t:'hata'}
    {t:'calis', h1, h2, goruntu, h, w, deskew, baslik} -> {t:'bitti', xml} | {t:'hata'}
  İlerleme: {t:'ilerleme', ad}
*/
'use strict';

let py = null;

function haber(o, aktar) {
  self.postMessage(o, aktar || []);
}

async function baslat(m) {
  haber({ t: 'ilerleme', ad: 'Python motoru indiriliyor' });
  importScripts(m.pyodideTaban + 'pyodide.js');
  py = await self.loadPyodide({ indexURL: m.pyodideTaban });
  haber({ t: 'ilerleme', ad: 'Python kütüphaneleri yükleniyor' });
  await py.loadPackage(['numpy', 'scipy', 'scikit-learn', 'opencv-python', 'pillow', 'typing-extensions']);
  haber({ t: 'ilerleme', ad: 'Okuma kodu hazırlanıyor' });
  const bin = async (u) => {
    const r = await fetch(u);
    if (!r.ok) throw new Error('Dosya indirilemedi: ' + u + ' (' + r.status + ')');
    return new Uint8Array(await r.arrayBuffer());
  };
  py.unpackArchive(await bin(m.zipAdres), 'zip', '/home/pyodide/');
  py.globals.set('svm_bytes', await bin(m.svmAdres));
  py.runPython(`
import sys
sys.path.insert(0, '/home/pyodide')
import numpy as np
from oemer import inference
inference.modelleri_yukle(bytes(svm_bytes.to_py()))
import omr_run
`);
  haber({ t: 'hazir' });
}

async function calis(m) {
  py.globals.set('h1b', m.h1);
  py.globals.set('h2b', m.h2);
  py.globals.set('imb', m.goruntu);
  py.globals.set('H', m.h);
  py.globals.set('W', m.w);
  py.globals.set('DESKEW', !!m.deskew);
  py.globals.set('BASLIK', m.baslik || 'Nota');
  py.globals.set('ilerleme_js', (ad) => haber({ t: 'ilerleme', ad: String(ad) }));
  const xml = await py.runPythonAsync(`
H = int(H); W = int(W)
h1 = np.frombuffer(bytes(h1b.to_py()), dtype=np.uint8).reshape(H, W).copy()
h2 = np.frombuffer(bytes(h2b.to_py()), dtype=np.uint8).reshape(H, W).copy()
im = np.frombuffer(bytes(imb.to_py()), dtype=np.uint8).reshape(H, W, 3).copy()
x = omr_run.calistir(h1, h2, im, deskew=bool(DESKEW), baslik=str(BASLIK), ilerleme=ilerleme_js)
del h1, h2, im
x.decode('utf-8')
`);
  haber({ t: 'bitti', xml: xml });
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.t === 'baslat') await baslat(m);
    else if (m.t === 'calis') await calis(m);
  } catch (err) {
    haber({ t: 'hata', mesaj: String((err && err.message) || err) });
  }
};
