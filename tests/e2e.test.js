// Test otomatis seluruh skenario zero trust.
// Prasyarat: server sudah jalan (npm start) di terminal lain.   Jalankan: npm test
// Test ini me-reset data (npm run seed) di awal supaya hasilnya konsisten.
const { execFileSync } = require("child_process");
const path = require("path");
const jwt = require("jsonwebtoken");
const cfg = require("../shared/config");
const { isWithinAccessHours } = require("../shared/time");

const GW = cfg.GATEWAY_URL;
const inHours = isWithinAccessHours();
let pass = 0,
  fail = 0;

function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}`);
  } else {
    fail++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${name} ${extra}`);
  }
}

async function call(method, url, { token, device, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (device) h["x-device-id"] = device;
  if (body !== undefined) h["content-type"] = "application/json";
  const r = await fetch(url, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await r.json();
  } catch (_) {
    /* bukan JSON */
  }
  return { status: r.status, json };
}
const gw = (m, p, o) => call(m, GW + p, o);

async function login(username, password, device) {
  return gw("POST", "/auth/login", { body: { username, password }, device });
}

(async () => {
  console.log(
    `Jam akses ${cfg.ACCESS_START}-${cfg.ACCESS_END} ${cfg.TIMEZONE} -> sekarang ${inHours ? "DI DALAM" : "DI LUAR"} jam akses`,
  );
  execFileSync(
    process.execPath,
    [path.join(__dirname, "..", "scripts", "seed.js")],
    { stdio: "inherit" },
  );

  console.log("\n[1] Autentikasi & device");
  let r = await login("mhs1", "Mhs12345!", "DEV-MHS1-01");
  check(
    "login mhs1 (device benar) -> 200 + access & refresh token",
    r.status === 200 && r.json.access_token && r.json.refresh_token,
  );
  const mhs1 = r.json;
  check(
    "access token berlaku 10 menit (600 detik)",
    cfg.ACCESS_TOKEN_TTL !== "10m" || mhs1.expires_in === 600,
    `expires_in=${mhs1.expires_in}`,
  );
  const claims = jwt.decode(mhs1.access_token);
  check(
    "JWT berisi sub dan role",
    claims.sub === "mhs1" && claims.role === "mahasiswa",
  );

  r = await login("mhs1", "salah", "DEV-MHS1-01");
  check("login password salah -> 401", r.status === 401);
  r = await login("mhs1", "Mhs12345!", "DEV-TIDAK-TERDAFTAR");
  check("login device tidak terdaftar -> 403", r.status === 403);
  r = await login("mhs1", "Mhs12345!", "DEV-MHS2-01");
  check("login pakai device milik user lain -> 403", r.status === 403);
  r = await login("mhs1", "Mhs12345!");
  check("login tanpa X-Device-ID -> 403", r.status === 403);

  const dosen1 = (await login("dosen1", "Dosen123!", "DEV-DOSEN1-01")).json;
  const dosen2 = (await login("dosen2", "Dosen123!", "DEV-DOSEN2-01")).json;
  const admin = (await login("admin", "Admin123!", "DEV-ADMIN-01")).json;

  console.log("\n[2] Never trust, always verify (token & device di gateway)");
  r = await gw("GET", "/nilai", { device: "DEV-MHS1-01" });
  check("tanpa token -> 401", r.status === 401);
  r = await gw("GET", "/nilai", {
    token: "abc.def.ghi",
    device: "DEV-MHS1-01",
  });
  check("token sampah -> 401", r.status === 401);
  const forged = jwt.sign(
    { sub: "admin", role: "admin", typ: "access" },
    "kunci-palsu",
    { expiresIn: "10m" },
  );
  r = await gw("GET", "/transkrip/2210001", {
    token: forged,
    device: "DEV-ADMIN-01",
  });
  check("token dipalsukan (tanda tangan salah) -> 401", r.status === 401);
  const expired = jwt.sign(
    { sub: "mhs1", role: "mahasiswa", typ: "access" },
    cfg.JWT_SECRET,
    { expiresIn: -10 },
  );
  r = await gw("GET", "/nilai", { token: expired, device: "DEV-MHS1-01" });
  check("token kedaluwarsa -> 401", r.status === 401);
  r = await gw("GET", "/nilai", { token: mhs1.access_token });
  check("token valid tanpa X-Device-ID -> 403", r.status === 403);
  r = await gw("GET", "/nilai", {
    token: mhs1.access_token,
    device: "DEV-MHS2-01",
  });
  check("token valid + device milik orang lain -> 403", r.status === 403);

  console.log("\n[3] GET /nilai");
  r = await gw("GET", "/nilai", {
    token: mhs1.access_token,
    device: "DEV-MHS1-01",
  });
  check(
    "mhs1 -> 200 dan hanya nilai NIM 2210001",
    r.status === 200 &&
      r.json.data.length === 2 &&
      r.json.data.every((n) => n.nim === "2210001"),
  );
  r = await gw("GET", "/nilai?nim=2210002", {
    token: mhs1.access_token,
    device: "DEV-MHS1-01",
  });
  check("mhs1 minta nilai NIM lain -> 403", r.status === 403);
  r = await gw("GET", "/nilai", {
    token: dosen1.access_token,
    device: "DEV-DOSEN1-01",
  });
  check(
    "dosen1 -> 200 dan hanya kelas 1 (3 mahasiswa)",
    r.status === 200 &&
      r.json.data.length === 3 &&
      r.json.data.every((n) => n.kelas_id === 1),
  );
  r = await gw("GET", "/nilai?kelas_id=2", {
    token: dosen1.access_token,
    device: "DEV-DOSEN1-01",
  });
  check("dosen1 minta kelas dosen2 -> 403", r.status === 403);
  r = await gw("GET", "/nilai", {
    token: admin.access_token,
    device: "DEV-ADMIN-01",
  });
  check("admin melihat nilai -> 403", r.status === 403);

  console.log("\n[4] PUT /nilai/:id");
  r = await gw("PUT", "/nilai/1", {
    token: mhs1.access_token,
    device: "DEV-MHS1-01",
    body: { nilai_angka: 100 },
  });
  check("mahasiswa ubah nilai -> 403", r.status === 403);
  r = await gw("PUT", "/nilai/1", {
    token: dosen2.access_token,
    device: "DEV-DOSEN2-01",
    body: { nilai_angka: 100 },
  });
  check("dosen2 ubah nilai kelas dosen1 -> 403", r.status === 403);
  r = await gw("PUT", "/nilai/1", {
    token: dosen1.access_token,
    device: "DEV-DOSEN1-01",
    body: { nilai_angka: 91 },
  });
  check(
    `dosen1 ubah nilai kelasnya -> ${inHours ? "200" : "403 (di luar jam akses)"}`,
    r.status === (inHours ? 200 : 403),
    JSON.stringify(r.json),
  );
  if (inHours) {
    check(
      "nilai terupdate (91 / A)",
      r.json.data.nilai_angka === 91 && r.json.data.nilai_huruf === "A",
    );
    r = await gw("PUT", "/nilai/1", {
      token: dosen1.access_token,
      device: "DEV-DOSEN1-01",
      body: { nilai_angka: 500 },
    });
    check("nilai di luar rentang 0-100 -> 400", r.status === 400);
  }

  console.log("\n[5] GET /transkrip/:nim");
  r = await gw("GET", "/transkrip/2210001", {
    token: mhs1.access_token,
    device: "DEV-MHS1-01",
  });
  check(
    "mhs1 transkrip sendiri -> 200",
    r.status === 200 && r.json.nim === "2210001",
  );
  r = await gw("GET", "/transkrip/2210002", {
    token: mhs1.access_token,
    device: "DEV-MHS1-01",
  });
  check("mhs1 transkrip NIM lain -> 403", r.status === 403);
  r = await gw("GET", "/transkrip/2210002", {
    token: admin.access_token,
    device: "DEV-ADMIN-01",
  });
  check(
    "admin transkrip NIM mana saja -> 200",
    r.status === 200 && r.json.nim === "2210002",
  );
  r = await gw("GET", "/transkrip/2210001", {
    token: dosen1.access_token,
    device: "DEV-DOSEN1-01",
  });
  check("dosen melihat transkrip -> 403", r.status === 403);

  console.log("\n[6] Token service & /transkrip/sinkron");
  const sinkronBody = {
    kelas_id: 1,
    kode_mk: "KA101",
    nama_mk: "Keamanan Informasi",
    sks: 3,
    items: [{ nim: "2210001", nilai_angka: 80, nilai_huruf: "B" }],
  };
  r = await gw("POST", "/transkrip/sinkron", {
    token: admin.access_token,
    device: "DEV-ADMIN-01",
    body: sinkronBody,
  });
  check("token admin ke /transkrip/sinkron -> 403", r.status === 403);
  r = await gw("POST", "/transkrip/sinkron", {
    token: dosen1.access_token,
    device: "DEV-DOSEN1-01",
    body: sinkronBody,
  });
  check("token dosen ke /transkrip/sinkron -> 403", r.status === 403);
  r = await gw("POST", "/auth/service", {
    body: { client_id: "service-nilai", client_secret: "salah" },
  });
  check("POST /auth/service secret salah -> 401", r.status === 401);
  r = await gw("POST", "/auth/service", {
    body: {
      client_id: "service-nilai",
      client_secret: cfg.SERVICE_CLIENT_SECRET,
    },
  });
  check(
    "POST /auth/service benar -> 200, role service, 5 menit",
    r.status === 200 &&
      r.json.role === "service" &&
      (cfg.SERVICE_TOKEN_TTL !== "5m" || r.json.expires_in === 300),
  );
  const svc = r.json;
  r = await gw("GET", "/nilai", { token: svc.access_token });
  check("token service dipakai ke /nilai -> 403", r.status === 403);
  r = await gw("POST", "/transkrip/sinkron", {
    token: svc.access_token,
    body: { kelas_id: "x" },
  });
  check(
    "token service ke /transkrip/sinkron lolos policy tapi body salah -> 400",
    r.status === 400,
  );

  console.log(
    "\n[7] Service tidak bisa diakses langsung (gateway secret + verifikasi ulang)",
  );
  const mhs1Tok = mhs1.access_token;
  r = await call("GET", `${cfg.NILAI_URL}/nilai`, { token: mhs1Tok });
  check("langsung ke Service Nilai tanpa secret -> 403", r.status === 403);
  r = await call("GET", `${cfg.TRANSKRIP_URL}/transkrip/2210001`, {
    token: mhs1Tok,
  });
  check("langsung ke Service Transkrip tanpa secret -> 403", r.status === 403);
  r = await call("GET", `${cfg.NILAI_URL}/nilai`, {
    headers: { "x-gateway-secret": "tebakan-salah" },
    token: mhs1Tok,
  });
  check("secret salah -> 403", r.status === 403);
  r = await call("GET", `${cfg.NILAI_URL}/nilai`, {
    headers: { "x-gateway-secret": cfg.GATEWAY_SECRET },
  });
  check("secret benar tapi tanpa token -> 401", r.status === 401);
  r = await call("GET", `${cfg.NILAI_URL}/nilai`, {
    headers: { "x-gateway-secret": cfg.GATEWAY_SECRET },
    token: forged,
  });
  check("secret benar + token palsu -> 401", r.status === 401);
  r = await call("GET", `${cfg.TRANSKRIP_URL}/transkrip/2210001`, {
    headers: { "x-gateway-secret": cfg.GATEWAY_SECRET },
    token: expired,
  });
  check("secret benar + token kedaluwarsa -> 401", r.status === 401);
  r = await call("POST", `${cfg.TRANSKRIP_URL}/transkrip/sinkron`, {
    headers: { "x-gateway-secret": cfg.GATEWAY_SECRET },
    token: admin.access_token,
    body: sinkronBody,
  });
  check(
    "secret benar + token admin ke sinkron (langsung) -> 403",
    r.status === 403,
  );
  r = await gw("GET", "/nilai", {
    token: mhs1Tok,
    device: "DEV-MHS1-01",
    headers: { "x-gateway-secret": "palsu" },
  });
  check(
    "header X-Gateway-Secret dari client tidak berpengaruh -> tetap 200",
    r.status === 200,
  );

  console.log(
    "\n[8] POST /kelas/:id/finalisasi (+ sinkron ke transkrip lewat gateway)",
  );
  r = await gw("POST", "/kelas/1/finalisasi", {
    token: mhs1.access_token,
    device: "DEV-MHS1-01",
  });
  check("mahasiswa finalisasi -> 403", r.status === 403);
  r = await gw("POST", "/kelas/1/finalisasi", {
    token: dosen2.access_token,
    device: "DEV-DOSEN2-01",
  });
  check("dosen2 finalisasi kelas dosen1 -> 403", r.status === 403);
  r = await gw("POST", "/kelas/1/finalisasi", {
    token: admin.access_token,
    device: "DEV-ADMIN-01",
  });
  check("admin finalisasi -> 403", r.status === 403);
  r = await gw("POST", "/kelas/1/finalisasi", {
    token: dosen1.access_token,
    device: "DEV-DOSEN1-01",
  });
  check(
    `dosen1 finalisasi kelas 1 -> ${inHours ? "200" : "403 (di luar jam akses)"}`,
    r.status === (inHours ? 200 : 403),
    JSON.stringify(r.json),
  );
  if (inHours) {
    r = await gw("GET", "/transkrip/2210001", {
      token: admin.access_token,
      device: "DEV-ADMIN-01",
    });
    check(
      "nilai kelas 1 masuk ke transkrip 2210001 (KA101)",
      r.status === 200 && r.json.mata_kuliah.some((m) => m.kode_mk === "KA101"),
    );
    r = await gw("PUT", "/nilai/2", {
      token: dosen1.access_token,
      device: "DEV-DOSEN1-01",
      body: { nilai_angka: 95 },
    });
    check("ubah nilai setelah final -> 403", r.status === 403);
    r = await gw("POST", "/kelas/1/finalisasi", {
      token: dosen1.access_token,
      device: "DEV-DOSEN1-01",
    });
    check("finalisasi dua kali -> 409", r.status === 409);
  }

  console.log("\n[9] Refresh & logout (token dapat dicabut)");
  const sesi = (await login("mhs2", "Mhs12345!", "DEV-MHS2-01")).json;
  r = await gw("POST", "/auth/refresh", {
    body: { refresh_token: sesi.refresh_token },
  });
  check(
    "refresh -> 200 + token baru",
    r.status === 200 &&
      r.json.access_token &&
      r.json.refresh_token !== sesi.refresh_token,
  );
  const sesi2 = r.json;
  r = await gw("POST", "/auth/refresh", {
    body: { refresh_token: sesi.refresh_token },
  });
  check("refresh token lama dipakai ulang -> 401", r.status === 401);
  r = await gw("POST", "/auth/refresh", {
    body: { refresh_token: sesi2.refresh_token },
  });
  check(
    "pemakaian ulang token lama mencabut semua sesi -> refresh token baru ikut ditolak",
    r.status === 401,
  );

  const s3 = (await login("mhs3", "Mhs12345!", "DEV-MHS3-01")).json;
  r = await gw("GET", "/nilai", {
    token: s3.access_token,
    device: "DEV-MHS3-01",
  });
  check("sebelum logout: akses -> 200", r.status === 200);
  r = await gw("POST", "/auth/logout", {
    token: s3.access_token,
    body: { refresh_token: s3.refresh_token },
  });
  check("logout -> 200", r.status === 200);
  r = await gw("POST", "/auth/refresh", {
    body: { refresh_token: s3.refresh_token },
  });
  check("refresh setelah logout -> 401", r.status === 401);
  r = await gw("GET", "/nilai", {
    token: s3.access_token,
    device: "DEV-MHS3-01",
  });
  check("access token setelah logout -> 401 (dicabut)", r.status === 401);
  r = await gw("POST", "/auth/refresh", { body: { refresh_token: "ngawur" } });
  check("refresh token ngawur -> 401", r.status === 401);

  console.log("\n[10] Audit log");
  const db = require("../shared/db");
  const total = db.prepare("SELECT COUNT(*) n FROM audit_log").get().n;
  const allows = db
    .prepare("SELECT COUNT(*) n FROM audit_log WHERE result='allow'")
    .get().n;
  const denies = db
    .prepare("SELECT COUNT(*) n FROM audit_log WHERE result='deny'")
    .get().n;
  check(
    `audit log terisi (total ${total}: allow ${allows}, deny ${denies})`,
    total > 40 && allows > 0 && denies > 0,
  );
  const svcRow = db
    .prepare(
      "SELECT * FROM audit_log WHERE subject = 'service:service-nilai' AND endpoint = '/transkrip/sinkron'",
    )
    .get();
  check(
    "keputusan panggilan antar-service tercatat (service:service-nilai)",
    inHours ? !!svcRow : true,
  );
  const sample = db
    .prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 1")
    .get();
  check(
    "kolom audit lengkap (ts, subject, endpoint, result, reason)",
    sample.ts &&
      sample.subject &&
      sample.endpoint &&
      sample.result &&
      sample.reason,
  );

  console.log(`\n==== HASIL: ${pass} lulus, ${fail} gagal ====`);
  if (!inHours)
    console.log(
      "Catatan: sekarang di luar jam akses, jadi test PUT/finalisasi yang sukses dilewati. Ubah ACCESS_START/ACCESS_END di .env lalu restart server untuk menguji sisanya.",
    );
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("Test error (server sudah jalan?):", e);
  process.exit(2);
});
