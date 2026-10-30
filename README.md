# Sistem Nilai – Zero Trust Security

Tugas Praktikum Individu · Keamanan Informasi (KP70065004) · Informatika Universitas Siliwangi

Sistem Nilai dengan arsitektur **Zero Trust** (NIST SP 800-207): API Gateway sebagai
**Policy Enforcement Point (PEP)**, Policy Engine/Administrator di dalam gateway, dan dua
service (Nilai & Transkrip) yang tidak bisa diakses langsung.

```
Client (Postman/curl) ──► API Gateway :3000 (PEP) ──┬──► Service Nilai     :3001 ──┐
   token + X-Device-ID     │  Policy Engine (policy.js)                           ├──► SQLite (data/sistem_nilai.db)
                           │  Auth /auth/* (login, refresh, logout, service)      │
                           └► Audit Log (tabel audit_log)  └──► Service Transkrip :3002 ──┘
Service Nilai ──(token service, lewat gateway)──► POST /transkrip/sinkron
```

## 1. Cara menjalankan

Prasyarat: **Node.js 20 / 22 LTS** (cek `node -v`).

```bash
npm install          # pasang dependency (express, jsonwebtoken, better-sqlite3)
npm run seed         # isi data awal (aman dijalankan kapan saja, juga me-reset nilai & audit log)
npm start            # jalankan gateway :3000, Service Nilai :3001, Service Transkrip :3002
```

Hentikan dengan `Ctrl + C`. Tiap proses juga bisa dijalankan sendiri:
`npm run gateway`, `npm run nilai`, `npm run transkrip`.

Konfigurasi ada di file `.env` (contoh: `.env.example`), termasuk **jam akses**:

```
ACCESS_START=07:00
ACCESS_END=21:00
TIMEZONE=Asia/Jakarta
```

Perintah lain:

| Perintah | Fungsi |
|---|---|
| `npm test` | Test otomatis (±59 pengecekan; server harus sedang jalan) |
| `npm run audit` | Tampilkan audit log terbaru (`npm run audit -- deny 50`) |
| `npm run seed` | Reset data (nilai kembali belum final, audit log kosong) |
| `bash tests/demo.sh` | Demo curl berurutan (Git Bash / macOS / Linux) |

Postman: import `postman/SistemNilai-ZeroTrust.postman_collection.json` dan
`postman/SistemNilai-ZeroTrust.postman_environment.json`. Langkah lengkap ada di **PANDUAN.md**.

## 2. Akun & device ID data awal

| Username | Password | Role | NIM | Device ID terdaftar | Keterangan |
|---|---|---|---|---|---|
| `admin`  | `Admin123!` | admin | – | `DEV-ADMIN-01` | |
| `dosen1` | `Dosen123!` | dosen | – | `DEV-DOSEN1-01` | Mengampu kelas 1 (KA101 Keamanan Informasi) |
| `dosen2` | `Dosen123!` | dosen | – | `DEV-DOSEN2-01` | Mengampu kelas 2 (IF202 Basis Data) |
| `mhs1` | `Mhs12345!` | mahasiswa | 2210001 | `DEV-MHS1-01` | Andi Pratama |
| `mhs2` | `Mhs12345!` | mahasiswa | 2210002 | `DEV-MHS2-01` | Siti Rahma |
| `mhs3` | `Mhs12345!` | mahasiswa | 2210003 | `DEV-MHS3-01` | Rizky Fauzan |

Client service (Service Nilai → gateway): `client_id = service-nilai`, `client_secret = nilai-client-secret-123`.

Data nilai: kelas 1 → `nilai id 1,2,3` (NIM 2210001/2/3), kelas 2 → `nilai id 4,5,6`.
Device untuk uji "tidak terdaftar": `DEV-HACKER-99`.

## 3. Daftar endpoint (semua lewat gateway `http://localhost:3000`)

| Endpoint | Siapa | Kondisi |
|---|---|---|
| `POST /auth/login` | semua | kredensial valid + device terdaftar |
| `POST /auth/refresh`, `/auth/logout` | semua | refresh token valid & belum dicabut |
| `POST /auth/service` | Service Nilai | client ID + secret valid |
| `GET /nilai` | mahasiswa, dosen | mahasiswa: miliknya; dosen: kelas yang diampu |
| `PUT /nilai/:id` | dosen | kelas diampu, belum final, dalam jam akses |
| `POST /kelas/:id/finalisasi` | dosen | kelas diampu, dalam jam akses → sinkron ke transkrip |
| `GET /transkrip/:nim` | mahasiswa, admin | mahasiswa: NIM sendiri; admin: semua |
| `POST /transkrip/sinkron` | token service saja | token user mana pun ditolak |

Setiap request selain `/auth/*` wajib membawa `Authorization: Bearer <token>` dan (untuk user) `X-Device-ID`.

## 4. Pemetaan kebutuhan → kode

| Kebutuhan | Lokasi |
|---|---|
| 4.1 Access token JWT 10 menit (`sub`, `role`) | `shared/tokens.js` → `signAccessToken` |
| 4.1 Refresh token 1 hari, di database, dapat dicabut, logout mencabut | `gateway/auth.routes.js` (`/refresh`, `/logout`), tabel `refresh_tokens` di `shared/db.js` |
| 4.1 Token service 5 menit, role `service` | `gateway/auth.routes.js` (`/service`), `shared/tokens.js` → `signServiceToken` |
| 4.1 Gateway menambah `X-Gateway-Secret`; service menolak tanpa header | `gateway/index.js` → `forward()`, `shared/guards.js` → `gatewayGuard` |
| 4.1 Service memverifikasi ulang tanda tangan & masa berlaku token | `shared/guards.js` → `tokenGuard` (dipasang di kedua service) |
| 4.2 Kebijakan akses (Tabel 3), baca atribut dari DB | `gateway/policy.js` |
| 4.3 Device terdaftar | `gateway/index.js` (PEP) dan `gateway/auth.routes.js` (login), tabel `devices` |
| 4.3 Jam akses 07.00–21.00 dapat dikonfigurasi | `shared/time.js` + `.env` (`ACCESS_START`, `ACCESS_END`) |
| 4.4 Audit log (waktu, subjek, endpoint, device, hasil, alasan) | `gateway/audit.js`, tabel `audit_log` |
| Panggilan antar-service melalui gateway | `service-nilai/index.js` → `getServiceToken()` + `POST /kelas/:id/finalisasi` |

## 5. Struktur folder

```
gateway/            index.js (PEP + proxy) · policy.js (Policy Engine) · auth.routes.js (PA) · audit.js
service-nilai/      index.js
service-transkrip/  index.js
shared/             config.js · db.js · tokens.js · security.js · guards.js · time.js · grade.js
scripts/            seed.js · audit.js · build-postman.js
tests/              e2e.test.js · demo.sh
postman/            collection + environment
data/               sistem_nilai.db (dibuat otomatis)
```

## 6. Catatan keamanan yang diterapkan

* **Never trust, always verify** – gateway memeriksa token, device, dan kebijakan di *setiap* request; service memverifikasi ulang token walau request sudah lolos gateway.
* **Least privilege** – setiap endpoint hanya untuk role tertentu; token service hanya berlaku untuk `/transkrip/sinkron`; admin tidak bisa membaca/mengubah nilai.
* **Assume breach** – service tidak bisa diakses langsung (gateway secret + token); password di-hash (scrypt + salt); refresh token disimpan sebagai hash SHA-256; refresh token dirotasi dan pemakaian ulang token lama mencabut seluruh sesi user; access token dapat dicabut saat logout (daftar `jti`); algoritma JWT dikunci ke HS256.
* Header `X-Gateway-Secret` dari client dibuang; gateway membangun ulang header saat meneruskan request.
* Service hanya listen di `127.0.0.1`.
