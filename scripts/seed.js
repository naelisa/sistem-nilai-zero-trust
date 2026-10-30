const db = require("../shared/db");
const cfg = require("../shared/config");
const { hashPassword } = require("../shared/security");
const { toHuruf } = require("../shared/grade");

const USERS = [
  [1, "admin", "Admin123!", "admin", "Administrator Akademik", null],
  [2, "dosen1", "Dosen123!", "dosen", "Dr. Budi Santoso", null],
  [3, "dosen2", "Dosen123!", "dosen", "Dr. Sari Lestari", null],
  [4, "mhs1", "Mhs12345!", "mahasiswa", "Andi Pratama", "2210001"],
  [5, "mhs2", "Mhs12345!", "mahasiswa", "Siti Rahma", "2210002"],
  [6, "mhs3", "Mhs12345!", "mahasiswa", "Rizky Fauzan", "2210003"],
];
const DEVICES = {
  admin: "DEV-ADMIN-01",
  dosen1: "DEV-DOSEN1-01",
  dosen2: "DEV-DOSEN2-01",
  mhs1: "DEV-MHS1-01",
  mhs2: "DEV-MHS2-01",
  mhs3: "DEV-MHS3-01",
};
const KELAS = [
  [1, "KA101", "Keamanan Informasi", 3, 2], // diampu dosen1
  [2, "IF202", "Basis Data", 3, 3], // diampu dosen2
];
const NILAI = [
  // id, kelas_id, nim, angka
  [1, 1, "2210001", 88],
  [2, 1, "2210002", 76],
  [3, 1, "2210003", 62],
  [4, 2, "2210001", 90],
  [5, 2, "2210002", 58],
  [6, 2, "2210003", 81],
];

function runSeed() {
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const t of [
      "audit_log",
      "revoked_access",
      "refresh_tokens",
      "transkrip",
      "nilai",
      "kelas",
      "devices",
      "service_clients",
      "users",
    ]) {
      db.prepare(`DELETE FROM ${t}`).run();
    }
    const addUser = db.prepare(
      "INSERT INTO users (id, username, password_hash, role, nama, nim) VALUES (?,?,?,?,?,?)",
    );
    for (const [id, u, p, role, nama, nim] of USERS)
      addUser.run(id, u, hashPassword(p), role, nama, nim);

    const addDev = db.prepare(
      "INSERT INTO devices (user_id, device_id) VALUES (?, ?)",
    );
    for (const [id, u] of USERS) addDev.run(id, DEVICES[u]);

    const addKelas = db.prepare(
      "INSERT INTO kelas (id, kode, nama, sks, dosen_id) VALUES (?,?,?,?,?)",
    );
    for (const k of KELAS) addKelas.run(...k);

    const addNilai = db.prepare(
      "INSERT INTO nilai (id, kelas_id, mahasiswa_nim, nilai_angka, nilai_huruf, final, updated_at) VALUES (?,?,?,?,?,0,?)",
    );
    for (const [id, kid, nim, a] of NILAI)
      addNilai.run(id, kid, nim, a, toHuruf(a), now);

    db.prepare(
      "INSERT INTO service_clients (client_id, secret_hash, nama) VALUES (?,?,?)",
    ).run(
      cfg.SERVICE_CLIENT_ID,
      hashPassword(cfg.SERVICE_CLIENT_SECRET),
      "Service Nilai",
    );
  })();
}

module.exports = { runSeed };

if (require.main === module) {
  runSeed();
  console.log("Seed selesai.\n");
  console.table(
    USERS.map(([id, username, password, role, nama, nim]) => ({
      username,
      password,
      role,
      nim: nim || "-",
      device_id: DEVICES[username],
    })),
  );
  console.log(
    `Service client: ${cfg.SERVICE_CLIENT_ID} / ${cfg.SERVICE_CLIENT_SECRET}`,
  );
}
