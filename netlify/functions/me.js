const { sql, getSession, ok, err } = require('./_db');
exports.handler = async (event) => {
  const phone = getSession(event);
  if (!phone) return err(401, 'Не авторизован');
  const u = await sql`SELECT * FROM users WHERE phone = ${phone}`;
  if (!u.length) return err(404, 'Пользователь не найден');
  const user = u[0];
  const accounts = await sql`SELECT id, type, account_number, card_number, balance, is_main FROM accounts WHERE phone = ${phone} ORDER BY is_main DESC, id ASC`;
  const notifs = await sql`SELECT id, title, text, type, read, created_at FROM notifications WHERE phone = ${phone} ORDER BY created_at DESC LIMIT 50`;
  return ok({
    user: { phone: user.phone, email: user.email, surname: user.surname, name: user.name, patronymic: user.patronymic, dob: user.dob, status: user.status, limitPerDay: user.limit_per_day, balance: user.balance, blockedReason: user.blocked_reason, closeRequestId: user.close_request_id },
    accounts, notifications: notifs
  });
};
