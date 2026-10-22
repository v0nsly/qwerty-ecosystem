const { sql, bcrypt, normalizePhone, signToken, ok, err } = require('./_db');
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed');
  const b = JSON.parse(event.body || '{}');
  const phone = normalizePhone(b.phone);
  const rows = await sql`SELECT * FROM users WHERE phone = ${phone}`;
  if (!rows.length) return err(404, 'Номер не зарегистрирован');
  const u = rows[0];
  if (!u.email_verified) return err(403, 'Подтвердите email');
  if (u.status === 'blocked') return err(403, 'Счёт заблокирован');
  if (u.status === 'closed') return err(403, 'Счёт закрыт');
  if (!b.pin) return ok({ exists: true, hasPin: !!u.pin_hash, phone: u.phone, name: u.name, surname: u.surname });
  if (!u.pin_hash) return err(400, 'PIN не установлен');
  const match = await bcrypt.compare(String(b.pin), u.pin_hash);
  if (!match) return err(401, 'Неверный PIN');
  return ok({ ok: true, token: signToken(phone) });
};
