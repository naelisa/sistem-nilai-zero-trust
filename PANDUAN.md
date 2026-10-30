# PANDUAN LENGKAP – Sistem Nilai Zero Trust

Panduan ini berisi: **(A)** persiapan & cara menjalankan, **(B)** penjelasan cara kerja, **(C)** testing dengan curl,
**(D)** testing otomatis, **(E)** tutorial Postman, **(F)** demo jam akses, **(G)** skrip video demo 6–9 menit,
**(H)** troubleshooting, **(I)** checklist pengumpulan.

---

## A. Persiapan dan menjalankan

### A1. Install yang dibutuhkan (sekali saja)

| Software | Cek di terminal | Catatan |
|---|---|---|
| Node.js **20 atau 22 LTS** | `node -v` | Unduh di nodejs.org (pilih LTS). Sudah termasuk `npm`. |
| Postman | – | Unduh di postman.com (akun gratis cukup). |
| VS Code (opsional) | – | Untuk membuka kode saat rekam video. |
| Git Bash (khusus Windows, untuk curl) | – | Terpasang bersama Git for Windows. |

### A2. Siapkan project

1. Ekstrak `sistem-nilai-zero-trust.zip` ke folder bebas, misal `D:\praktikum\sistem-nilai-zero-trust`.
2. Buka folder itu di VS Code (`File → Open Folder`), lalu buka terminal: **`Terminal → New Terminal`**.
   (Atau buka CMD / PowerShell / Terminal lalu `cd` ke folder tersebut.)
3. Ketik di terminal, satu per satu:

```bash
npm install
```
> Menunggu 10–60 detik. Hasil yang benar: muncul `added ... packages` tanpa tulisan `ERR!`.

```bash
npm run seed
```
> Hasil yang benar: tabel berisi 6 user + device ID, dan baris `Service client: service-nilai / ...`.

```bash
npm start
```
> Hasil yang benar (3 baris berwarna):
> ```
> [start] jam akses: 07:00-21:00 (Asia/Jakarta)
> [transkrip] [service-transkrip] berjalan di http://127.0.0.1:3002 ...
> [nilai] [service-nilai] berjalan di http://127.0.0.1:3001 ...
> [gateway] [gateway] PEP berjalan di http://127.0.0.1:3000
> ```
> **Biarkan terminal ini terbuka** selama testing. Setiap keputusan akses akan tampil di sini
> (`[audit] ALLOW ...` / `[audit] DENY ...`) – bagus untuk ditunjukkan di video.

4. Buka **terminal kedua** (di VS Code: tombol `+` di panel terminal) untuk perintah testing.

### A3. Kalau file `.env` belum ada

Salin `.env.example` menjadi `.env`:
* Windows CMD: `copy .env.example .env`
* PowerShell / macOS / Linux / Git Bash: `cp .env.example .env`

Setiap kali kamu mengubah `.env`, **restart server** (`Ctrl + C`, lalu `npm start`).

---

## B. Cara kerja singkat (untuk dipahami & dijelaskan di video)

```
Client ──(Bearer token + X-Device-ID)──► GATEWAY :3000
                                          │ 1. verifikasi JWT (tanda tangan + exp)          shared/tokens.js
                                          │ 2. token belum dicabut? (jti)                    gateway/index.js
                                          │ 3. device terdaftar untuk user ini?              gateway/index.js
                                          │ 4. Policy Engine: allow/deny + alasan            gateway/policy.js  (baca DB)
                                          │ 5. tulis audit log                               gateway/audit.js
                                          │ 6. allow → teruskan + header X-Gateway-Secret    gateway/index.js forward()
                                          ▼
                      SERVICE NILAI :3001 / SERVICE TRANSKRIP :3002
                          a. X-Gateway-Secret benar?   (shared/guards.js gatewayGuard)
                          b. Token valid? (verifikasi ulang) (tokenGuard)
                          c. Role & kepemilikan data dicek lagi (requireUserRole / filter query)
```

**Alur finalisasi nilai** (`POST /kelas/1/finalisasi` oleh dosen1):
1. Gateway: token OK → device OK → policy: dosen pengampu + dalam jam akses → *allow* → teruskan ke Service Nilai.
2. Service Nilai: ambil token service dari `POST /auth/service` (client ID + secret).
3. Service Nilai memanggil `POST /transkrip/sinkron` **ke gateway** (bukan langsung ke Transkrip) dengan token service.
4. Gateway: policy → hanya token service yang boleh → *allow* → Service Transkrip menyimpan nilai.
5. Kalau sinkron sukses → nilai ditandai `final`. Kalau gagal → finalisasi dibatalkan (nilai tetap belum final).

Dua jenis token:

| | Access token (user) | Token service |
|---|---|---|
| Endpoint | `POST /auth/login` | `POST /auth/service` |
| Masa berlaku | 10 menit | 5 menit |
| Klaim | `sub` (username), `role`, `typ=access` | `sub` (client id), `role=service`, `typ=service` |
| Refresh token | 1 hari, disimpan (hash) di DB, bisa dicabut | tidak ada |

---

## C. Testing manual dengan curl

> **Windows:** jalankan perintah di bagian ini di **Git Bash**, bukan CMD/PowerShell (tanda kutip JSON berbeda).
> Kalau tidak mau repot, langsung ke bagian E (Postman) atau jalankan `bash tests/demo.sh` di Git Bash.

Pastikan `npm start` masih jalan. Di terminal kedua:

```bash
G=http://localhost:3000
```

### C0. Cara cepat: satu perintah

```bash
npm run seed
bash tests/demo.sh
```
Skrip akan menjalankan 15 skenario berurutan beserta kode HTTP-nya.

### C1. Login (4.1 + 4.3 device terdaftar)

**Login benar** – ekspektasi **200** + `access_token`, `refresh_token`:
```bash
curl -s -X POST $G/auth/login -H "Content-Type: application/json" -H "X-Device-ID: DEV-MHS1-01" \
  -d '{"username":"mhs1","password":"Mhs12345!"}'
```

**Simpan token ke variabel** (dipakai di perintah berikutnya):
```bash
login() { curl -s -X POST $G/auth/login -H "Content-Type: application/json" -H "X-Device-ID: $3" \
  -d "{\"username\":\"$1\",\"password\":\"$2\"}"; }
tok() { login "$@" | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token'; }

MHS1=$(tok mhs1 'Mhs12345!' DEV-MHS1-01)
MHS2=$(tok mhs2 'Mhs12345!' DEV-MHS2-01)
DOSEN1=$(tok dosen1 'Dosen123!' DEV-DOSEN1-01)
DOSEN2=$(tok dosen2 'Dosen123!' DEV-DOSEN2-01)
ADMIN=$(tok admin 'Admin123!' DEV-ADMIN-01)
```
(Token berlaku 10 menit; kalau sudah lewat, jalankan blok di atas lagi.)

**Kasus gagal:**

| Perintah | Ekspektasi |
|---|---|
| password salah: `login mhs1 salah DEV-MHS1-01` | **401** Kredensial tidak valid |
| device tidak terdaftar: `login mhs1 'Mhs12345!' DEV-HACKER-99` | **403** Device tidak terdaftar |
| device milik user lain: `login mhs1 'Mhs12345!' DEV-MHS2-01` | **403** |
| tanpa header device: `curl -s -X POST $G/auth/login -H "Content-Type: application/json" -d '{"username":"mhs1","password":"Mhs12345!"}'` | **403** |

### C2. Token & device di setiap request

```bash
# tanpa token → 401
curl -s -i $G/nilai -H "X-Device-ID: DEV-MHS1-01"

# token sampah → 401
curl -s -i $G/nilai -H "Authorization: Bearer abc.def.ghi" -H "X-Device-ID: DEV-MHS1-01"

# token valid tapi tanpa X-Device-ID → 403
curl -s -i $G/nilai -H "Authorization: Bearer $MHS1"

# token mhs1 dipakai dari device milik mhs2 → 403
curl -s -i $G/nilai -H "Authorization: Bearer $MHS1" -H "X-Device-ID: DEV-MHS2-01"
```

### C3. GET /nilai

```bash
# mhs1 → 200, hanya NIM 2210001
curl -s $G/nilai -H "Authorization: Bearer $MHS1" -H "X-Device-ID: DEV-MHS1-01"

# mhs1 minta nilai NIM lain → 403
curl -s -i "$G/nilai?nim=2210002" -H "Authorization: Bearer $MHS1" -H "X-Device-ID: DEV-MHS1-01"

# dosen1 → 200, hanya kelas 1 (3 mahasiswa)
curl -s $G/nilai -H "Authorization: Bearer $DOSEN1" -H "X-Device-ID: DEV-DOSEN1-01"

# dosen1 minta kelas dosen2 → 403
curl -s -i "$G/nilai?kelas_id=2" -H "Authorization: Bearer $DOSEN1" -H "X-Device-ID: DEV-DOSEN1-01"

# admin → 403 (admin tidak boleh melihat nilai)
curl -s -i $G/nilai -H "Authorization: Bearer $ADMIN" -H "X-Device-ID: DEV-ADMIN-01"
```

### C4. PUT /nilai/:id

```bash
# mahasiswa → 403
curl -s -i -X PUT $G/nilai/1 -H "Authorization: Bearer $MHS1" -H "X-Device-ID: DEV-MHS1-01" \
  -H "Content-Type: application/json" -d '{"nilai_angka":100}'

# dosen2 (bukan pengampu kelas 1) → 403
curl -s -i -X PUT $G/nilai/1 -H "Authorization: Bearer $DOSEN2" -H "X-Device-ID: DEV-DOSEN2-01" \
  -H "Content-Type: application/json" -d '{"nilai_angka":100}'

# dosen1 (pengampu) → 200 di dalam jam akses, 403 di luar jam akses
curl -s -i -X PUT $G/nilai/1 -H "Authorization: Bearer $DOSEN1" -H "X-Device-ID: DEV-DOSEN1-01" \
  -H "Content-Type: application/json" -d '{"nilai_angka":91}'
```

### C5. Transkrip & sinkron

```bash
# mhs1 transkrip sendiri → 200
curl -s $G/transkrip/2210001 -H "Authorization: Bearer $MHS1" -H "X-Device-ID: DEV-MHS1-01"

# mhs1 transkrip orang lain → 403
curl -s -i $G/transkrip/2210002 -H "Authorization: Bearer $MHS1" -H "X-Device-ID: DEV-MHS1-01"

# admin transkrip siapa saja → 200
curl -s $G/transkrip/2210002 -H "Authorization: Bearer $ADMIN" -H "X-Device-ID: DEV-ADMIN-01"

# dosen → 403
curl -s -i $G/transkrip/2210001 -H "Authorization: Bearer $DOSEN1" -H "X-Device-ID: DEV-DOSEN1-01"

# token ADMIN ke /transkrip/sinkron → 403 (hanya token service)
curl -s -i -X POST $G/transkrip/sinkron -H "Authorization: Bearer $ADMIN" -H "X-Device-ID: DEV-ADMIN-01" \
  -H "Content-Type: application/json" -d '{"kelas_id":1}'
```

### C6. Token service

```bash
# secret salah → 401
curl -s -i -X POST $G/auth/service -H "Content-Type: application/json" \
  -d '{"client_id":"service-nilai","client_secret":"salah"}'

# benar → 200, role "service", expires_in 300
curl -s -X POST $G/auth/service -H "Content-Type: application/json" \
  -d '{"client_id":"service-nilai","client_secret":"nilai-client-secret-123"}'

# token service dipakai ke /nilai → 403 (least privilege)
SVC=$(curl -s -X POST $G/auth/service -H "Content-Type: application/json" \
  -d '{"client_id":"service-nilai","client_secret":"nilai-client-secret-123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')
curl -s -i $G/nilai -H "Authorization: Bearer $SVC"

# token service ke /transkrip/sinkron dengan body salah → 400 (artinya LOLOS policy, ditolak validasi body)
curl -s -i -X POST $G/transkrip/sinkron -H "Authorization: Bearer $SVC" \
  -H "Content-Type: application/json" -d '{"kelas_id":"x"}'
```

### C7. Finalisasi kelas

```bash
npm run seed    # reset dulu supaya nilai belum final (jalankan di folder project)

# mahasiswa / dosen lain / admin → 403
curl -s -i -X POST $G/kelas/1/finalisasi -H "Authorization: Bearer $MHS1"   -H "X-Device-ID: DEV-MHS1-01"
curl -s -i -X POST $G/kelas/1/finalisasi -H "Authorization: Bearer $DOSEN2" -H "X-Device-ID: DEV-DOSEN2-01"
curl -s -i -X POST $G/kelas/1/finalisasi -H "Authorization: Bearer $ADMIN"  -H "X-Device-ID: DEV-ADMIN-01"

# dosen1 → 200 (dalam jam akses): nilai final + masuk ke transkrip
curl -s -X POST $G/kelas/1/finalisasi -H "Authorization: Bearer $DOSEN1" -H "X-Device-ID: DEV-DOSEN1-01"

# cek transkrip mhs1 → ada KA101
curl -s $G/transkrip/2210001 -H "Authorization: Bearer $MHS1" -H "X-Device-ID: DEV-MHS1-01"

# ubah nilai setelah final → 403 "nilai sudah final"
curl -s -i -X PUT $G/nilai/2 -H "Authorization: Bearer $DOSEN1" -H "X-Device-ID: DEV-DOSEN1-01" \
  -H "Content-Type: application/json" -d '{"nilai_angka":95}'

# finalisasi kedua kali → 409
curl -s -i -X POST $G/kelas/1/finalisasi -H "Authorization: Bearer $DOSEN1" -H "X-Device-ID: DEV-DOSEN1-01"
```

### C8. Service tidak bisa diakses langsung (bypass gateway)

Ambil nilai `GATEWAY_SECRET` dari file `.env`, lalu:

```bash
# tanpa secret → 403
curl -s -i http://localhost:3001/nilai -H "Authorization: Bearer $MHS1"
curl -s -i http://localhost:3002/transkrip/2210001 -H "Authorization: Bearer $ADMIN"

# secret salah → 403
curl -s -i http://localhost:3001/nilai -H "X-Gateway-Secret: tebakan" -H "Authorization: Bearer $MHS1"

# secret BENAR tapi tanpa token → 401  (verifikasi ulang di service)
SECRET='isi-GATEWAY_SECRET-dari-.env'
curl -s -i http://localhost:3001/nilai -H "X-Gateway-Secret: $SECRET"

# secret BENAR + token palsu → 401
curl -s -i http://localhost:3001/nilai -H "X-Gateway-Secret: $SECRET" -H "Authorization: Bearer abc.def.ghi"

# secret BENAR + token admin ke sinkron (langsung ke Transkrip) → 403
curl -s -i -X POST http://localhost:3002/transkrip/sinkron -H "X-Gateway-Secret: $SECRET" \
  -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" -d '{"kelas_id":1}'
```

### C9. Refresh & logout

```bash
R=$(login mhs2 'Mhs12345!' DEV-MHS2-01)
RT=$(echo "$R" | node -pe 'JSON.parse(require("fs").readFileSync(0)).refresh_token')
AT=$(echo "$R" | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')

# refresh → 200 + token baru (token lama otomatis dicabut)
curl -s -X POST $G/auth/refresh -H "Content-Type: application/json" -d "{\"refresh_token\":\"$RT\"}"

# pakai refresh token lama lagi → 401 (dan seluruh sesi mhs2 dicabut)
curl -s -i -X POST $G/auth/refresh -H "Content-Type: application/json" -d "{\"refresh_token\":\"$RT\"}"

# logout: login lagi, lalu
R=$(login mhs3 'Mhs12345!' DEV-MHS3-01)
RT=$(echo "$R" | node -pe 'JSON.parse(require("fs").readFileSync(0)).refresh_token')
AT=$(echo "$R" | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')
curl -s -X POST $G/auth/logout -H "Authorization: Bearer $AT" -H "Content-Type: application/json" -d "{\"refresh_token\":\"$RT\"}"   # 200
curl -s -i -X POST $G/auth/refresh -H "Content-Type: application/json" -d "{\"refresh_token\":\"$RT\"}"                              # 401
curl -s -i $G/nilai -H "Authorization: Bearer $AT" -H "X-Device-ID: DEV-MHS3-01"                                                   # 401 (token dicabut)
```

### C10. Token kedaluwarsa (demo)

Ubah `.env` → `ACCESS_TOKEN_TTL=10s`, restart server, login, tunggu 15 detik, lalu akses `/nilai`
→ **401 token kedaluwarsa**. **Kembalikan ke `10m`** setelahnya (ketentuan tugas: 10 menit).

### C11. Lihat audit log (4.4)

```bash
npm run audit             # 20 baris terakhir
npm run audit -- 50       # 50 baris terakhir
npm run audit -- deny     # hanya yang ditolak
```
Kolom: `ts` (waktu), `subject` (user/`service:...`), `role`, `method`, `endpoint`, `device`, `result` (allow/deny), `reason` (alasan).

---

## D. Testing otomatis

Dengan server berjalan (`npm start`), di terminal kedua:

```bash
npm test
```

Hasil yang diharapkan di akhir: `==== HASIL: 59 lulus, 0 gagal ====` (jika sedang di dalam jam akses;
di luar jam akses ±54 karena test PUT/finalisasi sukses dilewati dan test lain memeriksa penolakannya).
Test ini otomatis menjalankan `npm run seed` di awal.

---

## E. Tutorial Postman

### E1. Import (sekali saja)

1. Buka Postman → klik **Import** (pojok kiri atas).
2. Seret kedua file dari folder `postman/` ke jendela import:
   * `SistemNilai-ZeroTrust.postman_collection.json`
   * `SistemNilai-ZeroTrust.postman_environment.json`
3. Klik **Import**. Collection **"Sistem Nilai - Zero Trust"** muncul di sidebar kiri (Collections),
   environment muncul di tab **Environments**.
4. Di pojok kanan atas Postman, **pilih environment "Sistem Nilai Zero Trust"** pada dropdown
   (tulisan "No environment" → ganti). *Ini wajib, kalau tidak variabel `{{base_url}}` kosong.*
5. Buka tab Environments → pastikan `gateway_secret` **sama persis** dengan `GATEWAY_SECRET` di `.env`
   (jika kamu mengubahnya) dan `in_hours` = `true` bila sekarang di dalam jam akses, `false` bila di luar.

### E2. Menjalankan seluruh tes sekaligus (Collection Runner)

1. Jalankan `npm run seed` di terminal (reset data).
2. Klik kanan collection **Sistem Nilai - Zero Trust → Run collection** (atau tombol **Run**).
3. Pastikan urutan folder 0 → 6, environment terpilih, **centang semua request**, lalu **Run Sistem Nilai...**.
4. Hasil: semua request hijau (PASS). Jumlah test ±67. Klik request mana pun untuk melihat respons dan test-nya.
5. Mau mengulang? `npm run seed` lagi (karena finalisasi hanya bisa sekali per kelas) lalu Run ulang.

| Folder | Yang diuji |
|---|---|
| **0. Login semua role** | Login 6 user + token service, token disimpan otomatis ke environment. **Jalankan pertama.** |
| 1. Autentikasi & device | Password salah, device tidak terdaftar, tanpa token, token sampah/palsu, tanpa/salah X-Device-ID |
| 2. Nilai | GET nilai per role, PUT oleh mahasiswa/dosen lain/pengampu, validasi jam akses |
| 3. Transkrip & sinkron | Hak akses transkrip, sinkron hanya untuk token service |
| 4. Finalisasi | Finalisasi + sinkron ke transkrip, nilai final tak bisa diubah, finalisasi ganda |
| 5. Bypass gateway | Akses langsung port 3001/3002 tanpa secret / token palsu |
| 6. Refresh & logout | Rotasi refresh token, pemakaian ulang, logout mencabut token |

### E3. Menjalankan request satu per satu (cocok untuk video)

1. Jalankan folder **0** dulu (klik kanan folder → **Run folder**) agar semua token terisi
   (atau klik tiap request lalu **Send**).
2. Buka folder lain, klik request → **Send**.
3. Lihat tiga hal: **Status** (kanan atas respons), **Body** respons, dan tab **Test Results**.
4. Token berlaku 10 menit. Kalau tiba-tiba semua 401 → jalankan folder 0 lagi.

### E4. Membuat request sendiri secara manual (kalau ingin mencoba di luar collection)

Contoh: lihat nilai sebagai dosen1.
1. **New → HTTP Request**, method `GET`, URL `{{base_url}}/nilai`.
2. Tab **Headers** tambahkan:
   * `Authorization` = `Bearer {{dosen1_token}}`
   * `X-Device-ID` = `DEV-DOSEN1-01`
3. **Send**. Contoh untuk request ber-body (`PUT /nilai/1`): tab **Body → raw → JSON** isi `{"nilai_angka": 91}`
   dan tambahkan header `Content-Type: application/json` (otomatis jika memilih JSON).

### E5. Mengubah ke skenario "di luar jam akses"

1. Edit `.env`: `ACCESS_START=03:00` dan `ACCESS_END=03:01` (jam yang pasti bukan sekarang) → restart server (`Ctrl+C`, `npm start`).
2. `npm run seed`.
3. Di Postman, environment: ubah `in_hours` menjadi `false`.
4. Run collection. Semua tes tetap hijau; request PUT dan finalisasi dosen1 yang tadinya 200 kini **403** dengan alasan "di luar jam akses".
5. Kembalikan `.env` ke `07:00`–`21:00` setelah selesai.

### E6. Cara membaca hasil di Postman

* **Test Results → PASS/FAIL** per request.
* Kalau FAIL, lihat Status & Body-nya; pesan `reason` menjelaskan kebijakan mana yang menolak.
* Bandingkan dengan terminal server (`[audit] DENY ...`) atau `npm run audit`.

---

## F. Demo jam akses (4.3)

Ada dua cara memperlihatkan jam akses ditolak, pilih salah satu di video:

1. **Ubah konfigurasi** (cara paling jelas): di `.env` set `ACCESS_START=03:00`, `ACCESS_END=03:01`, restart server,
   kirim `PUT /nilai/1` sebagai dosen1 → **403** `di luar jam akses (03:00-03:01 Asia/Jakarta)`. Lalu set `ACCESS_START=00:00`,
   `ACCESS_END=24:00`, restart → request sama menjadi **200**. Kembalikan ke 07:00–21:00.
2. Tunjukkan kodenya: `shared/time.js` → `isWithinAccessHours()` dan pemanggilannya di `gateway/policy.js`
   (`rulePutNilai`, `ruleFinalisasi`).

---

## G. Skrip video demo (6–9 menit)

Persyaratan: *menjelaskan bagaimana setiap kebutuhan bagian 4 diterapkan dengan menunjukkan bagian kode yang menanganinya.*
Siapkan: VS Code (kode), terminal server, Postman. `npm run seed` sebelum mulai.

| Waktu | Yang dilakukan | Kode yang ditunjukkan |
|---|---|---|
| 0:00–0:50 | Perkenalan (nama, NIM), tampilkan gambar arsitektur & struktur folder. Jalankan `npm start`; sebut 3 port. | `README.md`, `start-all.js` |
| 0:50–2:10 | **4.1 Autentikasi & token.** Login di Postman, tunjukkan `access_token` & `refresh_token`. Decode JWT di jwt.io (sub, role, exp 10 menit). Jelaskan refresh token disimpan **hash**-nya di DB & bisa dicabut; tunjukkan logout. Tunjukkan `POST /auth/service` (5 menit, role service). | `shared/tokens.js` (`signAccessToken`, `signServiceToken`), `gateway/auth.routes.js` (`/login`, `/refresh`, `/logout`, `/service`), tabel `refresh_tokens` di `shared/db.js` |
| 2:10–3:20 | **Gateway secret & verifikasi ulang.** Tunjukkan gateway menambah `X-Gateway-Secret`. Demo folder 5: akses langsung port 3001 → 403; secret benar tanpa token → 401; token palsu → 401. | `gateway/index.js` (`forward`), `shared/guards.js` (`gatewayGuard`, `tokenGuard`), `service-nilai/index.js` (baris `app.use(gatewayGuard...)`) |
| 3:20–5:30 | **4.2 Kebijakan akses.** Jelaskan Policy Engine membaca DB (kepemilikan kelas, NIM, status final). Demo per tabel 3: mhs lihat nilai sendiri/orang lain, dosen2 ubah kelas dosen1, mahasiswa ke `/transkrip/sinkron`, token admin ke sinkron. | `gateway/policy.js` (`ruleGetNilai`, `rulePutNilai`, `ruleFinalisasi`, `ruleGetTranskrip`, `ruleSinkron`, tabel `ROUTES`) |
| 5:30–6:30 | **4.3 Verifikasi konteks.** Device: login dengan `DEV-HACKER-99` → 403; token dipakai di device lain → 403. Jam akses: ubah `.env` ke 03:00–03:01, restart, PUT → 403; kembalikan. | `gateway/index.js` (cek device di PEP), `gateway/auth.routes.js` (cek device di login), `shared/time.js`, `.env` |
| 6:30–7:40 | **Finalisasi + panggilan antar-service.** Finalisasi kelas 1 oleh dosen1 → cek transkrip mhs1 terisi. Jelaskan Service Nilai mengambil token service lalu memanggil sinkron **melalui gateway**. Coba ubah nilai setelah final → 403. | `service-nilai/index.js` (`getServiceToken`, `POST /kelas/:id/finalisasi`), `service-transkrip/index.js` (`POST /transkrip/sinkron`) |
| 7:40–8:30 | **4.4 Audit log.** Jalankan `npm run audit`; tunjukkan baris allow & deny, termasuk `service:service-nilai` ke `/transkrip/sinkron`. Tunjukkan kolom waktu, subjek, endpoint, device, hasil, alasan. | `gateway/audit.js`, tabel `audit_log`, `gateway/index.js` (pemanggilan `audit`) |
| 8:30–9:00 | Jalankan `npm test` (hijau semua) lalu simpulkan: *never trust, always verify*, *least privilege*, *assume breach* → di mana masing-masing diterapkan. | `README.md` bagian 6 |

Tips rekam: perbesar font VS Code (Ctrl + `+`), jalankan `npm run seed` tepat sebelum rekam, siapkan Postman dengan folder 0 sudah dijalankan,
dan jangan lebih dari 9 menit (kalau lebih, percepat bagian 4.1).

---

## H. Troubleshooting

| Masalah | Penyebab / solusi |
|---|---|
| `npm install` gagal di `better-sqlite3` | Pakai Node **LTS 20/22** (bukan versi terlalu baru/lama). Di Windows kalau masih gagal: install *Visual Studio Build Tools* (workload "Desktop development with C++") lalu ulangi, atau ganti versi Node. |
| `EADDRINUSE` (port dipakai) | Aplikasi lain memakai 3000/3001/3002, atau server lama belum mati. Tutup terminal lama, atau ubah port di `.env` (`GATEWAY_PORT`, `NILAI_PORT`, `TRANSKRIP_PORT` **dan** `GATEWAY_URL`, `NILAI_URL`, `TRANSKRIP_URL`). |
| Postman: "Could not send request" | Server belum jalan (`npm start`) atau environment belum dipilih. |
| Semua 401 tiba-tiba | Access token 10 menit sudah habis → jalankan lagi folder **0. Login**. |
| PUT/finalisasi 403 "di luar jam akses" padahal harusnya 200 | Sekarang di luar 07:00–21:00 WIB. Set `.env` `ACCESS_START=00:00`, `ACCESS_END=24:00` lalu restart, dan `in_hours=true` di Postman. |
| Finalisasi 409 "sudah difinalisasi" / PUT 403 "sudah final" | Data sudah final dari tes sebelumnya → `npm run seed`. |
| Test Postman folder 5 (bypass) gagal 401 bukan 200 | `gateway_secret` di environment beda dengan `.env`; samakan. |
| `curl` error "Unexpected token" di Windows | Pakai Git Bash, bukan CMD/PowerShell. |
| `Cannot find module 'express'` | Belum `npm install`, atau terminal tidak di folder project. |
| Ubah `.env` tapi tidak berefek | Server harus di-restart setelah mengubah `.env`. |
| Zona waktu salah | Set `TIMEZONE` di `.env` (default `Asia/Jakarta`). |

---

## I. Checklist pengumpulan

- [ ] Repository (GitHub/GitLab) berisi seluruh kode (jangan commit `node_modules` & file `.db` – sudah ada di `.gitignore`).
- [ ] `README.md` berisi cara menjalankan, daftar akun, dan device ID data awal (sudah tersedia).
- [ ] Seed: 1 admin, 2 dosen, 3 mahasiswa, 2 kelas beda dosen, tiap user 1 device (sudah).
- [ ] Video demo 6–9 menit yang menunjukkan kode untuk tiap kebutuhan bagian 4.
- [ ] `npm test` hijau & collection Postman hijau sebelum rekam.
- [ ] Ganti `JWT_SECRET` dan `GATEWAY_SECRET` di `.env` dengan nilai acak milikmu sendiri (jangan pakai contoh).
