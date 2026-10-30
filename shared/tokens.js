const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const cfg = require("./config");

const ALG = "HS256";
const USER_ROLES = ["mahasiswa", "dosen", "admin"];

function lifetime(token) {
  const d = jwt.decode(token);
  return d.exp - d.iat;
}

function signAccessToken(user) {
  const token = jwt.sign(
    { sub: user.username, role: user.role, typ: "access" },
    cfg.JWT_SECRET,
    {
      algorithm: ALG,
      expiresIn: cfg.ACCESS_TOKEN_TTL,
      jwtid: crypto.randomUUID(),
    },
  );
  return { token, expiresIn: lifetime(token) };
}

function signServiceToken(clientId) {
  const token = jwt.sign(
    { sub: clientId, role: "service", typ: "service" },
    cfg.JWT_SECRET,
    {
      algorithm: ALG,
      expiresIn: cfg.SERVICE_TOKEN_TTL,
      jwtid: crypto.randomUUID(),
    },
  );
  return { token, expiresIn: lifetime(token) };
}

function verifyToken(token) {
  const p = jwt.verify(token, cfg.JWT_SECRET, { algorithms: [ALG] });
  const okUser = p.typ === "access" && USER_ROLES.includes(p.role);
  const okService = p.typ === "service" && p.role === "service";
  if (!p.sub || !(okUser || okService)) {
    const e = new Error("klaim token tidak valid");
    e.name = "JsonWebTokenError";
    throw e;
  }
  return p;
}

module.exports = { signAccessToken, signServiceToken, verifyToken };
