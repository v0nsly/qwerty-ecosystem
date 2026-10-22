const { sql, getSession, pushNotif, ok, err } = require('./_db');
exports.handler = async (event) => {
  const phone = getSession(event);
  if (!phone) return err(401, 'Не авторизован');
  const b = JSON.parse(event.body || '{}');
  if (b.action === 'create') {
    const u = (await sql`SELECT * FROM users WHERE phone = ${phone}`)[0];
    if (!u) return err(404, 'Пользователь');
    if (u.status === 'blocked') return err(403, 'Счёт заблокирован');
    if (u.status === 'close_pending') return err(409, 'Заявка уже отправлена');
    const accs = await sql`SELECT SUM(balance) AS total FROM accounts WHERE phone = ${phone}`;
    const total = Number(accs[0].total) || 0;
    const fee = Math.round(total * 0.2);
    const payout = total - fee;
    const code = 'CL' + Date.now();
    await sql`INSERT INTO close_requests (code, phone, total, fee, payout, req_account, req_bik, req_bank, req_inn, comment, status) VALUES (${code}, ${phone}, ${total}, ${fee}, ${payout}, ${b.req_account}, ${b.req_bik}, ${b.req_bank}, ${b.req_inn}, ${b.comment || ''}, 'pending')`;
    await sql`UPDATE users SET status = 'close_pending', close_request_id = (SELECT id FROM close_requests WHERE code = ${code}) WHERE phone = ${phone}`;
    await pushNotif(phone, 'Заявка на закрытие', `К выводу ${payout} ₽ (комиссия ${fee} ₽). Ожидайте решения поддержки.`, 'close');
    return ok({ ok: true, code });
  }
  if (b.action === 'recreate') {
    const u = (await sql`SELECT * FROM users WHERE phone = ${phone}`)[0];
    if (!u) return err(404, 'Пользователь');
    if (u.status !== 'closed') return err(400, 'Счёт не закрыт');
    if (!b.surname || !b.name || !b.dob || !b.codeword) return err(400, 'Заполните данные KYC');
    await sql`UPDATE users SET surname = ${b.surname}, name = ${b.name}, patronymic = ${b.patronymic || ''}, dob = ${b.dob}, codeword = ${b.codeword}, status = 'active' WHERE phone = ${phone}`;
    const num = '40817' + Math.floor(100000000000 + Math.random() * 899999999999);
    const p = () => Math.floor(1000 + Math.random() * 9000);
    const card = `${p()} ${p()} ${p()} ${p()}`;
    await sql`INSERT INTO accounts (phone, type, account_number, card_number, balance, is_main) VALUES (${phone}, 'main', ${num}, ${card}, 0, TRUE)`;
    await pushNotif(phone, 'Счёт пересоздан', `Новый р/с: ${num}, карта: ${card}`, 'info');
    return ok({ ok: true });
  }
  return err(400, 'Неизвестное действие');
};
