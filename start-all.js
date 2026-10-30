// Menjalankan 3 proses sekaligus: gateway (3000), service nilai (3001), service transkrip (3002).
//   npm start      (Ctrl+C untuk berhenti semuanya)
const { spawn } = require('child_process');
const path = require('path');
const db = require('./shared/db');
const cfg = require('./shared/config');

// Otomatis seed kalau database masih kosong.
if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  console.log('[start] database kosong -> menjalankan seed...');
  require('./scripts/seed').runSeed();
}
db.close();

const procs = [
  ['transkrip', 'service-transkrip/index.js', '\x1b[35m'],
  ['nilai',     'service-nilai/index.js',     '\x1b[36m'],
  ['gateway',   'gateway/index.js',           '\x1b[32m'],
];

const children = procs.map(([name, file, color]) => {
  const child = spawn(process.execPath, [path.join(__dirname, file)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) out.write(`${color}[${name}]\x1b[0m ${l}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => console.log(`[${name}] berhenti (kode ${code})`));
  return child;
});

console.log(`[start] jam akses: ${cfg.ACCESS_START}-${cfg.ACCESS_END} (${cfg.TIMEZONE})`);
const stop = () => { children.forEach((c) => c.kill()); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
