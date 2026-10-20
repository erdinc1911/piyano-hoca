const SURUM = 'piyano-hoca-asama10-v2';
const DOSYALAR = [
  './', 'index.html', 'style.css', 'app.js', 'eser.js', 'porte.js', 'piyano-ses.js',
  'kutuphane.js', 'iceaktar.js', 'duzenle.js', 'performans.js', 'manifest.json', 'icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SURUM).then((c) =>
      Promise.all(DOSYALAR.map((d) => c.add(d).catch(() => {})))
    )
  );
  self.skipWaiting();
});

// Yalnızca eski uygulama önbelleklerini sil.
// İndirilen piyano sesleri ('piyano-sesler-v1') ve PDF desteği ('piyano-pdf-v1') silinmez.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((adlar) =>
      Promise.all(
        adlar
          .filter((a) => a.indexOf('piyano-hoca-') === 0 && a !== SURUM)
          .map((a) => caches.delete(a))
      )
    )
  );
  self.clients.claim();
});

// Çok çekirdekli hesaplama (nota okuma) için sayfaya gerekli güvenlik başlıklarını ekler
function basliklarEkle(yanit) {
  if (!yanit || yanit.status === 0 || yanit.type === 'opaque') return yanit;
  const h = new Headers(yanit.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'credentialless');
  return new Response(yanit.body, { status: yanit.status, statusText: yanit.statusText, headers: h });
}

// İnternet (veya yerel sunucu) varsa en yeni dosyayı al, yoksa önbellekten aç
self.addEventListener('fetch', (e) => {
  const istek = e.request;
  if (istek.method !== 'GET') return;
  if (new URL(istek.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(istek)
      .then((yanit) => {
        if (yanit && yanit.status === 200) {
          const kopya = yanit.clone();
          caches.open(SURUM).then((c) => c.put(istek, kopya));
        }
        return basliklarEkle(yanit);
      })
      .catch(() =>
        caches
          .match(istek, { ignoreSearch: true })
          .then((kayit) => kayit || caches.match('index.html'))
          .then((kayit) => basliklarEkle(kayit))
      )
  );
});
