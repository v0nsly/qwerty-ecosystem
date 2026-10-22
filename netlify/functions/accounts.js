const { sql, getSession, genAccountNumber, genCardNumber, pushNotif, ok, err } = require('./_db');
exports.handler = async (event) => {
  const phone = getSession(event);
  if (!phone) return err(401, 'Не авторизован');
  const b = JSON.parse(event.body || '{}');
  if (b.action === 'create-salary') {
    const exist = await sql`SELECT id FROM accounts WHERE phone = ${phone} AND type = 'salary'`;
    if (exist.length) return err(409, 'Зарплатный счёт уже открыт');
    const num = genAccountNumber(); const card = genCardNumber();
    const r = await sql`INSERT INTO accounts (phone, type, account_number, card_number, balance, is_main) VALUES (${phone}, 'salary', ${num}, ${card}, 0, FALSE) RETURNING *`;
    await pushNotif(phone, 'Зарплатный счёт открыт', `Р/с ${num}, карта ${card}`, 'info');
    return ok({ account: r[0] });
  }
  if (b.action === 'transfer-between') {
    const { fromId, toId, amount } = b; const amt = Number(amount);
    if (!amt || amt <= 0) return err(400, 'Сумма');
    const accs = await sql`SELECT * FROM accounts WHERE phone = ${phone}`;
    const fromAcc = accs.find(a => String(a.id) === String(fromId));
    const toAcc = accs.find(a => String(a.id) === String(toId));
    if (!fromAcc || !toAcc) return err(404, 'Счёт');
    if (fromAcc.id === toAcc.id) return err(400, 'Разные счета');
    if (Number(fromAcc.balance) < amt) return err(400, 'Недостаточно');
    await sql.transaction([
      sql`UPDATE accounts SET balance = balance - ${amt} WHERE id = ${fromAcc.id}`,
      sql`UPDATE accounts SET balance = balance + ${amt} WHERE id = ${toAcc.id}`,
      sql`INSERT INTO transactions (tx_number, from_phone, to_phone, amount, comment, type, status, history) VALUES (${'TX' + Date.now()}, ${phone}, ${phone}, ${amt}, 'Между счетами', 'between', 'completed', ${JSON.stringify([{ status: 'completed', date: new Date().toISOString(), by: 'user' }])}::jsonb)`
    ]);
    return ok({ ok: true });
  }
  return err(400, 'Неизвестное действие');
};
