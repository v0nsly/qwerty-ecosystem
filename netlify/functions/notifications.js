const { sql, getSession, ok, err } = require('./_db');
exports.handler = async (event) => {
  const phone = getSession(event);
  if (!phone) return err(401, 'Не авторизован');
  if (event.httpMethod === 'POST') {
    const b = JSON.parse(event.body || '{}');
    if (b.markAllRead) { await sql`UPDATE notifications SET read = TRUE WHERE phone = ${phone}`; return ok({ ok: true }); }
    if (b.id) { await sql`UPDATE notifications SET read = TRUE WHERE id = ${b.id} AND phone = ${phone}`; return ok({ ok: true }); }
  }
  const rows = await sql`SELECT id, title, text, type, read, created_at FROM notifications WHERE phone = ${phone} ORDER BY created_at DESC LIMIT 100`;
  return ok({ notifications: rows });
};
