// Verifikasi konteks: jam akses (default 07:00-21:00, bisa diubah lewat .env)
const cfg = require('./config');

function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m) throw new Error(`Format jam salah (harus HH:MM): ${s}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutesNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: cfg.TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return get('hour') * 60 + get('minute');
}

function isWithinAccessHours(date = new Date()) {
  const now = minutesNow(date);
  const start = parseHM(cfg.ACCESS_START);
  const end = parseHM(cfg.ACCESS_END);
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

const accessWindowLabel = () => `${cfg.ACCESS_START}-${cfg.ACCESS_END} ${cfg.TIMEZONE}`;

module.exports = { isWithinAccessHours, accessWindowLabel };
