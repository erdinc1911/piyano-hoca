/*
  NOTA OKUMA ARAYÜZÜ (Aşama 11)
  Kütüphanedeki PDF ve fotoğraf satırlarındaki "🎼 Notayı oku" düğmesi bu paneli açar.
  Sonuç, kütüphaneye düzenlenebilir bir eser olarak eklenir.
  Dışarıya yalnızca window.OMRUI verilir.
*/

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let K = null;          // kütüphane bağlantısı (window.KUT)
  let kayit = null;      // okunacak kütüphane kaydı
  let calisiyor = false;
  let sonId = null;      // oluşan eserin kimliği

  function panelGoster(ac) {
    $('omr-panel').hidden = !ac;
  }

  function durumYaz(yazi) {
    $('omr-durum').textContent = yazi;
  }

  function ilerlemeYaz(o) {
    const s = { hazirlik: [0, 0.05], model1: [0.05, 0.40], model2: [0.45, 0.30], cozumleme: [0.75, 0.25], bitti: [1, 0] }[o.asama] || [0, 0];
    const genel = Math.min(1, s[0] + s[1] * (o.oran || 0));
    $('omr-cubuk').value = genel;
    let yazi = o.ileti || '';
    if (o.kalanSn && o.kalanSn > 3) {
      const dk = Math.floor(o.kalanSn / 60);
      yazi += ' · bu adım için yaklaşık ' + (dk > 0 ? dk + ' dk ' : '') + Math.round(o.kalanSn % 60) + ' sn kaldı';
    }
    durumYaz(yazi + ' (%' + Math.round(genel * 100) + ')');
  }

  async function sayfaCanvas(sayfaNo) {
    await K.pdfHazirla();
    const veri = await kayit.blob.arrayBuffer();
    const doc = await K.pdfKutu().getDocument({ data: veri }).promise;
    try {
      const sayfa = await doc.getPage(sayfaNo);
      const v1 = sayfa.getViewport({ scale: 1 });
      const oran = Math.sqrt(window.OMR.hedefPiksel / (v1.width * v1.height));
      const v = sayfa.getViewport({ scale: oran });
      const tuval = document.createElement('canvas');
      tuval.width = Math.round(v.width);
      tuval.height = Math.round(v.height);
      const c = tuval.getContext('2d');
      c.fillStyle = '#fff';
      c.fillRect(0, 0, tuval.width, tuval.height);
      await sayfa.render({ canvasContext: c, viewport: v }).promise;
      return tuval;
    } finally {
      try { doc.destroy(); } catch (e) {}
    }
  }

  function kilitle(kilit) {
    calisiyor = kilit;
    $('omr-basla').disabled = kilit;
    $('omr-iptal').textContent = kilit ? 'İptal et' : 'Kapat';
    $('omr-sayfa').disabled = kilit;
    $('omr-kalite').disabled = kilit;
    $('omr-egrilik').disabled = kilit;
  }

  async function baslat() {
    if (calisiyor || !kayit) return;
    const d = window.OMR.destek();
    if (!d.tamam) {
      durumYaz('Bu cihazda okunamıyor: ' + d.sorun.join(' '));
      return;
    }
    const ilkMi = !localStorage.getItem('omrIlkKullanim');
    if (ilkMi && !confirm('Notayı okumak için ilk kullanımda yaklaşık 175 MB indirilecek (bir kez). Wi-Fi bağlıysa devam et. Başlansın mı?')) {
      return;
    }
    kilitle(true);
    sonId = null;
    $('omr-sonuc').hidden = true;
    $('omr-kayit-kutu').hidden = true;
    $('omr-cubuk').value = 0;
    durumYaz('Başlıyor…');
    const pdf = kayit.tur === 'pdf';
    const sayfaNo = pdf ? Math.max(1, Math.min(parseInt($('omr-sayfa').value, 10) || 1, kayit.sayfa || 1)) : 1;
    try {
      let kaynak;
      if (pdf) {
        durumYaz('PDF sayfası hazırlanıyor…');
        kaynak = await sayfaCanvas(sayfaNo);
      } else {
        kaynak = kayit.blob;
      }
      const sonuc = await window.OMR.oku(kaynak, {
        kalite: $('omr-kalite').value,
        deskew: $('omr-egrilik').checked,
        baslik: kayit.ad,
        ilerle: ilerlemeYaz
      });
      try { localStorage.setItem('omrIlkKullanim', '1'); } catch (e) {}

      durumYaz('Eser oluşturuluyor…');
      const dosya = new File([sonuc.xml], 'okunan.musicxml', { type: 'application/xml' });
      const { eser, uyari } = await window.NOTA_IC.dosyadanEser(dosya);
      if (!eser.notalar.length) throw new Error('Hiç nota bulunamadı. Sayfa net ve düz değilse "Hassas" kaliteyi ya da daha iyi bir fotoğrafı dene.');
      eser.baslik = (kayit.ad + (pdf ? ' (okunan, s.' + sayfaNo + ')' : ' (okunan)')).slice(0, 120);
      sonId = await K.notaKayitOlustur(eser);
      if (window.eserListesiYenile) await window.eserListesiYenile();
      durumYaz('Bitti: ' + eser.notalar.length + ' nota, ' + eser.olcuSayisi + ' ölçü okundu (' + Math.round(sonuc.sureSn) + ' sn).');
      $('omr-cubuk').value = 1;
      $('omr-sonuc').hidden = false;
      $('omr-sonuc-yazi').textContent =
        'Bu bir taslaktır: yanlış okunan notalar olabilir. "Çal / düzenle" ile açıp ✏ Düzenle ile düzeltebilirsin.' +
        (uyari && uyari.length ? ' Not: ' + uyari.join(' ') : '');
    } catch (e) {
      const m = (e && e.message) || String(e);
      durumYaz(m === 'İptal edildi' ? 'İptal edildi.' : 'Okunamadı: ' + m);
      $('omr-kayit-kutu').hidden = false;
    } finally {
      kilitle(false);
    }
  }

  function ac(k) {
    kayit = k;
    $('omr-baslik').textContent = '🎼 Notayı oku: ' + k.ad;
    const pdf = k.tur === 'pdf';
    $('omr-sayfa-grup').hidden = !pdf;
    $('omr-sayfa').max = String(k.sayfa || 1);
    $('omr-sayfa').value = '1';
    $('omr-egrilik').checked = !pdf;
    $('omr-sonuc').hidden = true;
    $('omr-kayit-kutu').hidden = true;
    $('omr-cubuk').value = 0;
    const d = window.OMR.destek();
    durumYaz(d.tamam ? 'Hazır. Başlat\'a bas.' : 'Bu cihazda okunamıyor: ' + d.sorun.join(' '));
    if (d.uyari.length) durumYaz($('omr-durum').textContent + ' ' + d.uyari.join(' '));
    panelGoster(true);
  }

  function kur(kutuphaneApi) {
    K = kutuphaneApi;
    $('omr-basla').addEventListener('click', baslat);
    $('omr-iptal').addEventListener('click', () => {
      if (calisiyor) {
        window.OMR.iptal();
      } else {
        panelGoster(false);
      }
    });
    $('omr-ac').addEventListener('click', () => {
      if (sonId) {
        panelGoster(false);
        K.notaAc(sonId);
      }
    });
    $('omr-kayit-kopyala').addEventListener('click', async () => {
      const yazi = window.OMR.kayit();
      try {
        await navigator.clipboard.writeText(yazi);
        durumYaz('Tanı kaydı kopyalandı. Sohbete yapıştır.');
      } catch (e) {
        $('omr-kayit-metin').hidden = false;
        $('omr-kayit-metin').value = yazi;
        $('omr-kayit-metin').select();
        durumYaz('Otomatik kopyalanamadı. Kutudaki yazıyı seçip kopyala.');
      }
    });
  }

  window.OMRUI = { kur: kur, ac: ac };
  if (window.KUT) kur(window.KUT);
})();
