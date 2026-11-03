# Liga Top Skor Zona Palu — Web App + Google Sheets + Google Drive + Cloudflare + GitHub

Paket ini mempertahankan tampilan utama dan fitur aplikasi HTML asli, menghapus tab **API Integrasi (Cloudflare/Sheets/Drive)** dari panel admin, mengganti logo pada judul/navbar dengan logo Drive yang diberikan, serta memindahkan konfigurasi backend ke folder proyek.

## Struktur folder Google Drive

Penyimpanan berkas pemain memakai folder root yang Anda berikan:

```text
[Folder Penyimpanan Berkas]
└── [Kategori Usia, mis. U-10 (2016-2017)]
    └── [Nama Tim]
        └── [Nama Pemain - ID Pemain]
            ├── Foto Pemain
            ├── Akte Kelahiran
            ├── Kartu Keluarga
            ├── Ijazah Terakhir
            └── Rapor / NISN
```

Folder berita dan galeri diambil dari folder Drive yang sudah Anda tentukan. File berita/galeri yang berada di folder tersebut akan ditampilkan berdasarkan nama file dan deskripsinya.

## 1. Siapkan Google Apps Script dan Google Sheets

1. Login ke akun Google yang memiliki akses **Editor** ke ketiga folder Drive yang Anda berikan.
2. Buka [Google Apps Script](https://script.google.com/) lalu buat project baru bernama `LTS Palu Backend`.
3. Salin seluruh isi `gas/Code.gs` ke editor `Code.gs`.
4. Jalankan fungsi `setupLtsPalu()` satu kali. Setujui izin Google Sheets dan Google Drive yang diminta.
5. Buka **Execution log**. Fungsi setup membuat spreadsheet `Database Liga Top Skor Zona Palu`, tab `Settings`, `Categories`, `Teams`, `Players`, dan `Scans`, serta membuat `SHARED_SECRET` otomatis. Simpan URL spreadsheet dan nilai `SHARED_SECRET` secara privat.
6. Deploy → **New deployment** → pilih **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
7. Deploy dan salin URL Web App yang berakhiran `/exec`.

Apps Script Web App harus dapat dipanggil oleh Cloudflare Worker. Endpoint Google tidak dipanggil langsung oleh browser; Worker menambahkan shared key dari Secret Cloudflare. Jangan bagikan URL deployment dan shared key bersama-sama.

## 2. Siapkan Cloudflare Worker

1. Buat repository GitHub, lalu upload seluruh isi folder proyek ini ke root repository.
2. Pada Cloudflare, buat API Token yang memiliki izin deploy Workers dan Pages pada akun Anda.
3. Di GitHub repository buka **Settings → Secrets and variables → Actions**. Tambahkan Repository Secrets:

| Secret | Isi |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API Token Cloudflare |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID Cloudflare |
| `GAS_WEB_APP_URL` | URL Web App Google Apps Script berakhiran `/exec` |
| `GAS_SHARED_SECRET` | Nilai `SHARED_SECRET` yang dicetak `setupLtsPalu()` |
| `SESSION_SECRET` | String acak panjang minimal 32 karakter untuk tanda tangan sesi login |

4. Tambahkan Repository Variable bernama `CLOUDFLARE_PAGES_PROJECT` dengan nilai `lts-palu-web` (atau nama Pages project yang Anda pakai).
5. Edit `worker/wrangler.jsonc`, bagian `ALLOWED_ORIGINS`, sesuai domain website Pages Anda. Contoh awal: `https://lts-palu-web.pages.dev,http://localhost:8788`. Tambahkan domain khusus Anda jika digunakan.
6. Buat project Cloudflare Pages bernama sama dengan variable GitHub tadi (`lts-palu-web`) melalui Cloudflare Dashboard. Pilih opsi Direct Upload / upload existing assets bila diminta; deployment berikutnya dijalankan oleh GitHub Actions.
7. Commit dan push ke branch `main`. Workflow `.github/workflows/deploy-worker.yml` akan deploy Worker terlebih dahulu lalu website Pages.

Cloudflare Worker menggunakan konfigurasi `worker/wrangler.jsonc` sebagai sumber konfigurasi. Nilai rahasia disuntikkan dari GitHub Secrets ke Worker saat deploy; tidak ditulis ke HTML atau repository.

## 3. Hubungkan halaman web ke Worker

Setelah Worker berhasil dideploy, lihat URL Worker di Cloudflare. Bentuknya biasanya:

```text
https://lts-palu-api.NAMA-SUBDOMAIN.workers.dev
```

Edit `public/config.js`, isi `API_BASE_URL` dengan URL Worker tanpa garis miring di akhir, misalnya:

```js
window.LTS_CONFIG = {
  API_BASE_URL: "https://lts-palu-api.NAMA-SUBDOMAIN.workers.dev"
};
```

Pastikan domain Pages yang sebenarnya juga tercantum pada `ALLOWED_ORIGINS` di `worker/wrangler.jsonc`, lalu commit dan push lagi. Setelah itu halaman akan membaca data dari Sheets/Drive melalui Worker. Jika `API_BASE_URL` kosong, HTML tetap bisa dibuka untuk preview dengan data demo lokal, tetapi data tidak tersimpan permanen.

## 4. Akun awal dan batas unggahan

- Username admin awal: `admin`
- Password admin awal: `admin123`
- **Segera login dan ubah password admin dari tombol “Ubah Pass”.** Password disimpan sebagai hash + salt di Script Properties, bukan plaintext di Google Sheets.
- Password tim minimal 8 karakter dan disimpan sebagai hash + salt.
- Logo tim: maksimal 4 MB.
- Foto dan setiap dokumen pemain: maksimal 3 MB per file.
- Berkas pemain yang wajib diunggah: foto, akte kelahiran, KK, ijazah terakhir, dan rapor/NISN.

## 5. Privasi dokumen pemain (penting)

Folder penyimpanan pemain berisi data anak, NISN, alamat, akte kelahiran, KK, dan dokumen sekolah. **Pastikan folder root `1kOycv_210rWI8223WNZQVORG5n1Oa7P7` dan seluruh turunannya menggunakan akses Restricted / terbatas.** Jangan setel root penyimpanan pemain ke “Anyone with the link”. File dokumen dan foto pemain tidak dibuat publik. Foto pemain hanya diambil melalui endpoint Worker dengan sesi admin atau tim yang berwenang.

Folder Galeri `1rl1gtuXBXpXiNf18NecyjRX_4lGoR_fW` dan folder Informasi/Berita `1cSwjtQgVceYmYMGDU-WJlYbikFim5a8a` diperlakukan sebagai sumber konten publik. File di dalam kedua folder itu akan diberi akses “Anyone with the link — Viewer” agar thumbnail dapat tampil di situs. Jangan letakkan dokumen pribadi pada kedua folder publik tersebut.

Logo judul memakai file ID `1UA3wE07nS2zXled4MYCIK-VuLTxyW-r9`. Agar tampil, pastikan file logo itu dapat dilihat oleh pengunjung situs (Anyone with link — Viewer).

## 6. Catatan integrasi

- Google Sheets menjadi database terstruktur untuk pengaturan, kategori, tim, pemain, dan riwayat scan.
- Google Drive menyimpan berkas sesuai hirarki kategori → tim → pemain.
- Folder berita dan galeri dibaca langsung dari Drive.
- Cloudflare Worker menjadi API perantara, mengelola CORS, sesi admin/tim, dan akses berkas foto privat.
- GitHub Actions deploy Worker serta Cloudflare Pages. Tidak ada GitHub token, Google credential, shared key, atau API secret di browser.
- Integrasi ini belum dapat benar-benar aktif sampai Apps Script dideploy, GitHub Secrets/Variables diisi, dan `public/config.js` diarahkan ke URL Worker Anda.

## Pengembangan lokal

```bash
cd worker
npm install
npm run dev
```

Sediakan `worker/.dev.vars` lokal (jangan commit) berisi `GAS_WEB_APP_URL`, `GAS_SHARED_SECRET`, `SESSION_SECRET`, dan `ALLOWED_ORIGINS`. Sajikan folder `public` di `http://localhost:8788` dan tambahkan origin tersebut ke `ALLOWED_ORIGINS`.

## File penting

- `public/index.html` — aplikasi web hasil penyesuaian.
- `public/config.js` — URL Worker publik, bukan tempat secret.
- `worker/src/index.js` — API Cloudflare Worker.
- `worker/wrangler.jsonc` — konfigurasi Wrangler JSONC.
- `gas/Code.gs` — Google Apps Script untuk Sheets dan Drive.
- `.github/workflows/deploy-worker.yml` — deployment Worker dan Pages dari GitHub Actions.
