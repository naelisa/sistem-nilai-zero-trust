const express = require("express");
const crypto = require("crypto");
const db = require("../shared/db");
const cfg = require("../shared/config");
const {
  hashPassword,
  verifyPassword,
  sha256,
  safeEqual,
} = require("../shared/security");
const {
  signAccessToken,
  signServiceToken,
  verifyToken,
} = require("../shared/tokens");
const { audit } = require("./audit");

const router = express.Router();

const DUMMY_HASH = hashPassword("dummy-password");

const ctx = (req, extra) => ({
  method: req.method,
  endpoint: req.originalUrl.split("?")[0],
  device: req.headers["x-device-id"] || null,
  ...extra,
});

function issueRefreshToken(user, deviceId) {
  const raw = crypto.randomBytes(48).toString("base64url");
  db.prepare(
    `
    INSERT INTO refresh_tokens (user_id, token_hash, device_id, expires_at, revoked, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `,
  ).run(
    user.id,
    sha256(raw),
    deviceId || null,
    Date.now() + cfg.REFRESH_TOKEN_TTL_MS,
    new Date().toISOString(),
  );
  return raw;
}

function tokenResponse(user, deviceId) {
  const access = signAccessToken(user);
  return {
    token_type: "Bearer",
    access_token: access.token,
    expires_in: access.expiresIn,
    refresh_token: issueRefreshToken(user, deviceId),
    refresh_expires_in: Math.floor(cfg.REFRESH_TOKEN_TTL_MS / 1000),
    user: { username: user.username, nama: user.nama, role: user.role },
  };
}

// ---------------------------------------------------------------- POST /auth/login
router.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    !username ||
    !password
  ) {
    audit(
      ctx(req, {
        subject: "anonymous",
        result: "deny",
        reason: "username/password tidak diisi",
      }),
    );
    return res.status(400).json({ error: "username dan password wajib diisi" });
  }

  const user = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username);
  const passwordOk = verifyPassword(
    password,
    user ? user.password_hash : DUMMY_HASH,
  );
  if (!user || !passwordOk) {
    audit(
      ctx(req, {
        subject: username,
        result: "deny",
        reason: "kredensial tidak valid",
      }),
    );
    return res.status(401).json({ error: "Kredensial tidak valid" });
  }

  const deviceId = req.headers["x-device-id"];
  if (!deviceId) {
    audit(
      ctx(req, {
        subject: user.username,
        role: user.role,
        result: "deny",
        reason: "header X-Device-ID tidak ada",
      }),
    );
    return res.status(403).json({ error: "Header X-Device-ID wajib diisi" });
  }
  const registered = db
    .prepare("SELECT 1 FROM devices WHERE user_id = ? AND device_id = ?")
    .get(user.id, deviceId);
  if (!registered) {
    audit(
      ctx(req, {
        subject: user.username,
        role: user.role,
        result: "deny",
        reason: "device tidak terdaftar untuk user ini",
      }),
    );
    return res
      .status(403)
      .json({ error: "Device tidak terdaftar untuk user ini" });
  }

  audit(
    ctx(req, {
      subject: user.username,
      role: user.role,
      result: "allow",
      reason: "login berhasil (kredensial valid, device terdaftar)",
    }),
  );
  res.json(tokenResponse(user, deviceId));
});

// -------------------------------------------------------------- POST /auth/refresh
router.post("/refresh", (req, res) => {
  const { refresh_token } = req.body || {};
  if (typeof refresh_token !== "string" || !refresh_token) {
    audit(
      ctx(req, {
        subject: "anonymous",
        result: "deny",
        reason: "refresh_token tidak diisi",
      }),
    );
    return res.status(400).json({ error: "refresh_token wajib diisi" });
  }

  const row = db
    .prepare("SELECT * FROM refresh_tokens WHERE token_hash = ?")
    .get(sha256(refresh_token));
  if (!row) {
    audit(
      ctx(req, {
        subject: "anonymous",
        result: "deny",
        reason: "refresh token tidak dikenal",
      }),
    );
    return res.status(401).json({ error: "Refresh token tidak valid" });
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id);

  if (row.revoked) {
    db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?").run(
      row.user_id,
    );
    audit(
      ctx(req, {
        subject: user.username,
        role: user.role,
        result: "deny",
        reason:
          "refresh token yang sudah dicabut dipakai ulang -> semua sesi user dicabut",
      }),
    );
    return res.status(401).json({ error: "Refresh token sudah dicabut" });
  }
  if (row.expires_at < Date.now()) {
    audit(
      ctx(req, {
        subject: user.username,
        role: user.role,
        result: "deny",
        reason: "refresh token kedaluwarsa",
      }),
    );
    return res.status(401).json({ error: "Refresh token kedaluwarsa" });
  }

  // Rotasi: token lama langsung dicabut, token baru diterbitkan.
  db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE id = ?").run(row.id);
  audit(
    ctx(req, {
      subject: user.username,
      role: user.role,
      result: "allow",
      reason: "refresh berhasil (token lama dicabut, token baru diterbitkan)",
    }),
  );
  res.json(tokenResponse(user, row.device_id));
});

router.post("/logout", (req, res) => {
  const { refresh_token } = req.body || {};
  if (typeof refresh_token !== "string" || !refresh_token) {
    audit(
      ctx(req, {
        subject: "anonymous",
        result: "deny",
        reason: "refresh_token tidak diisi",
      }),
    );
    return res.status(400).json({ error: "refresh_token wajib diisi" });
  }

  const row = db
    .prepare("SELECT * FROM refresh_tokens WHERE token_hash = ?")
    .get(sha256(refresh_token));
  if (!row || row.revoked || row.expires_at < Date.now()) {
    audit(
      ctx(req, {
        subject: "anonymous",
        result: "deny",
        reason: "logout dengan refresh token tidak valid / sudah dicabut",
      }),
    );
    return res
      .status(401)
      .json({ error: "Refresh token tidak valid atau sudah dicabut" });
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id);
  db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE id = ?").run(row.id);

  const m = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (m) {
    try {
      const p = verifyToken(m[1]);
      if (p.jti && p.sub === user.username) {
        db.prepare(
          "INSERT OR IGNORE INTO revoked_access (jti, expires_at) VALUES (?, ?)",
        ).run(p.jti, p.exp * 1000);
      }
    } catch (_) {}
  }

  audit(
    ctx(req, {
      subject: user.username,
      role: user.role,
      result: "allow",
      reason: "logout: refresh token dicabut",
    }),
  );
  res.json({ message: "Logout berhasil, refresh token dicabut" });
});

router.post("/service", (req, res) => {
  const { client_id, client_secret } = req.body || {};
  if (typeof client_id !== "string" || typeof client_secret !== "string") {
    audit(
      ctx(req, {
        subject: "anonymous",
        result: "deny",
        reason: "client_id/client_secret tidak diisi",
      }),
    );
    return res
      .status(400)
      .json({ error: "client_id dan client_secret wajib diisi" });
  }
  const client = db
    .prepare("SELECT * FROM service_clients WHERE client_id = ?")
    .get(client_id);
  const ok = verifyPassword(
    client_secret,
    client ? client.secret_hash : DUMMY_HASH,
  );
  if (!client || !ok) {
    audit(
      ctx(req, {
        subject: `service:${client_id}`,
        role: "service",
        result: "deny",
        reason: "client id/secret tidak valid",
      }),
    );
    return res.status(401).json({ error: "Client ID atau secret tidak valid" });
  }
  const t = signServiceToken(client.client_id);
  audit(
    ctx(req, {
      subject: `service:${client.client_id}`,
      role: "service",
      result: "allow",
      reason: "token service diterbitkan",
    }),
  );
  res.json({
    token_type: "Bearer",
    access_token: t.token,
    expires_in: t.expiresIn,
    role: "service",
  });
});

module.exports = router;
