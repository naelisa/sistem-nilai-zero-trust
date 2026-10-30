const db = require("../shared/db");
const { isWithinAccessHours, accessWindowLabel } = require("../shared/time");

const allow = (service, reason) => ({ allow: true, reason, service });
const deny = (reason, status = 403) => ({ allow: false, reason, status });

const getUser = (username) =>
  db.prepare("SELECT * FROM users WHERE username = ?").get(username);
const getKelas = (id) => db.prepare("SELECT * FROM kelas WHERE id = ?").get(id);
const getNilai = (id) => db.prepare("SELECT * FROM nilai WHERE id = ?").get(id);

const qstr = (v) => (typeof v === "string" ? v : undefined);

function ruleGetNilai({ subject, query }) {
  if (subject.type !== "user")
    return deny("token service tidak boleh membaca nilai");
  const user = getUser(subject.sub);
  if (!user) return deny("user tidak ditemukan di database", 401);

  if (user.role === "mahasiswa") {
    const nim = qstr(query.nim);
    if (nim && nim !== user.nim)
      return deny("mahasiswa hanya boleh melihat nilai miliknya sendiri");
    return allow("nilai", "mahasiswa melihat nilai miliknya");
  }
  if (user.role === "dosen") {
    const kid = qstr(query.kelas_id);
    if (kid !== undefined) {
      const kelas = getKelas(Number(kid));
      if (!kelas) return deny("kelas tidak ditemukan", 404);
      if (kelas.dosen_id !== user.id)
        return deny("dosen hanya boleh melihat kelas yang diampunya");
    }
    return allow("nilai", "dosen melihat nilai kelas yang diampunya");
  }
  return deny(`role '${user.role}' tidak diizinkan melihat nilai`);
}

function rulePutNilai({ subject, params }) {
  if (subject.type !== "user")
    return deny("token service tidak boleh mengubah nilai");
  const user = getUser(subject.sub);
  if (!user) return deny("user tidak ditemukan di database", 401);
  if (user.role !== "dosen")
    return deny(`role '${user.role}' tidak diizinkan mengubah nilai`);

  const nilai = getNilai(Number(params[0]));
  if (!nilai) return deny("data nilai tidak ditemukan", 404);
  const kelas = getKelas(nilai.kelas_id);
  if (!kelas || kelas.dosen_id !== user.id)
    return deny("dosen bukan pengampu kelas ini");
  if (nilai.final) return deny("nilai sudah final dan tidak boleh diubah");
  if (!isWithinAccessHours())
    return deny(`di luar jam akses (${accessWindowLabel()})`);
  return allow(
    "nilai",
    "dosen pengampu mengubah nilai (belum final, dalam jam akses)",
  );
}

function ruleFinalisasi({ subject, params }) {
  if (subject.type !== "user")
    return deny("token service tidak boleh memfinalisasi nilai");
  const user = getUser(subject.sub);
  if (!user) return deny("user tidak ditemukan di database", 401);
  if (user.role !== "dosen")
    return deny(`role '${user.role}' tidak diizinkan memfinalisasi nilai`);

  const kelas = getKelas(Number(params[0]));
  if (!kelas) return deny("kelas tidak ditemukan", 404);
  if (kelas.dosen_id !== user.id) return deny("dosen bukan pengampu kelas ini");
  if (!isWithinAccessHours())
    return deny(`di luar jam akses (${accessWindowLabel()})`);
  return allow("nilai", "dosen pengampu memfinalisasi kelas (dalam jam akses)");
}

function ruleGetTranskrip({ subject, params }) {
  if (subject.type !== "user")
    return deny("token service tidak boleh membaca transkrip");
  const user = getUser(subject.sub);
  if (!user) return deny("user tidak ditemukan di database", 401);

  if (user.role === "admin")
    return allow("transkrip", "admin melihat transkrip");
  if (user.role === "mahasiswa") {
    if (params[0] !== user.nim)
      return deny("mahasiswa hanya boleh melihat transkrip NIM sendiri");
    return allow("transkrip", "mahasiswa melihat transkrip sendiri");
  }
  return deny(`role '${user.role}' tidak diizinkan melihat transkrip`);
}

function ruleSinkron({ subject }) {
  if (subject.type !== "service")
    return deny(
      "endpoint sinkron hanya untuk token service; token user ditolak",
    );
  if (subject.role !== "service") return deny("role token bukan service");
  if (subject.sub !== "service-nilai")
    return deny("hanya Service Nilai yang boleh melakukan sinkron");
  return allow("transkrip", "Service Nilai mengirim sinkron transkrip");
}

const ROUTES = [
  { method: "GET", re: /^\/nilai$/, rule: ruleGetNilai },
  { method: "PUT", re: /^\/nilai\/(\d+)$/, rule: rulePutNilai },
  { method: "POST", re: /^\/kelas\/(\d+)\/finalisasi$/, rule: ruleFinalisasi },
  {
    method: "GET",
    re: /^\/transkrip\/([A-Za-z0-9_-]+)$/,
    rule: ruleGetTranskrip,
  },
  { method: "POST", re: /^\/transkrip\/sinkron$/, rule: ruleSinkron },
];

/**
 * @param {{subject:{type:'user'|'service',sub:string,role:string}, method:string, path:string, query:object}} ctx
 */
function decide(ctx) {
  const path = ctx.path.length > 1 ? ctx.path.replace(/\/+$/, "") : ctx.path;
  for (const r of ROUTES) {
    if (r.method !== ctx.method) continue;
    const m = r.re.exec(path);
    if (!m) continue;
    return r.rule({ ...ctx, params: m.slice(1) });
  }
  return deny("endpoint tidak dikenal (default deny)", 404);
}

module.exports = { decide };
