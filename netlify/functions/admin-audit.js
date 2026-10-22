const { sql, getSession, ok, err } = require('./_db');
exports.handler = async (event) => {
  const s = getSession(event);
  if (!s || !s.startsWith('STAFF_')) return err(401);
  const login = s.replace('STAFF_', '');
  const staff = (await sql`SELECT role FROM staff WHERE login = ${login}`)[0];
  if (!staff || !['admin','auditor'].includes(staff.role)) return err(403);
  const rows = await sql`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200`;
  return ok({ log: rows });
};
