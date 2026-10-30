const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const cfg = require("./config");

fs.mkdirSync(path.dirname(cfg.DB_PATH), { recursive: true });

const db = new Database(cfg.DB_PATH);
db.pragma("busy_timeout = 5000");
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('mahasiswa','dosen','admin')),
  nama          TEXT NOT NULL,
  nim           TEXT UNIQUE            -- hanya terisi untuk mahasiswa
);

CREATE TABLE IF NOT EXISTS devices (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL,
  UNIQUE (user_id, device_id)
);

CREATE TABLE IF NOT EXISTS kelas (
  id       INTEGER PRIMARY KEY,
  kode     TEXT NOT NULL,
  nama     TEXT NOT NULL,
  sks      INTEGER NOT NULL DEFAULT 3,
  dosen_id INTEGER NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS nilai (
  id            INTEGER PRIMARY KEY,
  kelas_id      INTEGER NOT NULL REFERENCES kelas(id),
  mahasiswa_nim TEXT NOT NULL,
  nilai_angka   REAL,
  nilai_huruf   TEXT,
  final         INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT,
  UNIQUE (kelas_id, mahasiswa_nim)
);

CREATE TABLE IF NOT EXISTS transkrip (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nim         TEXT NOT NULL,
  kelas_id    INTEGER NOT NULL,
  kode_mk     TEXT NOT NULL,
  nama_mk     TEXT NOT NULL,
  sks         INTEGER NOT NULL,
  nilai_angka REAL NOT NULL,
  nilai_huruf TEXT NOT NULL,
  synced_at   TEXT NOT NULL,
  UNIQUE (nim, kelas_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT UNIQUE NOT NULL,      -- yang disimpan hanya hash SHA-256, bukan token aslinya
  device_id  TEXT,
  expires_at INTEGER NOT NULL,          -- epoch ms
  revoked    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS revoked_access (
  jti        TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS service_clients (
  client_id   TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  nama        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT NOT NULL,
  subject  TEXT NOT NULL,
  role     TEXT,
  method   TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  device   TEXT,
  result   TEXT NOT NULL CHECK (result IN ('allow','deny')),
  reason   TEXT NOT NULL
);
`);

module.exports = db;
