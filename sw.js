const SURUM = 'piyano-hoca-asama14-v8';
const DOSYALAR = [
  './', 'index.html', 'style.css', 'app.js', 'eser.js', 'porte.js', 'piyano-ses.js',
  'kutuphane.js', 'iceaktar.js', 'duzenle.js', 'performans.js', 'giris.js', 'kayit.js', 'hazir.js', 'eserler.json', 'manifest.json', 'icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SURUM).then((c) =>
      Promise.all(DOSYALAR.map((d) => c.add(d).catch(() => {})))
    )
  );
  self.skipWaiting();
});

// Eski uygulama önbelleklerini ve artık kullanılmayan nota okuma önbelleğini (yaklaşık 175 MB) siler.
// İndirilen piyano sesleri ('piyano-sesler-v1') ve PDF desteği ('piyano-pdf-v1') silinmez.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((adlar) =>
      Promise.all(
        adlar
          .filter((a) => (a.indexOf('piyano-hoca-') === 0 && a !== SURUM) || a === 'piyano-omr-v1')
          .map((a) => caches.delete(a))
      )
    )
  );
  self.clients.claim();
});

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
        return yanit;
      })
      .catch(() =>
        caches.match(istek, { ignoreSearch: true }).then((kayit) => kayit || caches.match('index.html'))
      )
  );
});
