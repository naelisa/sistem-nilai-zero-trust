const express = require("express");
const cfg = require("../shared/config");
const db = require("../shared/db");
const { verifyToken } = require("../shared/tokens");
const { decide } = require("./policy");
const { audit } = require("./audit");
const authRoutes = require("./auth.routes");

const app = express();
app.disable("x-powered-by");
app.use(express.json());

app.use("/auth", authRoutes);

function pep(req, res, next) {
  try {
    const base = {
      method: req.method,
      endpoint: req.originalUrl.split("?")[0],
      device: req.headers["x-device-id"] || null,
    };
    const reject = (status, subject, role, reason) => {
      audit({ ...base, subject, role, result: "deny", reason });
      return res.status(status).json({ error: "Akses ditolak", reason });
    };

    const m = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
    if (!m) return reject(401, "anonymous", null, "access token tidak ada");
    let payload;
    try {
      payload = verifyToken(m[1]);
    } catch (e) {
      return reject(
        401,
        "anonymous",
        null,
        e.name === "TokenExpiredError"
          ? "token kedaluwarsa"
          : "token tidak valid (tanda tangan/klaim salah)",
      );
    }

    const isService = payload.typ === "service";
    const subjectLabel = isService ? `service:${payload.sub}` : payload.sub;

    if (
      payload.jti &&
      db.prepare("SELECT 1 FROM revoked_access WHERE jti = ?").get(payload.jti)
    ) {
      return reject(
        401,
        subjectLabel,
        payload.role,
        "token sudah dicabut (logout)",
      );
    }

    if (!isService) {
      if (!base.device)
        return reject(
          403,
          subjectLabel,
          payload.role,
          "header X-Device-ID tidak ada",
        );
      const ok = db
        .prepare(
          `
        SELECT 1 FROM devices d JOIN users u ON u.id = d.user_id
        WHERE u.username = ? AND d.device_id = ?
      `,
        )
        .get(payload.sub, base.device);
      if (!ok)
        return reject(
          403,
          subjectLabel,
          payload.role,
          "device tidak terdaftar untuk user ini",
        );
    }

    const decision = decide({
      subject: {
        type: isService ? "service" : "user",
        sub: payload.sub,
        role: payload.role,
      },
      method: req.method,
      path: base.endpoint,
      query: req.query,
    });
    if (!decision.allow)
      return reject(
        decision.status || 403,
        subjectLabel,
        payload.role,
        decision.reason,
      );

    audit({
      ...base,
      subject: subjectLabel,
      role: payload.role,
      result: "allow",
      reason: decision.reason,
    });
    req.targetService = decision.service;
    next();
  } catch (e) {
    console.error("[pep] error:", e);
    res.status(500).json({ error: "Kesalahan internal pada gateway" });
  }
}

const TARGETS = { nilai: cfg.NILAI_URL, transkrip: cfg.TRANSKRIP_URL };

async function forward(req, res) {
  const base = TARGETS[req.targetService];
  if (!base)
    return res.status(404).json({ error: "Service tujuan tidak ditemukan" });

  const headers = {
    "x-gateway-secret": cfg.GATEWAY_SECRET,
    authorization: req.headers.authorization,
    "content-type": "application/json",
  };
  const opts = { method: req.method, headers };
  if (
    !["GET", "HEAD"].includes(req.method) &&
    req.body &&
    Object.keys(req.body).length
  ) {
    opts.body = JSON.stringify(req.body);
  }

  try {
    const upstream = await fetch(base + req.originalUrl, opts);
    const text = await upstream.text();
    res.status(upstream.status);
    res.set(
      "Content-Type",
      upstream.headers.get("content-type") || "application/json",
    );
    res.send(text);
  } catch (e) {
    console.error("[gateway] gagal menghubungi service:", e.message);
    res
      .status(502)
      .json({ error: "Service tidak dapat dihubungi", detail: e.message });
  }
}

app.use(pep, forward);

app.use((err, req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Body JSON tidak valid" });
  }
  console.error(err);
  res.status(500).json({ error: "Kesalahan internal" });
});

app.listen(cfg.GATEWAY_PORT, cfg.HOST, () => {
  console.log(
    `[gateway] PEP berjalan di http://${cfg.HOST}:${cfg.GATEWAY_PORT}`,
  );
});
