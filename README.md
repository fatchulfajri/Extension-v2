# SOAP AI Assistant - Chrome Extension

Ekstensi Chrome untuk koreksi dokumentasi SOAP medis dengan AI. Terintegrasi dengan N8N untuk pemrosesan AI.

## Struktur Project

```
extention-v2/
├── manifest.json              # Konfigurasi ekstensi Chrome
├── README.md                  # Dokumentasi ini
│
├── assets/                    # Aset statis
│   └── icons/                 # Icon ekstensi
│       ├── icon-16.png
│       ├── icon-48.png
│       └── icon-128.png
│
└── src/                       # Source code utama
    ├── core/                  # Core functionality (ES Modules)
    │   ├── constants.js       # Global constants
    │   ├── n8n-handler.js     # N8N API handler
    │   └── service-worker.js  # Background service worker
    │
    ├── content/               # Content script (single file, no modules)
    │   ├── content.js         # Entry point + semua logic
    │   └── styles/            # CSS untuk content script
    │       ├── floating-button.css
    │       └── sidebar.css
    │
    └── popup/                 # Settings popup
        ├── popup.html         # Popup UI
        ├── popup.css          # Popup styles
        └── popup.js           # Popup logic
```

## Catatan Penting

- **Background Script** menggunakan ES Modules (`type: "module"` di manifest)
- **Content Script** TIDAK menggunakan ES Modules (Chrome tidak mendukung)
- **Popup Script** standar JavaScript

## Fitur

- **Deteksi Form SOAP Otomatis**: Mendeteksi field Subjective, Objective, Assessment, dan Plan
- **Floating Button Toggle**: Tombol floating di pojok kanan bawah
- **Real-time AI Correction**: Mengirim data ke N8N dengan debounce 1.5 detik
- **Kategori Koreksi**: Menampilkan koreksi dalam 4 kategori SOAP
- **Smart Badge**: Menampilkan jumlah total koreksi
- **Sidebar Panel**: Panel koreksi dengan detail per kategori

## Instalasi

### 1. Siapkan Icon

Buat icon dengan ukuran berikut di folder `assets/icons/`:
- `icon-16.png` (16x16px)
- `icon-48.png` (48x48px)
- `icon-128.png` (128x128px)

### 2. Load Extension di Chrome

1. Buka `chrome://extensions/`
2. Aktifkan "Developer mode"
3. Klik "Load unpacked"
4. Pilih folder `extention-v2`

### 3. Konfigurasi N8N

1. Klik icon ekstensi di toolbar
2. Masukkan URL Webhook N8N
3. Klik "Simpan Pengaturan"

## Format N8N Response

N8N harus merespon dengan format berikut:

```json
{
  "corrections": {
    "S": [
      {
        "message": "Keluhan tidak spesifik",
        "severity": "warning",
        "suggestion": "Tambahkan durasi dan intensitas",
        "original": "Pasien sakit kepala"
      }
    ],
    "O": [],
    "A": [],
    "P": []
  }
}
```

### Severity Levels

- `error`: Kesalahan serius (merah)
- `warning`: Peringatan (kuning)
- `info`: Informasi (biru)

## Deteksi Form SOAP

Pattern yang dikenali:
- **S**: subjective, s, keluhan, complaint, anamnesis
- **O**: objective, o, pemeriksaan, examination, fisik
- **A**: assessment, a, asesmen, diagnosis, analisis
- **P**: plan, p, rencana, treatment, terapi, planning

## Penggunaan

1. Buka halaman dengan form SOAP (EMR/medical records)
2. Tombol floating muncul di pojok kanan bawah
3. Isi form SOAP, ekstensi otomatis mengirim ke AI
4. Klik tombol untuk melihat koreksi
5. Klik lagi untuk menutup panel

## Development

### Menambahkan Fitur Baru

**Background/Service Worker:**
- Bisa menggunakan ES Modules
- Tambah di `src/core/`

**Content Script:**
- TIDAK BISA menggunakan ES Modules
- Tambahkan langsung di `src/content/content.js`

**Popup:**
- Standar JavaScript
- Tambah di `src/popup/`

### Troubleshooting

#### Floating button tidak muncul
1. Cek Console (F12) untuk error
2. Pastikan ekstensi aktif di popup settings
3. Refresh halaman setelah mengubah settings

#### Toggle tidak berfungsi
1. Buka Console di halaman web
2. Cek log "SOAP Assistant - Message received"
3. Pastikan tidak ada error JavaScript

#### Koreksi tidak muncul
1. Pastikan URL N8N sudah dikonfigurasi
2. Cek network tab di DevTools untuk API calls
3. Pastikan N8N merespon dengan format yang benar

## License

MIT
