const { sql, getSession, ok, err } = require('./_db');
exports.handler = async (event) => {
  const q = (event.queryStringParameters || {});
  const isAdmin = q.admin === '1';
  let phone = null;
  if (!isAdmin) { phone = getSession(event); if (!phone) return err(401, 'Не авторизован'); }
  const search = q.search ? '%' + q.search + '%' : null;
  const type = q.type;
  let rows;
  if (isAdmin) {
    rows = search ? await sql`SELECT * FROM transactions WHERE tx_number ILIKE ${search} OR comment ILIKE ${search} ORDER BY created_at DESC LIMIT 200` : await sql`SELECT * FROM transactions ORDER BY created_at DESC LIMIT 200`;
  } else {
    rows = search ? await sql`SELECT * FROM transactions WHERE (from_phone = ${phone} OR to_phone = ${phone}) AND (tx_number ILIKE ${search} OR comment ILIKE ${search} OR from_phone ILIKE ${search} OR to_phone ILIKE ${search}) ORDER BY created_at DESC LIMIT 200` : await sql`SELECT * FROM transactions WHERE from_phone = ${phone} OR to_phone = ${phone} ORDER BY created_at DESC LIMIT 200`;
    if (type === 'in') rows = rows.filter(r => r.to_phone === phone);
    if (type === 'out') rows = rows.filter(r => r.from_phone === phone);
  }
  return ok({ transactions: rows });
};
