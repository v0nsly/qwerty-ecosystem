const { sql, getSession, genTicketCode, ok, err } = require('./_db');
exports.handler = async (event) => {
  const phone = getSession(event);
  if (!phone) return err(401, 'Не авторизован');
  if (event.httpMethod === 'GET') {
    const t = await sql`SELECT * FROM tickets WHERE phone = ${phone} AND status != 'closed' ORDER BY id DESC LIMIT 1`;
    let ticket = t[0];
    if (!ticket) return ok({ ticket: null, messages: [] });
    const msgs = await sql`SELECT * FROM chat_messages WHERE ticket_code = ${ticket.ticket_code} ORDER BY created_at ASC`;
    return ok({ ticket, messages: msgs });
  }
  const b = JSON.parse(event.body || '{}');
  const text = String(b.text || '').trim();
  if (!text) return err(400, 'Пусто');
  let ticket = (await sql`SELECT * FROM tickets WHERE phone = ${phone} AND status != 'closed' LIMIT 1`)[0];
  if (!ticket) {
    const code = genTicketCode();
    await sql`INSERT INTO tickets (ticket_code, phone, subject, status) VALUES (${code}, ${phone}, 'Обращение в поддержку', 'open')`;
    ticket = { ticket_code: code };
  }
  await sql`INSERT INTO chat_messages (ticket_code, phone, from_who, text) VALUES (${ticket.ticket_code}, ${phone}, 'user', ${text})`;
  return ok({ ok: true, ticketCode: ticket.ticket_code });
};
