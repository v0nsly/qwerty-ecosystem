const { sql, normalizePhone, genAccountNumber, genCardNumber, ok, err } = require('./_db');
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed');
  const b = JSON.parse(event.body || '{}');
  const phone = normalizePhone(b.phone);
  const code = String(b.code || '').trim();
  const rows = await sql`SELECT * FROM users WHERE phone = ${phone}`;
  if (!rows.length) return err(404, 'Пользователь не найден');
  const u = rows[0];
  if (u.email_verified) return ok({ ok: true, already: true });
  if (!u.email_code || u.email_code !== code) return err(400, 'Неверный код');
  if (new Date(u.email_code_expires) < new Date()) return err(400, 'Код истёк');
  await sql`UPDATE users SET email_verified = TRUE, email_code = NULL, email_code_expires = NULL, status = 'active' WHERE phone = ${phone}`;
  const accNumber = genAccountNumber();
  const card = genCardNumber();
  const ins = await sql`INSERT INTO accounts (phone, type, account_number, card_number, balance, is_main) VALUES (${phone}, 'main', ${accNumber}, ${card}, 0, TRUE) RETURNING id`;
  return ok({ ok: true, accountId: ins[0].id });
};
