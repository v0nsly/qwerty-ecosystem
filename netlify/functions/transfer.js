const { sql, getSession, antifraudCheck, genTxNumber, pushNotif, ok, err } = require('./_db');
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed');
  const fromPhone = getSession(event);
  if (!fromPhone) return err(401, 'Не авторизован');
  const b = JSON.parse(event.body || '{}');
  const toPhone = String(b.toPhone || '').replace(/\D/g, '').slice(-10);
  const amount = Number(b.amount);
  const comment = String(b.comment || '').slice(0, 120);
  const fromAccountId = b.fromAccountId || null;
  if (!/^\d{10}$/.test(toPhone)) return err(400, 'Некорректный номер');
  if (toPhone === fromPhone) return err(400, 'Нельзя перевести самому себе');
  if (!amount || amount <= 0) return err(400, 'Укажите сумму');
  const sender = (await sql`SELECT * FROM users WHERE phone = ${fromPhone}`)[0];
  if (sender.status !== 'active') return err(403, 'Операции недоступны');
  const recipient = (await sql`SELECT * FROM users WHERE phone = ${toPhone}`)[0];
  if (!recipient) return err(404, 'Получатель не найден');
  if (recipient.status === 'closed') return err(400, 'Счёт получателя закрыт');
  if (recipient.status === 'blocked') return err(400, 'Счёт получателя заблокирован');
  const senderAccs = await sql`SELECT * FROM accounts WHERE phone = ${fromPhone} ORDER BY is_main DESC`;
  if (!senderAccs.length) return err(400, 'Нет счёта');
  const fromAcc = fromAccountId ? senderAccs.find(a => String(a.id) === String(fromAccountId)) : senderAccs[0];
  if (!fromAcc) return err(404, 'Счёт не найден');
  if (Number(fromAcc.balance) < amount) return err(400, 'Недостаточно средств');
  const reasons = await antifraudCheck(fromPhone, amount, comment);
  if (reasons.length) {
    const txNumber = genTxNumber();
    await sql`INSERT INTO transactions (tx_number, from_phone, to_phone, amount, comment, type, status, history) VALUES (${txNumber}, ${fromPhone}, ${toPhone}, ${amount}, ${comment}, 'transfer', 'blocked', ${JSON.stringify([{ status: 'blocked', date: new Date().toISOString(), by: 'antifraud', reason: reasons.join('; ') }])}::jsonb)`;
    await sql`INSERT INTO antifraud_log (phone, amount, reason, tx_number) VALUES (${fromPhone}, ${amount}, ${reasons.join('; ')}, ${txNumber})`;
    const newStrikes = (sender.fraud_strikes || 0) + 1;
    await sql`UPDATE users SET fraud_strikes = ${newStrikes} WHERE phone = ${fromPhone}`;
    await pushNotif(fromPhone, 'Перевод заблокирован', `Операция ${txNumber} отклонена: ${reasons.join('; ')}`, 'blocked');
    if (newStrikes >= 3) {
      await sql`UPDATE users SET status = 'blocked', blocked_reason = '3 заблокированных перевода' WHERE phone = ${fromPhone}`;
      await pushNotif(fromPhone, 'Счёт заблокирован', '3 подозрительные операции подряд. Свяжитесь с поддержкой.', 'blocked');
    }
    return ok({ blocked: true, reasons, txNumber });
  }
  const txNumber = genTxNumber();
  const toAccs = await sql`SELECT * FROM accounts WHERE phone = ${toPhone} ORDER BY is_main DESC`;
  const toAcc = toAccs[0];
  try {
    await sql.transaction([
      sql`UPDATE accounts SET balance = balance - ${amount} WHERE id = ${fromAcc.id}`,
      sql`UPDATE accounts SET balance = balance + ${amount} WHERE id = ${toAcc.id}`,
      sql`INSERT INTO transactions (tx_number, from_phone, to_phone, from_account, to_account, amount, comment, type, status, history) VALUES (${txNumber}, ${fromPhone}, ${toPhone}, ${fromAcc.account_number}, ${toAcc.account_number}, ${amount}, ${comment}, 'transfer', 'completed', ${JSON.stringify([{ status: 'completed', date: new Date().toISOString(), by: 'system', reason: 'Антифрод пройден' }])}::jsonb)`
    ]);
  } catch (e) { return err(500, 'Ошибка БД: ' + e.message); }
  await pushNotif(fromPhone, 'Перевод выполнен', `Переведено ${amount} ₽ получателю +7 ${toPhone}. Операция ${txNumber}.`, 'transfer_out');
  await pushNotif(toPhone, 'Входящий перевод', `Получено ${amount} ₽ от +7 ${fromPhone}. Операция ${txNumber}${comment ? ' · «' + comment + '»' : ''}`, 'transfer_in');
  await sql`UPDATE users SET fraud_strikes = 0 WHERE phone = ${fromPhone}`;
  return ok({ ok: true, txNumber });
};
