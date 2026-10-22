const { sql, bcrypt, normalizePhone, signToken, ok, err } = require('./_db');
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed');
  const b = JSON.parse(event.body || '{}');
  const phone = normalizePhone(b.phone);
  const pin = String(b.pin || '');
  if (!/^\d{4}$/.test(pin)) return err(400, 'PIN должен быть 4 цифры');
  const hash = await bcrypt.hash(pin, 8);
  await sql`UPDATE users SET pin_hash = ${hash} WHERE phone = ${phone}`;
  return ok({ ok: true, token: signToken(phone) });
};
