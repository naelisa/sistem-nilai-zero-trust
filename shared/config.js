// Konfigurasi terpusat. Membaca file .env (tanpa library tambahan).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

(function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue; // baris komentar / kosong otomatis terlewati
    const value = m[2].replace(/^['"]|['"]$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
})();

const env = (key, def) => (process.env[key] !== undefined ? process.env[key] : def);

module.exports = {
  ROOT,
  HOST: env('HOST', '127.0.0.1'),
  GATEWAY_PORT: Number(env('GATEWAY_PORT', 3000)),
  NILAI_PORT: Number(env('NILAI_PORT', 3001)),
  TRANSKRIP_PORT: Number(env('TRANSKRIP_PORT', 3002)),
  GATEWAY_URL: env('GATEWAY_URL', 'http://127.0.0.1:3000'),
  NILAI_URL: env('NILAI_URL', 'http://127.0.0.1:3001'),
  TRANSKRIP_URL: env('TRANSKRIP_URL', 'http://127.0.0.1:3002'),

  JWT_SECRET: env('JWT_SECRET', 'dev-only-jwt-secret-change-me-please-32chars'),
  GATEWAY_SECRET: env('GATEWAY_SECRET', 'dev-only-gateway-secret'),

  ACCESS_TOKEN_TTL: env('ACCESS_TOKEN_TTL', '10m'),
  SERVICE_TOKEN_TTL: env('SERVICE_TOKEN_TTL', '5m'),
  REFRESH_TOKEN_TTL_MS: Number(env('REFRESH_TOKEN_TTL_HOURS', 24)) * 3600 * 1000,

  SERVICE_CLIENT_ID: env('SERVICE_CLIENT_ID', 'service-nilai'),
  SERVICE_CLIENT_SECRET: env('SERVICE_CLIENT_SECRET', 'nilai-client-secret-123'),

  ACCESS_START: env('ACCESS_START', '07:00'),
  ACCESS_END: env('ACCESS_END', '21:00'),
  TIMEZONE: env('TIMEZONE', 'Asia/Jakarta'),

  DB_PATH: path.resolve(ROOT, env('DB_PATH', './data/sistem_nilai.db')),
};
