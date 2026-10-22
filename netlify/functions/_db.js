const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const sql = neon(process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL);

async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      phone TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, email_verified BOOLEAN DEFAULT FALSE,
      email_code TEXT, email_code_expires TIMESTAMPTZ, surname TEXT NOT NULL, name TEXT NOT NULL,
      patronymic TEXT DEFAULT '', dob DATE NOT NULL, codeword TEXT NOT NULL, pin_hash TEXT,
      status TEXT DEFAULT 'active', balance NUMERIC DEFAULT 0, limit_per_day NUMERIC DEFAULT 100000,
      blocked_reason TEXT, fraud_strikes INT DEFAULT 0, close_request_id INT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id SERIAL PRIMARY KEY, phone TEXT NOT NULL REFERENCES users(phone) ON DELETE CASCADE,
      type TEXT NOT NULL, account_number TEXT UNIQUE NOT NULL, card_number TEXT, balance NUMERIC DEFAULT 0,
      is_main BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY, tx_number TEXT UNIQUE NOT NULL, from_phone TEXT, to_phone TEXT,
      from_account TEXT, to_account TEXT, amount NUMERIC NOT NULL, comment TEXT DEFAULT '',
      type TEXT DEFAULT 'transfer', status TEXT DEFAULT 'pending', history JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY, phone TEXT NOT NULL REFERENCES users(phone) ON DELETE CASCADE,
      title TEXT NOT NULL, text TEXT NOT NULL, type TEXT DEFAULT 'info', read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id SERIAL PRIMARY KEY, ticket_code TEXT UNIQUE NOT NULL, phone TEXT NOT NULL REFERENCES users(phone) ON DELETE CASCADE,
      subject TEXT DEFAULT 'Обращение', status TEXT DEFAULT 'open', priority TEXT DEFAULT 'normal', created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY, ticket_code TEXT NOT NULL, phone TEXT NOT NULL,
      from_who TEXT NOT NULL, author TEXT DEFAULT '', text TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS close_requests (
      id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, phone TEXT NOT NULL, total NUMERIC, fee NUMERIC, payout NUMERIC,
      req_account TEXT, req_bik TEXT, req_bank TEXT, req_inn TEXT, comment TEXT DEFAULT '',
      status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS org_account (id INT PRIMARY KEY DEFAULT 1, balance NUMERIC DEFAULT 0);
    INSERT INTO org_account (id, balance) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
    CREATE TABLE IF NOT EXISTS org_ledger (
      id SERIAL PRIMARY KEY, amount NUMERIC NOT NULL, type TEXT NOT NULL, note TEXT, document TEXT, phone TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY, actor TEXT NOT NULL, role TEXT NOT NULL, action TEXT NOT NULL, target TEXT, details TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS antifraud_log (
      id SERIAL PRIMARY KEY, phone TEXT NOT NULL, amount NUMERIC, reason TEXT, tx_number TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS staff (
      login TEXT PRIMARY KEY, password_hash TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL
    );
  `;

  const exists = await sql`SELECT login FROM staff WHERE login = 'admin'`;
  if (exists.length === 0) {
    const staff = [
      { login:'admin', pass:'admin123', name:'Администратор', role:'admin' },
      { login:'senior', pass:'senior123', name:'Старший поддержки', role:'senior' },
      { login:'support', pass:'support123', name:'Сотрудник поддержки', role:'support' },
      { login:'audit', pass:'audit123', name:'Аудитор', role:'auditor' }
    ];
    for (const s of staff) {
      const hash = await bcrypt.hash(s.pass, 8);
      await sql`INSERT INTO staff (login, password_hash, name, role) VALUES (${s.login}, ${hash}, ${s.name}, ${s.role}) ON CONFLICT (login) DO NOTHING`;
    }
  }
}

function genAccountNumber() { return '40817' + Math.floor(100000000000 + Math.random() * 899999999999); }
function genCardNumber() { const p = () => Math.floor(1000 + Math.random() * 9000); return `${p()} ${p()} ${p()} ${p()}`; }
function genTxNumber() { return 'TX' + Date.now() + Math.floor(Math.random() * 1000); }
function genTicketCode() { return 'TK' + Date.now().toString(36).toUpperCase(); }
function normalizePhone(v) { let d = String(v || '').replace(/\D/g, ''); if (d.length === 11 && (d[0] === '7' || d[0] === '8')) d = d.slice(1); return d.slice(0, 10); }
async function pushNotif(phone, title, text, type = 'info') { await sql`INSERT INTO notifications (phone, title, text, type) VALUES (${phone}, ${title}, ${text}, ${type})`; }
async function logAudit(actor, role, action, target, details) { await sql`INSERT INTO audit_log (actor, role, action, target, details) VALUES (${actor}, ${role}, ${action}, ${target || ''}, ${details || ''})`; }

async function antifraudCheck(fromPhone, amount, comment) {
  const reasons = [];
  if (Number(amount) >= 100000) reasons.push('Сумма от 100 000 ₽ требует проверки по 115-ФЗ');
  const hourly = await sql`SELECT COUNT(*)::int AS c FROM transactions WHERE from_phone = ${fromPhone} AND created_at > NOW() - INTERVAL '1 hour'`;
  if (hourly[0].c >= 5) reasons.push('Более 5 переводов за последний час');
  const suspicious = ['крипта', 'обнал', 'отмыв', 'дроп', 'карта друга', 'нарко'];
  const cm = String(comment || '').toLowerCase();
  for (const w of suspicious) { if (cm.includes(w)) { reasons.push('Подозрительный комментарий: ' + w); break; } }
  return reasons;
}

function signToken(phone) {
  const exp = Date.now() + 24 * 3600 * 1000; const payload = `${phone}|${exp}`;
  const secret = process.env.SESSION_SECRET || 'qwertybank-dev-secret';
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 16);
  return Buffer.from(`${payload}|${hmac}`).toString('base64');
}
function verifyToken(token) {
  try {
    const raw = Buffer.from(token, 'base64').toString(); const [phone, exp, hmac] = raw.split('|');
    if (Number(exp) < Date.now()) return null;
    const secret = process.env.SESSION_SECRET || 'qwertybank-dev-secret';
    const payload = `${phone}|${exp}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 16);
    if (expected !== hmac) return null; return phone;
  } catch (e) { return null; }
}
function getSession(event) { const h = event.headers.authorization || event.headers.Authorization || ''; return verifyToken(h.replace(/^Bearer\s+/i, '')); }
function corsHeaders() { return { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }; }
function ok(body) { return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(body) }; }
function err(code, msg) { return { statusCode: code, headers: corsHeaders(), body: JSON.stringify({ error: msg }) }; }

module.exports = {
  sql, ensureSchema, bcrypt, genAccountNumber, genCardNumber, genTxNumber, genTicketCode,
  normalizePhone, pushNotif, logAudit, antifraudCheck, signToken, verifyToken, getSession, ok, err, corsHeaders
};
