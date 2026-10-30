const express = require("express");
const cfg = require("../shared/config");
const db = require("../shared/db");
const { toHuruf } = require("../shared/grade");
const {
  gatewayGuard,
  tokenGuard,
  requireUserRole,
} = require("../shared/guards");

const app = express();
app.disable("x-powered-by");

app.use(gatewayGuard("service-nilai"));
app.use(tokenGuard);
app.use(express.json());

const SELECT_NILAI = `
  SELECT n.id, n.kelas_id, k.kode, k.nama AS kelas, n.mahasiswa_nim AS nim,
         m.nama AS mahasiswa, n.nilai_angka, n.nilai_huruf, n.final, n.updated_at
  FROM nilai n
  JOIN kelas k ON k.id = n.kelas_id
  LEFT JOIN users m ON m.nim = n.mahasiswa_nim
`;

app.get("/nilai", requireUserRole("mahasiswa", "dosen"), (req, res) => {
  const u = req.user;
  let rows;
  if (u.role === "mahasiswa") {
    rows = db
      .prepare(`${SELECT_NILAI} WHERE n.mahasiswa_nim = ? ORDER BY n.id`)
      .all(u.nim);
  } else if (typeof req.query.kelas_id === "string") {
    rows = db
      .prepare(
        `${SELECT_NILAI} WHERE k.dosen_id = ? AND k.id = ? ORDER BY n.id`,
      )
      .all(u.id, Number(req.query.kelas_id));
  } else {
    rows = db
      .prepare(`${SELECT_NILAI} WHERE k.dosen_id = ? ORDER BY n.id`)
      .all(u.id);
  }
  res.json({ data: rows });
});

app.put("/nilai/:id", requireUserRole("dosen"), (req, res) => {
  const id = Number(req.params.id);
  const angka = req.body && req.body.nilai_angka;
  if (
    !Number.isInteger(id) ||
    typeof angka !== "number" ||
    !Number.isFinite(angka) ||
    angka < 0 ||
    angka > 100
  ) {
    return res
      .status(400)
      .json({ error: "nilai_angka wajib berupa angka 0-100" });
  }
  const row = db
    .prepare(
      "SELECT n.*, k.dosen_id FROM nilai n JOIN kelas k ON k.id = n.kelas_id WHERE n.id = ?",
    )
    .get(id);
  if (!row) return res.status(404).json({ error: "Nilai tidak ditemukan" });
  if (row.dosen_id !== req.user.id)
    return res.status(403).json({ error: "Bukan dosen pengampu kelas ini" });
  if (row.final) return res.status(409).json({ error: "Nilai sudah final" });

  db.prepare(
    "UPDATE nilai SET nilai_angka = ?, nilai_huruf = ?, updated_at = ? WHERE id = ?",
  ).run(angka, toHuruf(angka), new Date().toISOString(), id);
  res.json({
    message: "Nilai berhasil diubah",
    data: db.prepare(`${SELECT_NILAI} WHERE n.id = ?`).get(id),
  });
});

let cached = { token: null, expAt: 0 };
async function getServiceToken() {
  if (cached.token && Date.now() < cached.expAt - 10_000) return cached.token;
  const r = await fetch(`${cfg.GATEWAY_URL}/auth/service`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: cfg.SERVICE_CLIENT_ID,
      client_secret: cfg.SERVICE_CLIENT_SECRET,
    }),
  });
  if (!r.ok)
    throw new Error(`gagal mengambil token service (HTTP ${r.status})`);
  const j = await r.json();
  cached = { token: j.access_token, expAt: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

app.post(
  "/kelas/:id/finalisasi",
  requireUserRole("dosen"),
  async (req, res) => {
    const id = Number(req.params.id);
    const kelas = db.prepare("SELECT * FROM kelas WHERE id = ?").get(id);
    if (!kelas) return res.status(404).json({ error: "Kelas tidak ditemukan" });
    if (kelas.dosen_id !== req.user.id)
      return res.status(403).json({ error: "Bukan dosen pengampu kelas ini" });

    const rows = db
      .prepare("SELECT * FROM nilai WHERE kelas_id = ? ORDER BY id")
      .all(id);
    if (rows.length === 0)
      return res.status(422).json({ error: "Kelas belum memiliki data nilai" });
    if (rows.every((r) => r.final))
      return res.status(409).json({ error: "Kelas sudah difinalisasi" });
    if (rows.some((r) => r.nilai_angka === null)) {
      return res
        .status(422)
        .json({
          error:
            "Masih ada nilai yang kosong, lengkapi dulu sebelum finalisasi",
        });
    }

    const payload = {
      kelas_id: kelas.id,
      kode_mk: kelas.kode,
      nama_mk: kelas.nama,
      sks: kelas.sks,
      items: rows.map((r) => ({
        nim: r.mahasiswa_nim,
        nilai_angka: r.nilai_angka,
        nilai_huruf: r.nilai_huruf,
      })),
    };

    let sinkron;
    try {
      const token = await getServiceToken();
      const r = await fetch(`${cfg.GATEWAY_URL}/transkrip/sinkron`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      sinkron = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(502).json({
          error:
            "Sinkron transkrip gagal, finalisasi dibatalkan (nilai tetap belum final)",
          status_sinkron: r.status,
          detail: sinkron,
        });
      }
    } catch (e) {
      return res
        .status(502)
        .json({
          error: "Gagal menghubungi gateway untuk sinkron transkrip",
          detail: e.message,
        });
    }

    db.prepare(
      "UPDATE nilai SET final = 1, updated_at = ? WHERE kelas_id = ?",
    ).run(new Date().toISOString(), id);
    res.json({
      message:
        "Kelas berhasil difinalisasi dan nilai sudah disinkronkan ke transkrip",
      kelas: { id: kelas.id, kode: kelas.kode, nama: kelas.nama },
      jumlah_nilai: rows.length,
      sinkron,
    });
  },
);

app.use((req, res) =>
  res.status(404).json({ error: "Endpoint tidak ada di Service Nilai" }),
);

app.listen(cfg.NILAI_PORT, cfg.HOST, () => {
  console.log(
    `[service-nilai] berjalan di http://${cfg.HOST}:${cfg.NILAI_PORT} (hanya menerima request dari gateway)`,
  );
});
