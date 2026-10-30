#!/usr/bin/env bash
# Demo curl berurutan. Jalankan di Git Bash / macOS / Linux saat server hidup:  bash tests/demo.sh
# Sebelum merekam: npm run seed  (supaya nilai belum final)
G=${G:-http://localhost:3000}
tok() { # tok <user> <password> <device>  -> mencetak access token
  curl -s -X POST "$G/auth/login" -H "Content-Type: application/json" -H "X-Device-ID: $3" \
    -d "{\"username\":\"$1\",\"password\":\"$2\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token'
}
show() { echo; echo "### $1"; }
req()  { curl -s -w "\n   -> HTTP %{http_code}\n" "$@"; }

MHS1=$(tok mhs1 'Mhs12345!' DEV-MHS1-01)
DOSEN1=$(tok dosen1 'Dosen123!' DEV-DOSEN1-01)
DOSEN2=$(tok dosen2 'Dosen123!' DEV-DOSEN2-01)
ADMIN=$(tok admin 'Admin123!' DEV-ADMIN-01)

show "1. Login dari device TIDAK terdaftar (harus 403)"
req -X POST "$G/auth/login" -H "Content-Type: application/json" -H "X-Device-ID: DEV-HACKER-99" -d '{"username":"mhs1","password":"Mhs12345!"}'

show "2. Tanpa token (harus 401)"
req "$G/nilai" -H "X-Device-ID: DEV-MHS1-01"

show "3. mhs1 melihat nilainya sendiri (200)"
req "$G/nilai" -H "Authorization: Bearer $MHS1" -H "X-Device-ID: DEV-MHS1-01"

show "4. mhs1 mengintip nilai NIM lain (harus 403)"
req "$G/nilai?nim=2210002" -H "Authorization: Bearer $MHS1" -H "X-Device-ID: DEV-MHS1-01"

show "5. mhs1 mengubah nilai (harus 403)"
req -X PUT "$G/nilai/1" -H "Authorization: Bearer $MHS1" -H "X-Device-ID: DEV-MHS1-01" -H "Content-Type: application/json" -d '{"nilai_angka":100}'

show "6. dosen2 mengubah nilai kelas dosen1 (harus 403)"
req -X PUT "$G/nilai/1" -H "Authorization: Bearer $DOSEN2" -H "X-Device-ID: DEV-DOSEN2-01" -H "Content-Type: application/json" -d '{"nilai_angka":100}'

show "7. dosen1 mengubah nilai kelasnya (200 di dalam jam akses, 403 di luar)"
req -X PUT "$G/nilai/1" -H "Authorization: Bearer $DOSEN1" -H "X-Device-ID: DEV-DOSEN1-01" -H "Content-Type: application/json" -d '{"nilai_angka":91}'

show "8. Akses LANGSUNG ke Service Nilai :3001 tanpa gateway secret (harus 403)"
req "http://localhost:3001/nilai" -H "Authorization: Bearer $MHS1"

show "9. Token admin ke /transkrip/sinkron (harus 403: hanya token service)"
req -X POST "$G/transkrip/sinkron" -H "Authorization: Bearer $ADMIN" -H "X-Device-ID: DEV-ADMIN-01" -H "Content-Type: application/json" -d '{"kelas_id":1}'

show "10. Transkrip mhs1 SEBELUM finalisasi (kosong)"
req "$G/transkrip/2210001" -H "Authorization: Bearer $MHS1" -H "X-Device-ID: DEV-MHS1-01"

show "11. dosen1 finalisasi kelas 1 -> sinkron ke transkrip lewat gateway (200 di dalam jam akses)"
req -X POST "$G/kelas/1/finalisasi" -H "Authorization: Bearer $DOSEN1" -H "X-Device-ID: DEV-DOSEN1-01"

show "12. Transkrip mhs1 SETELAH finalisasi (terisi)"
req "$G/transkrip/2210001" -H "Authorization: Bearer $MHS1" -H "X-Device-ID: DEV-MHS1-01"

show "13. mhs1 membuka transkrip mhs2 (harus 403)"
req "$G/transkrip/2210002" -H "Authorization: Bearer $MHS1" -H "X-Device-ID: DEV-MHS1-01"

show "14. admin membuka transkrip mhs2 (200)"
req "$G/transkrip/2210002" -H "Authorization: Bearer $ADMIN" -H "X-Device-ID: DEV-ADMIN-01"

show "15. dosen1 mengubah nilai setelah final (harus 403)"
req -X PUT "$G/nilai/2" -H "Authorization: Bearer $DOSEN1" -H "X-Device-ID: DEV-DOSEN1-01" -H "Content-Type: application/json" -d '{"nilai_angka":95}'

echo; echo "### 16. Audit log (lihat di terminal lain:  npm run audit)"
