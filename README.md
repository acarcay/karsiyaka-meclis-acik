# Karşıyaka Ne Karar Verdi?

Karşıyaka Belediye Meclisi kararlarını sade Türkçeyle sunan, bağımsız ve açık kaynak bir sivil teknoloji projesi.

🔗 **[Siteyi Aç →](https://karsiyaka-meclis.netlify.app)**

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
