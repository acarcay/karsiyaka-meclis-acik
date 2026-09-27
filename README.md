# Karşıyaka Ne Karar Verdi?

Karşıyaka Belediye Meclisi kararlarını resmî belgelerden otomatik aktaran, bağımsız ve açık kaynak bir sivil teknoloji projesi. Belediyenin resmî sitesi değildir.

🔗 **[Siteyi Aç →](https://karsiyaka-meclis-acik.netlify.app/)**

---

## Ne Yapıyor?

1. Karşıyaka Belediyesi'nin [meclis karar özetleri](https://www.karsiyaka.bel.tr/meclis-karar-ozetleri) sayfasından PDF'leri çeker
2. `pdftotext` ile metne çevirir ve regex tabanlı parser ile yapısal veriye dönüştürür
3. Sade bir web arayüzü ile vatandaşa sunar — arama, filtreleme, permalink

## Hızlı Başlangıç

```bash
# Gereksinimleri kur (macOS)
brew install poppler   # pdftotext için

# Kararları çek
npm run update         # Bu yılın kararlarını çeker
npm run update:2025    # Belirli bir yıl

# Siteyi aç
npm run dev            # http://localhost:8080
```

## Proje Yapısı

```
├── dist/                    # Yayına hazır statik site
│   ├── index.html           # Tek sayfa frontend (sıfır bağımlılık)
│   └── data/
│       └── decisions.json   # Üretilen karar verisi
├── scripts/
│   └── import-decisions.mjs # PDF çekme + parse + JSON üretimi
├── .github/workflows/
│   └── update-decisions.yml # Otomatik güncelleme (Pzt + Cuma)
└── work/                    # PDF cache (gitignore)
```

## Otomatik Güncelleme

GitHub Actions her **Pazartesi ve Cuma sabah 09:00**'da (TR saati) otomatik çalışır:

- Belediye sitesinden yeni PDF'leri kontrol eder
- Varsa çeker, parse eder, `decisions.json`'u günceller
- Commit + push yapar → site otomatik güncellenir

Elle tetiklemek için: GitHub repo → Actions → "Kararları Güncelle" → "Run workflow"

## Deploy

`dist/` klasörü herhangi bir statik hosting servisine deploy edilebilir:

- **GitHub Pages** — `dist/` klasörünü kaynak olarak ayarla
- **Netlify** — Build command: `(boş)`, Publish directory: `dist`
- **Vercel** — Output directory: `dist`

## Veri Şeması

```jsonc
{
  "id": "2026-09-07-128",
  "date": "2026-09-07",
  "decisionNo": "128",
  "tag": "İmar",               // İmar | Mali | Kültür | Yönetim
  "title": "Kısa, anlaşılır başlık",
  "text": "Tam metin",
  "result": "Oybirliğiyle kabul",
  "votes": { "type": "unanimous" },
  "department": "İmar ve Şehircilik",
  "place": "Mavişehir",
  "source": "https://...pdf",
  "reviewed": false
}
```

## Lisans

MIT

## Yayın ve veri güvenilirliği

- `npm test` ayrıştırma, tarih, Türkçe oy sayısı ve arşiv koruma kontrollerini çalıştırır.
- Güncelleme diğer yılları korur; eksik ayrıştırma veya tekrarlanan karar varsa yayındaki veri değiştirilmez.
- Tüm kayıtlar otomatik aktarım olarak sunulur; insan tarafından doğrulandığı iddia edilmez. Başlıklar okunabilirlik için sadeleştirilir; aktarım ve sadeleştirme hataları olabilir. Mevcut kayıtların tamamında `reviewed: false` kullanılır.
- `dist/data/status.json` içindeki `checkedAt` yalnızca başarılı çevrimiçi kaynak kontrolünden sonra güncellenir. En yeni karar tarihi bundan ayrıdır.
- İletişim ve düzeltme talepleri GitHub Issues üzerinden alınır. Herkese açık bildirimlere hassas bilgi eklenmemelidir.
- Yayına alınacak klasör `dist/` klasörüdür. Yerel değişiklikler Netlify'a yeniden dağıtılana kadar canlı siteye yansımaz.

### Okunabilir başlıklar

`data/decision-titles.json`, mevcut kararların kısa konu başlıklarını saklar. Bu başlıklar insan doğrulaması anlamına gelmez ve `reviewed` alanından bağımsızdır. Güncelleyici, kararın kaynak metni ve sonucu aynı kaldığında başlığı korur; içerik değişirse eski başlığı kullanmaz. Yeni veya değişen kayıtlar otomatik başlık üretimine döner.
