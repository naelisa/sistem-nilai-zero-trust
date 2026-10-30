// Menampilkan audit log terbaru.  Pemakaian:  npm run audit            (20 terakhir)
//                                              npm run audit -- 50      (50 terakhir)
//                                              npm run audit -- deny    (hanya yang ditolak)
const db = require('../shared/db');

const args = process.argv.slice(2);
const limit = Number(args.find((a) => /^\d+$/.test(a))) || 20;
const only = args.find((a) => a === 'allow' || a === 'deny');

const rows = db.prepare(`
  SELECT id, ts, subject, role, method, endpoint, device, result, reason
  FROM audit_log ${only ? 'WHERE result = ?' : ''} ORDER BY id DESC LIMIT ?
`).all(...(only ? [only, limit] : [limit])).reverse();

if (!rows.length) console.log('Audit log masih kosong.');
else console.table(rows);
