const db = require("../shared/db");

const insert = db.prepare(`
  INSERT INTO audit_log (ts, subject, role, method, endpoint, device, result, reason)
  VALUES (@ts, @subject, @role, @method, @endpoint, @device, @result, @reason)
`);

function audit({
  subject,
  role = null,
  method,
  endpoint,
  device = null,
  result,
  reason,
}) {
  const row = {
    ts: new Date().toISOString(),
    subject,
    role,
    method,
    endpoint,
    device,
    result,
    reason,
  };
  try {
    insert.run(row);
  } catch (e) {
    console.error("[audit] gagal menulis log:", e.message);
  }
  const tag = result === "allow" ? "ALLOW" : "DENY ";
  console.log(
    `[audit] ${tag} ${subject} ${method} ${endpoint} device=${device || "-"} :: ${reason}`,
  );
}

module.exports = { audit };
