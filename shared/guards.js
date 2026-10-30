const cfg = require("./config");
const db = require("./db");
const { safeEqual } = require("./security");
const { verifyToken } = require("./tokens");

function gatewayGuard(serviceName) {
  return (req, res, next) => {
    const got = req.headers["x-gateway-secret"];
    if (!got || !safeEqual(got, cfg.GATEWAY_SECRET)) {
      return res.status(403).json({
        error:
          "Akses langsung ke service ditolak (X-Gateway-Secret tidak ada/salah)",
        service: serviceName,
      });
    }
    next();
  };
}

function tokenGuard(req, res, next) {
  const m = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: "Access token tidak ada" });
  try {
    req.auth = verifyToken(m[1]);
  } catch (e) {
    const expired = e.name === "TokenExpiredError";
    return res
      .status(401)
      .json({ error: expired ? "Token kedaluwarsa" : "Token tidak valid" });
  }
  next();
}

function requireUserRole(...roles) {
  return (req, res, next) => {
    if (req.auth.typ !== "access" || !roles.includes(req.auth.role)) {
      return res
        .status(403)
        .json({
          error: `Role '${req.auth.role}' tidak diizinkan di endpoint ini`,
        });
    }
    const user = db
      .prepare("SELECT * FROM users WHERE username = ?")
      .get(req.auth.sub);
    if (!user || user.role !== req.auth.role) {
      return res
        .status(403)
        .json({
          error: "User tidak ditemukan / role tidak cocok dengan database",
        });
    }
    req.user = user;
    next();
  };
}

function requireServiceToken(req, res, next) {
  if (
    req.auth.typ !== "service" ||
    req.auth.role !== "service" ||
    req.auth.sub !== cfg.SERVICE_CLIENT_ID
  ) {
    return res
      .status(403)
      .json({ error: "Endpoint ini hanya untuk token service" });
  }
  next();
}

module.exports = {
  gatewayGuard,
  tokenGuard,
  requireUserRole,
  requireServiceToken,
};
