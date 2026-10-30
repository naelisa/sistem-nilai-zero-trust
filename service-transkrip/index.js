const express = require("express");
const cfg = require("../shared/config");
const db = require("../shared/db");
const { BOBOT } = require("../shared/grade");
const {
  gatewayGuard,
  tokenGuard,
  requireUserRole,
  requireServiceToken,
} = require("../shared/guards");

const app = express();
app.disable("x-powered-by");

app.use(gatewayGuard("service-transkrip"));
app.use(tokenGuard);
app.use(express.json());

app.post("/transkrip/sinkron", requireServiceToken, (req, res) => {
  const b = req.body || {};
  const validItem = (i) =>
    i &&
    typeof i.nim === "string" &&
    typeof i.nilai_angka === "number" &&
    i.nilai_angka >= 0 &&
    i.nilai_angka <= 100 &&
    ["A", "B", "C", "D", "E"].includes(i.nilai_huruf);

  if (
    !Number.isInteger(b.kelas_id) ||
    typeof b.kode_mk !== "string" ||
    typeof b.nama_mk !== "string" ||
    !Number.isInteger(b.sks) ||
    !Array.isArray(b.items) ||
    b.items.length === 0 ||
    !b.items.every(validItem)
  ) {
    return res.status(400).json({
      error:
        "Body tidak valid. Wajib: kelas_id, kode_mk, nama_mk, sks, items[{nim, nilai_angka, nilai_huruf}]",
    });
  }

  const upsert = db.prepare(`
    INSERT INTO transkrip (nim, kelas_id, kode_mk, nama_mk, sks, nilai_angka, nilai_huruf, synced_at)
    VALUES (@nim, @kelas_id, @kode_mk, @nama_mk, @sks, @nilai_angka, @nilai_huruf, @synced_at)
    ON CONFLICT (nim, kelas_id) DO UPDATE SET
      kode_mk = excluded.kode_mk, nama_mk = excluded.nama_mk, sks = excluded.sks,
      nilai_angka = excluded.nilai_angka, nilai_huruf = excluded.nilai_huruf, synced_at = excluded.synced_at
  `);
  const now = new Date().toISOString();
  db.transaction((items) => {
    for (const i of items) {
      upsert.run({
        nim: i.nim,
        kelas_id: b.kelas_id,
        kode_mk: b.kode_mk,
        nama_mk: b.nama_mk,
        sks: b.sks,
        nilai_angka: i.nilai_angka,
        nilai_huruf: i.nilai_huruf,
        synced_at: now,
      });
    }
  })(b.items);

  res.json({
    message: "Sinkron transkrip berhasil",
    kelas_id: b.kelas_id,
    jumlah_diterima: b.items.length,
  });
});

app.get(
  "/transkrip/:nim",
  requireUserRole("mahasiswa", "admin"),
  (req, res) => {
    const nim = req.params.nim;
    if (req.user.role === "mahasiswa" && req.user.nim !== nim) {
      return res
        .status(403)
        .json({ error: "Mahasiswa hanya boleh melihat transkrip NIM sendiri" });
    }
    const mhs = db
      .prepare(
        "SELECT nama, nim FROM users WHERE nim = ? AND role = 'mahasiswa'",
      )
      .get(nim);
    if (!mhs)
      return res
        .status(404)
        .json({ error: "Mahasiswa dengan NIM tersebut tidak ditemukan" });

    const matkul = db
      .prepare(
        `
    SELECT kelas_id, kode_mk, nama_mk, sks, nilai_angka, nilai_huruf, synced_at
    FROM transkrip WHERE nim = ? ORDER BY kode_mk
  `,
      )
      .all(nim);
    const totalSks = matkul.reduce((s, m) => s + m.sks, 0);
    const mutu = matkul.reduce((s, m) => s + BOBOT[m.nilai_huruf] * m.sks, 0);

    res.json({
      nim: mhs.nim,
      nama: mhs.nama,
      total_sks: totalSks,
      ipk: totalSks ? Number((mutu / totalSks).toFixed(2)) : 0,
      mata_kuliah: matkul,
    });
  },
);

app.use((req, res) =>
  res.status(404).json({ error: "Endpoint tidak ada di Service Transkrip" }),
);

app.listen(cfg.TRANSKRIP_PORT, cfg.HOST, () => {
  console.log(
    `[service-transkrip] berjalan di http://${cfg.HOST}:${cfg.TRANSKRIP_PORT} (hanya menerima request dari gateway)`,
  );
});
