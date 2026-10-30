// Membuat file Postman (collection + environment) di folder postman/.
//   npm run postman
// File hasilnya sudah disertakan, jadi script ini hanya perlu dijalankan kalau kamu mengubah tes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('../shared/config');

const OUT = path.join(__dirname, '..', 'postman');
fs.mkdirSync(OUT, { recursive: true });

// Token palsu: ditandatangani dengan kunci lain (bukan JWT_SECRET) tapi tampak "valid" dan belum kedaluwarsa.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const FORGED = (() => {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ sub: 'admin', role: 'admin', typ: 'access', iat: 1700000000, exp: 4102444800 });
  return `${h}.${p}.${crypto.createHmac('sha256', 'kunci-penyerang').update(`${h}.${p}`).digest('base64url')}`;
})();

const DEV = { mhs1: 'DEV-MHS1-01', mhs2: 'DEV-MHS2-01', mhs3: 'DEV-MHS3-01', dosen1: 'DEV-DOSEN1-01', dosen2: 'DEV-DOSEN2-01', admin: 'DEV-ADMIN-01' };
const PASS = { mhs1: 'Mhs12345!', mhs2: 'Mhs12345!', mhs3: 'Mhs12345!', dosen1: 'Dosen123!', dosen2: 'Dosen123!', admin: 'Admin123!' };

function exec(lines) { return { listen: 'test', script: { type: 'text/javascript', exec: lines } }; }

function statusTest(expect) {
  if (typeof expect === 'number') return [`pm.test('Status ${expect}', () => pm.response.to.have.status(${expect}));`];
  return [
    "const inHours = pm.environment.get('in_hours') === 'true';",
    `const expected = inHours ? ${expect.inHours} : ${expect.outHours};`,
    "pm.test('Status ' + expected + (inHours ? ' (dalam jam akses)' : ' (di luar jam akses)'), () => pm.response.to.have.status(expected));",
  ];
}

function R(name, method, url, o = {}) {
  const header = [];
  if (o.token) header.push({ key: 'Authorization', value: `Bearer {{${o.token}}}` });
  if (o.rawAuth) header.push({ key: 'Authorization', value: o.rawAuth });
  if (o.device) header.push({ key: 'X-Device-ID', value: o.device });
  if (o.secret) header.push({ key: 'X-Gateway-Secret', value: o.secret });
  if (o.body !== undefined) header.push({ key: 'Content-Type', value: 'application/json' });
  const request = { method, header, url, description: o.desc || '' };
  if (o.body !== undefined) {
    request.body = { mode: 'raw', raw: typeof o.body === 'string' ? o.body : JSON.stringify(o.body, null, 2), options: { raw: { language: 'json' } } };
  }
  return { name, event: [exec([...statusTest(o.expect), ...(o.tests || [])])], request };
}

const login = (u, extraTests = [], varPrefix = u) => R(
  `Login ${u}`, 'POST', '{{base_url}}/auth/login',
  {
    device: DEV[u], body: { username: u, password: PASS[u] }, expect: 200,
    desc: `Login ${u} dengan device terdaftar ${DEV[u]}. Token disimpan otomatis ke environment.`,
    tests: [
      'const j = pm.response.json();',
      "pm.test('Ada access_token & refresh_token', () => { pm.expect(j.access_token).to.be.a('string'); pm.expect(j.refresh_token).to.be.a('string'); });",
      `pm.environment.set('${varPrefix}_token', j.access_token);`,
      `pm.environment.set('${varPrefix}_refresh', j.refresh_token);`,
      ...extraTests,
    ],
  });

const BASE = '{{base_url}}';
const sinkronValid = { kelas_id: 1, kode_mk: 'KA101', nama_mk: 'Keamanan Informasi', sks: 3, items: [{ nim: '2210001', nilai_angka: 80, nilai_huruf: 'B' }] };

const items = [
  { name: '0. Login semua role (JALANKAN PERTAMA)', item: [
    login('mhs1', ["pm.test('expires_in = 600 detik (10 menit)', () => pm.expect(j.expires_in).to.eql(600));"]),
    login('mhs2'), login('mhs3'), login('dosen1'), login('dosen2'), login('admin'),
    R('Token service (POST /auth/service)', 'POST', `${BASE}/auth/service`, {
      body: { client_id: cfg.SERVICE_CLIENT_ID, client_secret: cfg.SERVICE_CLIENT_SECRET }, expect: 200,
      desc: 'Meniru Service Nilai meminta token service (role: service, berlaku 5 menit).',
      tests: [
        'const j = pm.response.json();',
        "pm.test('role = service & 5 menit', () => { pm.expect(j.role).to.eql('service'); pm.expect(j.expires_in).to.eql(300); });",
        "pm.environment.set('service_token', j.access_token);",
      ],
    }),
  ] },

  { name: '1. Autentikasi & device (kasus negatif)', item: [
    R('Login password salah -> 401', 'POST', `${BASE}/auth/login`, { device: DEV.mhs1, body: { username: 'mhs1', password: 'salah' }, expect: 401 }),
    R('Login device tidak terdaftar -> 403', 'POST', `${BASE}/auth/login`, { device: 'DEV-HACKER-99', body: { username: 'mhs1', password: PASS.mhs1 }, expect: 403 }),
    R('Login pakai device milik user lain -> 403', 'POST', `${BASE}/auth/login`, { device: DEV.mhs2, body: { username: 'mhs1', password: PASS.mhs1 }, expect: 403 }),
    R('Login tanpa X-Device-ID -> 403', 'POST', `${BASE}/auth/login`, { body: { username: 'mhs1', password: PASS.mhs1 }, expect: 403 }),
    R('GET /nilai tanpa token -> 401', 'GET', `${BASE}/nilai`, { device: DEV.mhs1, expect: 401 }),
    R('GET /nilai token sampah -> 401', 'GET', `${BASE}/nilai`, { rawAuth: 'Bearer abc.def.ghi', device: DEV.mhs1, expect: 401 }),
    R('GET /transkrip token DIPALSUKAN -> 401', 'GET', `${BASE}/transkrip/2210001`, { rawAuth: `Bearer ${FORGED}`, device: DEV.admin, expect: 401, desc: 'JWT berisi role admin tetapi ditandatangani dengan kunci lain.' }),
    R('Token valid tanpa X-Device-ID -> 403', 'GET', `${BASE}/nilai`, { token: 'mhs1_token', expect: 403 }),
    R('Token valid + device milik orang lain -> 403', 'GET', `${BASE}/nilai`, { token: 'mhs1_token', device: DEV.mhs2, expect: 403 }),
  ] },

  { name: '2. Nilai (GET & PUT)', item: [
    R('GET /nilai - mhs1 (hanya miliknya)', 'GET', `${BASE}/nilai`, { token: 'mhs1_token', device: DEV.mhs1, expect: 200, tests: [
      "const d = pm.response.json().data;",
      "pm.test('Semua baris milik NIM 2210001', () => { pm.expect(d.length).to.be.above(0); d.forEach(n => pm.expect(n.nim).to.eql('2210001')); });",
    ] }),
    R('GET /nilai?nim=2210002 - mhs1 intip nilai orang lain -> 403', 'GET', `${BASE}/nilai?nim=2210002`, { token: 'mhs1_token', device: DEV.mhs1, expect: 403 }),
    R('GET /nilai - dosen1 (kelas yang diampu)', 'GET', `${BASE}/nilai`, { token: 'dosen1_token', device: DEV.dosen1, expect: 200, tests: [
      "const d = pm.response.json().data;",
      "pm.test('Hanya kelas 1, 3 mahasiswa', () => { pm.expect(d.length).to.eql(3); d.forEach(n => pm.expect(n.kelas_id).to.eql(1)); });",
    ] }),
    R('GET /nilai?kelas_id=2 - dosen1 minta kelas dosen2 -> 403', 'GET', `${BASE}/nilai?kelas_id=2`, { token: 'dosen1_token', device: DEV.dosen1, expect: 403 }),
    R('GET /nilai - admin -> 403', 'GET', `${BASE}/nilai`, { token: 'admin_token', device: DEV.admin, expect: 403 }),
    R('PUT /nilai/1 - mahasiswa -> 403', 'PUT', `${BASE}/nilai/1`, { token: 'mhs1_token', device: DEV.mhs1, body: { nilai_angka: 100 }, expect: 403 }),
    R('PUT /nilai/1 - dosen2 (bukan pengampu) -> 403', 'PUT', `${BASE}/nilai/1`, { token: 'dosen2_token', device: DEV.dosen2, body: { nilai_angka: 100 }, expect: 403 }),
    R('PUT /nilai/1 - dosen1 (pengampu)', 'PUT', `${BASE}/nilai/1`, { token: 'dosen1_token', device: DEV.dosen1, body: { nilai_angka: 91 }, expect: { inHours: 200, outHours: 403 }, desc: 'Berhasil hanya di dalam jam akses (default 07:00-21:00).' }),
    R('PUT /nilai/1 - nilai di luar 0-100', 'PUT', `${BASE}/nilai/1`, { token: 'dosen1_token', device: DEV.dosen1, body: { nilai_angka: 500 }, expect: { inHours: 400, outHours: 403 } }),
  ] },

  { name: '3. Transkrip & sinkron antar-service', item: [
    R('GET /transkrip/2210001 - mhs1 (NIM sendiri)', 'GET', `${BASE}/transkrip/2210001`, { token: 'mhs1_token', device: DEV.mhs1, expect: 200 }),
    R('GET /transkrip/2210002 - mhs1 (NIM orang lain) -> 403', 'GET', `${BASE}/transkrip/2210002`, { token: 'mhs1_token', device: DEV.mhs1, expect: 403 }),
    R('GET /transkrip/2210002 - admin (semua NIM)', 'GET', `${BASE}/transkrip/2210002`, { token: 'admin_token', device: DEV.admin, expect: 200 }),
    R('GET /transkrip/2210001 - dosen1 -> 403', 'GET', `${BASE}/transkrip/2210001`, { token: 'dosen1_token', device: DEV.dosen1, expect: 403 }),
    R('POST /transkrip/sinkron - token ADMIN -> 403', 'POST', `${BASE}/transkrip/sinkron`, { token: 'admin_token', device: DEV.admin, body: sinkronValid, expect: 403, desc: 'Token user mana pun harus ditolak.' }),
    R('POST /transkrip/sinkron - token DOSEN -> 403', 'POST', `${BASE}/transkrip/sinkron`, { token: 'dosen1_token', device: DEV.dosen1, body: sinkronValid, expect: 403 }),
    R('POST /transkrip/sinkron - token SERVICE (body salah -> 400)', 'POST', `${BASE}/transkrip/sinkron`, { token: 'service_token', body: { kelas_id: 'x' }, expect: 400, desc: '400 (bukan 403) membuktikan token service LOLOS policy dan sampai ke Service Transkrip.' }),
    R('GET /nilai - token SERVICE -> 403', 'GET', `${BASE}/nilai`, { token: 'service_token', expect: 403, desc: 'Token service hanya boleh untuk /transkrip/sinkron (least privilege).' }),
  ] },

  { name: '4. Finalisasi kelas (+ sinkron ke transkrip)', item: [
    R('POST /kelas/1/finalisasi - mahasiswa -> 403', 'POST', `${BASE}/kelas/1/finalisasi`, { token: 'mhs1_token', device: DEV.mhs1, expect: 403 }),
    R('POST /kelas/1/finalisasi - dosen2 (bukan pengampu) -> 403', 'POST', `${BASE}/kelas/1/finalisasi`, { token: 'dosen2_token', device: DEV.dosen2, expect: 403 }),
    R('POST /kelas/1/finalisasi - admin -> 403', 'POST', `${BASE}/kelas/1/finalisasi`, { token: 'admin_token', device: DEV.admin, expect: 403 }),
    R('POST /kelas/1/finalisasi - dosen1 (pengampu)', 'POST', `${BASE}/kelas/1/finalisasi`, { token: 'dosen1_token', device: DEV.dosen1, expect: { inHours: 200, outHours: 403 }, desc: 'Setelah ini, nilai kelas 1 otomatis masuk ke transkrip lewat gateway (token service). Untuk mengulang: npm run seed.' }),
    R('GET /transkrip/2210001 - admin (cek hasil sinkron)', 'GET', `${BASE}/transkrip/2210001`, { token: 'admin_token', device: DEV.admin, expect: 200, tests: [
      "const inHours = pm.environment.get('in_hours') === 'true';",
      "const mk = pm.response.json().mata_kuliah.map(m => m.kode_mk);",
      "pm.test(inHours ? 'KA101 sudah masuk transkrip' : 'Belum ada transkrip (finalisasi ditolak)', () => inHours ? pm.expect(mk).to.include('KA101') : pm.expect(mk).to.not.include('KA101'));",
    ] }),
    R('PUT /nilai/2 - dosen1 setelah final -> 403', 'PUT', `${BASE}/nilai/2`, { token: 'dosen1_token', device: DEV.dosen1, body: { nilai_angka: 95 }, expect: 403 }),
    R('POST /kelas/1/finalisasi - kedua kali', 'POST', `${BASE}/kelas/1/finalisasi`, { token: 'dosen1_token', device: DEV.dosen1, expect: { inHours: 409, outHours: 403 } }),
  ] },

  { name: '5. Bypass gateway (akses langsung ke service)', item: [
    R('Service Nilai langsung, tanpa secret -> 403', 'GET', '{{nilai_url}}/nilai', { token: 'mhs1_token', expect: 403, desc: 'Port 3001 tidak bisa dipakai tanpa X-Gateway-Secret.' }),
    R('Service Transkrip langsung, tanpa secret -> 403', 'GET', '{{transkrip_url}}/transkrip/2210001', { token: 'admin_token', expect: 403 }),
    R('Secret SALAH -> 403', 'GET', '{{nilai_url}}/nilai', { token: 'mhs1_token', secret: 'tebakan-salah', expect: 403 }),
    R('Secret benar tapi TANPA token -> 401', 'GET', '{{nilai_url}}/nilai', { secret: '{{gateway_secret}}', expect: 401, desc: 'Verifikasi ulang di service: secret saja tidak cukup.' }),
    R('Secret benar + token DIPALSUKAN -> 401', 'GET', '{{nilai_url}}/nilai', { secret: '{{gateway_secret}}', rawAuth: `Bearer ${FORGED}`, expect: 401 }),
    R('Secret benar + token admin ke /transkrip/sinkron -> 403', 'POST', '{{transkrip_url}}/transkrip/sinkron', { secret: '{{gateway_secret}}', token: 'admin_token', body: sinkronValid, expect: 403 }),
    R('Header X-Gateway-Secret palsu lewat gateway tidak berpengaruh', 'GET', `${BASE}/nilai`, { token: 'mhs1_token', device: DEV.mhs1, secret: 'palsu', expect: 200, desc: 'Gateway membangun ulang header sendiri; secret dari client dibuang.' }),
  ] },

  { name: '6. Refresh & logout (token bisa dicabut)', item: [
    R('Login mhs2 (sesi baru)', 'POST', `${BASE}/auth/login`, { device: DEV.mhs2, body: { username: 'mhs2', password: PASS.mhs2 }, expect: 200, tests: ["pm.environment.set('s_refresh_1', pm.response.json().refresh_token);"] }),
    R('Refresh dengan refresh token #1 -> 200', 'POST', `${BASE}/auth/refresh`, { body: { refresh_token: '{{s_refresh_1}}' }, expect: 200, tests: ["pm.environment.set('s_refresh_2', pm.response.json().refresh_token);"] }),
    R('Refresh dengan token #1 LAGI (sudah dicabut) -> 401', 'POST', `${BASE}/auth/refresh`, { body: { refresh_token: '{{s_refresh_1}}' }, expect: 401, desc: 'Rotasi: token lama langsung dicabut. Pemakaian ulang dianggap pencurian.' }),
    R('Refresh dengan token #2 -> 401 (semua sesi dicabut)', 'POST', `${BASE}/auth/refresh`, { body: { refresh_token: '{{s_refresh_2}}' }, expect: 401 }),
    R('Login mhs3 (sesi baru)', 'POST', `${BASE}/auth/login`, { device: DEV.mhs3, body: { username: 'mhs3', password: PASS.mhs3 }, expect: 200, tests: ["const j = pm.response.json(); pm.environment.set('s3_token', j.access_token); pm.environment.set('s3_refresh', j.refresh_token);"] }),
    R('GET /nilai mhs3 sebelum logout -> 200', 'GET', `${BASE}/nilai`, { token: 's3_token', device: DEV.mhs3, expect: 200 }),
    R('Logout mhs3 -> 200', 'POST', `${BASE}/auth/logout`, { token: 's3_token', body: { refresh_token: '{{s3_refresh}}' }, expect: 200 }),
    R('Refresh setelah logout -> 401', 'POST', `${BASE}/auth/refresh`, { body: { refresh_token: '{{s3_refresh}}' }, expect: 401 }),
    R('GET /nilai dengan access token lama setelah logout -> 401', 'GET', `${BASE}/nilai`, { token: 's3_token', device: DEV.mhs3, expect: 401 }),
  ] },
];

const collection = {
  info: {
    name: 'Sistem Nilai - Zero Trust',
    description: 'Jalankan folder berurutan (Collection Runner). Folder 0 wajib dijalankan pertama untuk mengisi token. Pilih environment "Sistem Nilai Zero Trust".',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: items,
};

const envValues = {
  base_url: 'http://localhost:3000',
  nilai_url: 'http://localhost:3001',
  transkrip_url: 'http://localhost:3002',
  gateway_secret: cfg.GATEWAY_SECRET,
  in_hours: 'true',
};
const environment = {
  name: 'Sistem Nilai Zero Trust',
  values: Object.entries(envValues).map(([key, value]) => ({ key, value, type: 'default', enabled: true })),
  _postman_variable_scope: 'environment',
};

fs.writeFileSync(path.join(OUT, 'SistemNilai-ZeroTrust.postman_collection.json'), JSON.stringify(collection, null, 2));
fs.writeFileSync(path.join(OUT, 'SistemNilai-ZeroTrust.postman_environment.json'), JSON.stringify(environment, null, 2));
console.log('Tersimpan di folder postman/ (collection + environment). Total request:', items.reduce((n, f) => n + f.item.length, 0));
