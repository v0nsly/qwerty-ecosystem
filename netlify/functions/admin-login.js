const { sql, bcrypt, signToken, logAudit, ok, err } = require('./_db');
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return err(405, 'Method');
  const b = JSON.parse(event.body || '{}');
  if (!b.code) {
    const rows = await sql`SELECT * FROM staff WHERE login = ${b.login}`;
    if (!rows.length) return err(401, 'Неверные данные');
    const st = rows[0];
    const match = await bcrypt.compare(b.password || '', st.password_hash);
    if (!match) return err(401, 'Неверные данные');
    return ok({ twoFA: true, login: st.login });
  }
  if (b.code !== '123456') return err(401, 'Неверный 2FA-код');
  const rows = await sql`SELECT * FROM staff WHERE login = ${b.login}`;
  if (!rows.length) return err(401, 'Неверные данные');
  const st = rows[0];
  await logAudit(st.name, st.role, 'login', 'staff', 'Вход в QwertyJob');
  return ok({ ok: true, token: signToken('STAFF_' + st.login), staff: { name: st.name, role: st.role } });
};
