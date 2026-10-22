const { sql, getSession, logAudit, pushNotif, ok, err } = require('./_db');
function isStaff(event) { const s = getSession(event); return s && s.startsWith('STAFF_') ? s.replace('STAFF_', '') : null; }
exports.handler = async (event) => {
  const login = isStaff(event);
  if (!login) return err(401, 'Не авторизован');
  const staff = (await sql`SELECT * FROM staff WHERE login = ${login}`)[0];
  if (event.httpMethod === 'GET') {
    const org = (await sql`SELECT * FROM org_account WHERE id = 1`)[0] || { balance: 0 };
    const ledger = await sql`SELECT * FROM org_ledger ORDER BY created_at DESC LIMIT 100`;
    return ok({ balance: Number(org.balance), ledger });
  }
  const b = JSON.parse(event.body || '{}');
  if (b.action === 'topup') {
    if (staff.role !== 'admin') return err(403, 'Только admin');
    const sum = Number(b.amount); if (!sum || sum <= 0) return err(400, 'Сумма'); if (!b.document) return err(400, 'Документ');
    await sql.transaction([sql`UPDATE org_account SET balance = balance + ${sum} WHERE id = 1`, sql`INSERT INTO org_ledger (amount, type, note, document) VALUES (${sum}, 'topup', 'Пополнение бюджета', ${b.document})`]);
    await logAudit(staff.name, staff.role, 'org_topup', 'org', sum + ' ₽ · ' + b.document);
    return ok({ ok: true });
  }
  if (b.action === 'payout') {
    if (staff.role === 'support') return err(403, 'Недостаточно прав');
    const sum = Number(b.amount); if (!sum || sum <= 0) return err(400, 'Сумма');
    const phone = String(b.phone || '').replace(/\D/g, '').slice(-10); if (!/^\d{10}$/.test(phone)) return err(400, 'Телефон');
    const salaryAcc = (await sql`SELECT * FROM accounts WHERE phone = ${phone} AND type = 'salary'`)[0];
    if (!salaryAcc) return err(404, 'Нет зарплатного счёта');
    if (sum > 50000 && !['admin','senior'].includes(staff.role)) return err(403, 'Требуется подтверждение');
    await sql.transaction([
      sql`UPDATE org_account SET balance = balance - ${sum} WHERE id = 1`,
      sql`UPDATE accounts SET balance = balance + ${sum} WHERE id = ${salaryAcc.id}`,
      sql`INSERT INTO org_ledger (amount, type, note, document, phone) VALUES (${-sum}, 'payout', ${'Выплата ' + phone}, ${'PAY-' + Date.now()}, ${phone})`,
      sql`INSERT INTO transactions (tx_number, from_phone, to_phone, amount, comment, type, status, history) VALUES (${'TX' + Date.now()}, 'org', ${phone}, ${sum}, ${b.comment || 'Выплата'}, 'org_transfer', 'completed', ${JSON.stringify([{ status: 'completed', date: new Date().toISOString(), by: staff.name }])}::jsonb)`
    ]);
    await pushNotif(phone, 'Выплата от банка', 'Зачислено ' + sum + ' ₽ на зарплатный счёт.', 'transfer_in');
    await logAudit(staff.name, staff.role, 'org_payout', phone, sum + ' ₽');
    return ok({ ok: true });
  }
  return err(400, 'Неизвестное действие');
};
