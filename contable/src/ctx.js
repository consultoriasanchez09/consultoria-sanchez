const { getDb, insert } = require('./db');
const { AppError } = require('./errors');
const { formatNumber } = require('./catalogs');
const { ACCOUNT_KEYS } = require('./plan');
const { assertBalanced } = require('./accounting');

function db() { return getDb(); }
function isoNow() { return new Date().toISOString(); }

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ || 'UTC' }).format(new Date());
}

function assertDate(value, label = 'fecha') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) throw new AppError(`La ${label} no es válida (use AAAA-MM-DD).`);
  return String(value);
}

function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Number(days || 0)));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

async function loadCtx(companyId) {
  const company = await db().get('SELECT * FROM companies WHERE id = ?', [companyId]);
  if (!company) throw new AppError('Empresa no encontrada.', 404);
  const accounts = await db().all('SELECT * FROM accounts WHERE company_id = ? ORDER BY code', [companyId]);
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const byId = new Map(accounts.map((a) => [Number(a.id), a]));
  const rows = await db().all('SELECT skey, svalue FROM settings WHERE company_id = ?', [companyId]);
  const settings = Object.fromEntries(rows.map((r) => [r.skey, r.svalue]));
  function accountByKey(key) {
    if (byCode.has(key)) return byCode.get(key);
    const setting = ACCOUNT_KEYS[key];
    const code = setting ? settings[setting] : null;
    const account = code ? byCode.get(code) : byCode.get(key);
    if (!account) throw new AppError(`Falta configurar la cuenta «${key}».`);
    if (!account.is_movement) throw new AppError(`La cuenta ${account.code} ${account.name} no admite movimientos.`);
    return account;
  }
  return { company, accounts, byCode, byId, settings, accountByKey };
}

async function assertPeriodOpen(companyId, date) {
  const year = Number(String(date).slice(0, 4));
  const row = await db().get('SELECT 1 AS ok FROM year_closes WHERE company_id = ? AND year = ?', [companyId, year]);
  if (row) throw new AppError(`El ejercicio ${year} está cerrado.`);
}

async function nextNumber(companyId, docType, est = '001', punto = '001') {
  const row = await db().get('SELECT last_no FROM sequences WHERE company_id = ? AND doc_type = ?', [companyId, docType]);
  const n = (row ? Number(row.last_no) : 0) + 1;
  if (row) await db().run('UPDATE sequences SET last_no = ? WHERE company_id = ? AND doc_type = ?', [n, companyId, docType]);
  else await db().run('INSERT INTO sequences (company_id, doc_type, last_no) VALUES (?, ?, ?)', [companyId, docType, n]);
  return formatNumber(docType, n, est, punto);
}

async function insertJournal(ctx, { date, description, source, sourceId, userId, lines }) {
  const balanced = assertBalanced(lines);
  if (!balanced.lines.length) return null;
  const docNumber = await nextNumber(ctx.company.id, 'ASI');
  const entry = await insert('journal_entries', {
    company_id: ctx.company.id,
    doc_date: date,
    doc_number: docNumber,
    description,
    source,
    source_id: sourceId || null,
    status: 'CONTABILIZADO',
    created_by: userId || null,
    created_at: isoNow(),
  });
  for (const line of balanced.lines) {
    const account = ctx.accountByKey(line.account);
    await insert('journal_lines', {
      entry_id: entry.lastId,
      account_id: account.id,
      debit_cents: line.debitCents,
      credit_cents: line.creditCents,
      description: line.description || description,
      party_id: line.partyId || null,
    });
  }
  return { id: entry.lastId, number: docNumber, lines: balanced.lines, total: balanced.total };
}

function decorateJournal(ctx, lines) {
  return lines.map((line) => {
    const account = ctx.accountByKey(line.account);
    return {
      account: line.account,
      code: account.code,
      name: account.name,
      debitCents: line.debitCents,
      creditCents: line.creditCents,
      partyId: line.partyId || null,
    };
  });
}

module.exports = {
  db, isoNow, todayISO, assertDate, addDays, loadCtx, assertPeriodOpen, nextNumber, insertJournal, decorateJournal,
};
