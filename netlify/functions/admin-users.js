const { sql, getSession, logAudit, pushNotif, ok, err } = require('./_db');
function isStaff(event) { const s = getSession(event); return s && s.startsWith('STAFF_') ? s.replace('STAFF_', '') : null; }
exports.handler = async (event) => {
  const login = isStaff(event);
  if (!login) return err(401, 'Не авторизован');
  const rows = await sql`SELECT login, name, role FROM staff WHERE login = ${login}`;
  if (!rows.length) return err(401, 'Сотрудник не найден');
  const staff = rows[0];
  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {};
    if (q.phone) {
      const u = (await sql`SELECT * FROM users WHERE phone = ${q.phone}`)[0];
      if (!u) return err(404, 'Пользователь');
      const accs = await sql`SELECT * FROM accounts WHERE phone = ${q.phone} ORDER BY is_main DESC`;
      const txs = await sql`SELECT * FROM transactions WHERE from_phone = ${q.phone} OR to_phone = ${q.phone} ORDER BY created_at DESC LIMIT 100`;
      return ok({ user: u, accounts: accs, transactions: txs });
    }
    const all = await sql`SELECT phone, surname, name, patronymic, email, status, balance, fraud_strikes, created_at FROM users ORDER BY created_at DESC`;
    return ok({ users: all });
  }
  const b = JSON.parse(event.body || '{}');
  const target = b.phone;
  const actions = {
    freeze: async () => { await sql`UPDATE users SET status = 'restricted' WHERE phone = ${target}`; await pushNotif(target, 'Счёт заморожен', 'Ваш счёт заморожен на проверку банком.', 'blocked'); return 'Счёт заморожен'; },
    unfreeze: async () => { await sql`UPDATE users SET status = 'active', blocked_reason = NULL, fraud_strikes = 0 WHERE phone = ${target}`; await pushNotif(target, 'Счёт разморожен', 'Доступ восстановлен.', 'verified'); return 'Разморожен'; },
    block115: async () => { const r = b.reason || 'Основание не указано'; await sql`UPDATE users SET status = 'blocked', blocked_reason = ${r} WHERE phone = ${target}`; await pushNotif(target, 'Счёт заблокирован по 115-ФЗ', 'Причина: ' + r, 'blocked'); return 'Заблокирован по 115-ФЗ'; },
    setLimit: async () => { await sql`UPDATE users SET limit_per_day = ${Number(b.amount) || 100000}, status = 'restricted' WHERE phone = ${target}`; await pushNotif(target, 'Ограничение платежей', 'Лимит: ' + (b.amount || 100000) + ' ₽', 'info'); return 'Лимит установлен'; },
    notify: async () => { await pushNotif(target, b.title || 'Сообщение поддержки', b.text || '', 'support'); return 'Уведомление отправлено'; },
    changeData: async () => { if (staff.role !== 'admin') return { error: 'Только admin' }; await sql`UPDATE users SET surname = ${b.surname}, name = ${b.name}, patronymic = ${b.patronymic || ''}, dob = ${b.dob}, codeword = ${b.codeword} WHERE phone = ${target}`; await pushNotif(target, 'Данные профиля изменены', 'Администратор изменил ваши данные.', 'support'); return 'Данные обновлены'; },
    withdraw: async () => {
      if (staff.role === 'support') return { error: 'Недостаточно прав' };
      const sum = Number(b.amount); if (!sum || sum <= 0) return { error: 'Сумма' };
      const acc = (await sql`SELECT * FROM accounts WHERE id = ${b.accountId} AND phone = ${target}`)[0];
      if (!acc) return { error: 'Счёт' };
      if (Number(acc.balance) < sum) return { error: 'Недостаточно' };
      await sql.transaction([
        sql`UPDATE accounts SET balance = balance - ${sum} WHERE id = ${acc.id}`,
        sql`UPDATE org_account SET balance = balance + ${sum} WHERE id = 1`,
        sql`INSERT INTO org_ledger (amount, type, note, document, phone) VALUES (${sum}, 'withdraw', ${'Списание с ' + target + ': ' + (b.reason || '')}, ${'WD-' + Date.now()}, ${target})`,
        sql`INSERT INTO transactions (tx_number, from_phone, to_phone, amount, comment, type, status, history) VALUES (${'TX' + Date.now()}, ${target}, 'org', ${sum}, ${b.reason || 'Списание'}, 'withdraw', 'completed', ${JSON.stringify([{ status: 'completed', date: new Date().toISOString(), by: staff.name }])}::jsonb)`
      ]);
      await pushNotif(target, 'Списание со счёта', 'Списано ' + sum + ' ₽.', 'blocked');
      return 'Списано';
    }
  };
  if (!actions[b.action]) return err(400, 'Неизвестное действие');
  try { const result = await actions[b.action](); if (result && result.error) return err(403, result.error); await logAudit(staff.name, staff.role, b.action, target, result); return ok({ ok: true, result }); }
  catch (e) { return err(500, e.message); }
};
