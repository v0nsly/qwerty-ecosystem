const { sql, getSession, logAudit, pushNotif, ok, err } = require('./_db');
function isStaff(event) { const s = getSession(event); return s && s.startsWith('STAFF_') ? s.replace('STAFF_', '') : null; }
exports.handler = async (event) => {
  const login = isStaff(event);
  if (!login) return err(401, 'Не авторизован');
  const staff = (await sql`SELECT * FROM staff WHERE login = ${login}`)[0];
  if (!staff) return err(401);
  const b = JSON.parse(event.body || '{}');
  const txId = b.txId;
  const tx = (await sql`SELECT * FROM transactions WHERE id = ${txId}`)[0];
  if (!tx) return err(404, 'Транзакция');
  async function pushStatus(status, reason) {
    const history = Array.isArray(tx.history) ? tx.history : [];
    history.push({ status, date: new Date().toISOString(), by: staff.name, reason: reason || '' });
    await sql`UPDATE transactions SET status = ${status}, updated_at = NOW(), history = ${JSON.stringify(history)}::jsonb WHERE id = ${txId}`;
  }
  if (b.action === 'freeze') {
    if (!b.reason) return err(400, 'Причина');
    await pushStatus('frozen', b.reason);
    if (tx.from_phone) await pushNotif(tx.from_phone, 'Операция приостановлена', tx.tx_number + ': ' + b.reason, 'tx_pending');
    await logAudit(staff.name, staff.role, 'freeze_tx', tx.tx_number, b.reason);
    return ok({ ok: true });
  }
  if (b.action === 'approve') {
    if (tx.to_phone) {
      const toAcc = (await sql`SELECT * FROM accounts WHERE phone = ${tx.to_phone} ORDER BY is_main DESC LIMIT 1`)[0];
      if (toAcc) { await sql.transaction([sql`UPDATE accounts SET balance = balance + ${tx.amount} WHERE id = ${toAcc.id}`, sql`UPDATE transactions SET status = 'completed' WHERE id = ${txId}`]); }
      await pushNotif(tx.to_phone, 'Входящий перевод', 'Зачислено ' + tx.amount + ' ₽. Операция ' + tx.tx_number, 'transfer_in');
    }
    await pushStatus('completed', 'Одобрено');
    await logAudit(staff.name, staff.role, 'approve_tx', tx.tx_number, '');
    return ok({ ok: true });
  }
  if (b.action === 'return') {
    if (!b.reason) return err(400, 'Причина');
    if (tx.from_phone) {
      const fromAcc = (await sql`SELECT * FROM accounts WHERE phone = ${tx.from_phone} ORDER BY is_main DESC LIMIT 1`)[0];
      if (fromAcc) { await sql.transaction([sql`UPDATE accounts SET balance = balance + ${tx.amount} WHERE id = ${fromAcc.id}`, sql`UPDATE transactions SET status = 'returned' WHERE id = ${txId}`]); }
      await pushNotif(tx.from_phone, 'Возврат средств', 'По операции ' + tx.tx_number + ' возвращено ' + tx.amount + ' ₽.', 'transfer_in');
    }
    await pushStatus('returned', b.reason);
    await logAudit(staff.name, staff.role, 'return_tx', tx.tx_number, b.reason);
    return ok({ ok: true });
  }
  return err(400, 'Неизвестное действие');
};
