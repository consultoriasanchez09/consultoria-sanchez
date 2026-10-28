const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('./db');
const { AppError } = require('./errors');
const { catalogs } = require('./catalogs');
const { todayISO } = require('./ctx');
const { companiesFor, provisionCompany, updateCompany, saveSettings, saveParty, saveProduct, saveAccount, createUser, updateUser } = require('./company');
const { postDocument, previewDocument, voidDocument, convertQuote } = require('./posting');
const { postSettlement, proposeApplication, postBankAccount, postBankMovement, clearPostdated, reconcile, bankPosition, openInvoices } = require('./treasury');
const { postManualJournal, closeYear, postWarehouse } = require('./ledger');
const { previewPayroll, postPayroll } = require('./payroll-run');
const { backupCompany, restoreCompany } = require('./backup');
const { importPurchaseSheet } = require('./importing');
const { sendTable, purchaseTemplateBuffer } = require('./exporters');
const reports = require('./reports');

const attempts = new Map();

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function guard(opts = {}) {
  const { write = false, roles = null, company = true } = opts;
  return wrap(async (req, res, next) => {
    const user = req.session.user;
    if (!user) throw new AppError('Debe iniciar sesión.', 401);
    if (write && user.role === 'consulta') throw new AppError('Su rol es de solo consulta.', 403);
    if (roles && !roles.includes(user.role)) throw new AppError('No tiene permiso para esta acción.', 403);
    if (company) {
      if (!req.session.companyId) throw new AppError('Seleccione una empresa.');
      if (user.role !== 'admin') {
        const ok = await getDb().get('SELECT 1 AS ok FROM user_companies WHERE user_id = ? AND company_id = ?', [user.id, req.session.companyId]);
        if (!ok) throw new AppError('No tiene acceso a esta empresa.', 403);
      }
    }
    next();
  });
}

function cid(req) { return req.session.companyId; }
function uid(req) { return req.session.user.id; }

function period(req) {
  const today = todayISO();
  return { from: req.query.from || `${today.slice(0, 4)}-01-01`, to: req.query.to || req.query.date || today, today };
}

async function maybeExport(req, res, filename, data, toTable) {
  if (req.query.format === 'pdf' || req.query.format === 'xlsx') {
    return sendTable(res, { filename, format: req.query.format, ...toTable(data) });
  }
  res.json(data);
}

async function publicCompany(user, companyId) {
  const companies = await companiesFor(user);
  const company = companies.find((c) => c.id === companyId) || null;
  return {
    user: { id: user.id, username: user.username, name: user.name, role: user.role },
    companies,
    company,
  };
}

function buildRouter() {
  const router = express.Router();
  router.get('/health', wrap(async (req, res) => {
    res.json({ ok: true, dialect: getDb().dialect, service: 'consultoria-sanchez-contable', today: todayISO() });
  }));
  router.get('/catalogs', guard({ company: false }), wrap(async (req, res) => res.json(catalogs())));

  router.post('/login', wrap(async (req, res) => {
    const username = String(req.body.username || '').trim().toLowerCase();
    const key = username || req.ip;
    const hit = attempts.get(key) || { n: 0, t: 0 };
    if (hit.n >= 8 && Date.now() - hit.t < 10 * 60 * 1000) throw new AppError('Demasiados intentos. Espere unos minutos.', 429);
    const user = await getDb().get('SELECT * FROM users WHERE username = ?', [username]);
    const ok = user && user.active && await bcrypt.compare(String(req.body.password || ''), user.password_hash);
    if (!ok) {
      attempts.set(key, { n: hit.n + 1, t: Date.now() });
      throw new AppError('Usuario o contraseña incorrectos.', 401);
    }
    attempts.delete(key);
    const companies = await companiesFor(user);
    req.session.user = { id: user.id, username: user.username, name: user.name, role: user.role };
    req.session.companyId = companies[0] ? companies[0].id : null;
    res.json(await publicCompany(req.session.user, req.session.companyId));
  }));

  router.post('/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
  router.get('/me', guard({ company: false }), wrap(async (req, res) => {
    res.json(await publicCompany(req.session.user, req.session.companyId));
  }));
  router.post('/session/company', guard({ company: false }), wrap(async (req, res) => {
    const companies = await companiesFor(req.session.user);
    const company = companies.find((c) => c.id === Number(req.body.companyId));
    if (!company) throw new AppError('No tiene acceso a esa empresa.', 403);
    req.session.companyId = company.id;
    res.json(await publicCompany(req.session.user, company.id));
  }));
  router.post('/me/password', guard({ company: false, write: true }), wrap(async (req, res) => {
    const user = await getDb().get('SELECT * FROM users WHERE id = ?', [uid(req)]);
    if (!await bcrypt.compare(String(req.body.current || ''), user.password_hash)) throw new AppError('La contraseña actual no coincide.');
    if (String(req.body.next || '').length < 8) throw new AppError('La nueva contraseña debe tener al menos 8 caracteres.');
    await getDb().run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(req.body.next, 10), user.id]);
    res.json({ ok: true });
  }));

  router.get('/companies', guard({ company: false }), wrap(async (req, res) => res.json({ items: await companiesFor(req.session.user) })));
  router.post('/companies', guard({ company: false, write: true, roles: ['admin'] }), wrap(async (req, res) => {
    const id = await provisionCompany(req.body, uid(req));
    req.session.companyId = id;
    res.status(201).json(await getDb().get('SELECT * FROM companies WHERE id = ?', [id]));
  }));
  router.get('/company', guard(), wrap(async (req, res) => res.json(await getDb().get('SELECT * FROM companies WHERE id = ?', [cid(req)]))));
  router.put('/company', guard({ write: true, roles: ['admin', 'contador'] }), wrap(async (req, res) => {
    res.json(await updateCompany(cid(req), req.body));
  }));
  router.put('/companies/:id', guard({ company: false, write: true, roles: ['admin', 'contador'] }), wrap(async (req, res) => {
    res.json(await updateCompany(Number(req.params.id), req.body));
  }));

  router.get('/users', guard({ company: false, roles: ['admin'] }), wrap(async (req, res) => {
    const items = await getDb().all('SELECT id, username, name, role, active FROM users ORDER BY username');
    for (const item of items) {
      item.companies = (await getDb().all('SELECT company_id FROM user_companies WHERE user_id = ?', [item.id])).map((r) => r.company_id);
    }
    res.json({ items });
  }));
  router.post('/users', guard({ company: false, write: true, roles: ['admin'] }), wrap(async (req, res) => {
    res.status(201).json(await createUser(req.body));
  }));
  router.put('/users/:id', guard({ company: false, write: true, roles: ['admin'] }), wrap(async (req, res) => {
    res.json(await updateUser(Number(req.params.id), req.body));
  }));

  router.get('/settings', guard(), wrap(async (req, res) => {
    const rows = await getDb().all('SELECT skey, svalue FROM settings WHERE company_id = ? ORDER BY skey', [cid(req)]);
    res.json({ values: Object.fromEntries(rows.map((r) => [r.skey, r.svalue])) });
  }));
  router.put('/settings', guard({ write: true, roles: ['admin', 'contador'] }), wrap(async (req, res) => {
    res.json({ values: await saveSettings(cid(req), req.body.values || req.body) });
  }));

  router.get('/accounts', guard(), wrap(async (req, res) => {
    res.json({ items: await getDb().all('SELECT * FROM accounts WHERE company_id = ? ORDER BY code', [cid(req)]) });
  }));
  router.post('/accounts', guard({ write: true, roles: ['admin', 'contador'] }), wrap(async (req, res) => {
    res.status(201).json(await saveAccount(cid(req), req.body));
  }));
  router.put('/accounts/:id', guard({ write: true, roles: ['admin', 'contador'] }), wrap(async (req, res) => {
    res.json(await saveAccount(cid(req), req.body, Number(req.params.id)));
  }));

  router.get('/parties', guard(), wrap(async (req, res) => {
    const params = [cid(req)];
    let sql = 'SELECT * FROM parties WHERE company_id = ?';
    if (req.query.kind) { sql += ' AND kind = ?'; params.push(req.query.kind); }
    if (req.query.q) { sql += ' AND (name LIKE ? OR identification LIKE ? OR commercial_name LIKE ?)'; const q = `%${req.query.q}%`; params.push(q, q, q); }
    sql += ' ORDER BY name';
    res.json({ items: await getDb().all(sql, params) });
  }));
  router.post('/parties', guard({ write: true }), wrap(async (req, res) => res.status(201).json(await saveParty(cid(req), req.body))));
  router.put('/parties/:id', guard({ write: true }), wrap(async (req, res) => res.json(await saveParty(cid(req), req.body, Number(req.params.id)))));

  router.get('/products', guard(), wrap(async (req, res) => {
    const params = [cid(req)];
    let sql = 'SELECT * FROM products WHERE company_id = ?';
    if (req.query.q) { sql += ' AND (name LIKE ? OR code LIKE ?)'; const q = `%${req.query.q}%`; params.push(q, q); }
    sql += ' ORDER BY code';
    res.json({ items: await getDb().all(sql, params) });
  }));
  router.post('/products', guard({ write: true }), wrap(async (req, res) => res.status(201).json(await saveProduct(cid(req), req.body))));
  router.put('/products/:id', guard({ write: true }), wrap(async (req, res) => res.json(await saveProduct(cid(req), req.body, Number(req.params.id)))));

  router.get('/documents', guard(), wrap(async (req, res) => {
    const params = [cid(req)];
    let sql = `SELECT d.*, oi.balance_cents FROM documents d
      LEFT JOIN open_items oi ON oi.document_id = d.id AND oi.kind = 'FACTURA'
      WHERE d.company_id = ?`;
    if (req.query.type) { sql += ' AND d.doc_type = ?'; params.push(req.query.type); }
    if (req.query.from) { sql += ' AND d.doc_date >= ?'; params.push(req.query.from); }
    if (req.query.to) { sql += ' AND d.doc_date <= ?'; params.push(req.query.to); }
    if (req.query.q) { sql += ' AND (d.doc_number LIKE ? OR d.party_name LIKE ?)'; const q = `%${req.query.q}%`; params.push(q, q); }
    sql += ' ORDER BY d.doc_date DESC, d.id DESC LIMIT 300';
    res.json({ items: await getDb().all(sql, params) });
  }));
  router.get('/documents/:id', guard(), wrap(async (req, res) => res.json(await documentDetail(cid(req), Number(req.params.id)))));
  router.post('/documents/preview', guard({ write: true }), wrap(async (req, res) => {
    res.json(await previewDocument({ ...req.body, companyId: cid(req), userId: uid(req) }));
  }));
  router.post('/documents', guard({ write: true }), wrap(async (req, res) => {
    const created = await postDocument({ ...req.body, companyId: cid(req), userId: uid(req) });
    res.status(201).json(created);
  }));
  router.post('/documents/:id/void', guard({ write: true, roles: ['admin', 'contador'] }), wrap(async (req, res) => {
    res.json(await voidDocument({ companyId: cid(req), userId: uid(req), documentId: Number(req.params.id) }));
  }));
  router.post('/documents/:id/convert', guard({ write: true }), wrap(async (req, res) => {
    res.json(await convertQuote({ companyId: cid(req), userId: uid(req), documentId: Number(req.params.id), date: req.body.date }));
  }));

  router.get('/open-items', guard(), wrap(async (req, res) => {
    const side = req.query.side === 'AP' ? 'AP' : 'AR';
    res.json({ items: await openInvoices(cid(req), side, req.query.partyId ? Number(req.query.partyId) : null, req.query.cutoff || null, req.query.kind || 'FACTURA') });
  }));
  router.post('/settlements/propose', guard({ write: true }), wrap(async (req, res) => {
    res.json(await proposeApplication({
      companyId: cid(req), side: req.body.side, partyId: req.body.partyId, amountCents: req.body.amountCents, cutoff: req.body.cutoff,
    }));
  }));
  router.post('/settlements', guard({ write: true }), wrap(async (req, res) => {
    res.status(201).json(await postSettlement({ ...req.body, companyId: cid(req), userId: uid(req) }));
  }));
  router.get('/settlements', guard(), wrap(async (req, res) => {
    const params = [cid(req)];
    let sql = 'SELECT * FROM settlements WHERE company_id = ?';
    if (req.query.side) { sql += ' AND side = ?'; params.push(req.query.side); }
    sql += ' ORDER BY doc_date DESC, id DESC LIMIT 200';
    res.json({ items: await getDb().all(sql, params) });
  }));

  router.get('/banks', guard(), wrap(async (req, res) => {
    res.json({ items: await getDb().all('SELECT * FROM bank_accounts WHERE company_id = ? ORDER BY name', [cid(req)]) });
  }));
  router.post('/banks', guard({ write: true }), wrap(async (req, res) => res.status(201).json(await postBankAccount({ ...req.body, companyId: cid(req) }))));
  router.get('/banks/:id/movements', guard(), wrap(async (req, res) => {
    res.json(await bankPosition(cid(req), Number(req.params.id), req.query.statementCents));
  }));
  router.post('/banks/movements', guard({ write: true }), wrap(async (req, res) => {
    res.status(201).json(await postBankMovement({ ...req.body, companyId: cid(req), userId: uid(req) }));
  }));
  router.post('/banks/movements/:id/clear', guard({ write: true }), wrap(async (req, res) => {
    res.json(await clearPostdated({ companyId: cid(req), userId: uid(req), movementId: Number(req.params.id), date: req.body.date }));
  }));
  router.post('/banks/:id/reconcile', guard({ write: true }), wrap(async (req, res) => {
    res.json(await reconcile({ companyId: cid(req), bankId: Number(req.params.id), movementIds: req.body.movementIds, statementCents: req.body.statementCents, date: req.body.date }));
  }));
  router.get('/banks/postdated', guard(), wrap(async (req, res) => {
    res.json({
      items: await getDb().all(
        `SELECT m.*, b.name AS bank_name FROM bank_movements m JOIN bank_accounts b ON b.id = m.bank_account_id
         WHERE m.company_id = ? AND m.postdated = 1 ORDER BY m.doc_date`,
        [cid(req)]
      ),
    });
  }));

  router.get('/inventory/stock', guard(), wrap(async (req, res) => res.json({ items: await reports.stockReport(cid(req)) })));
  router.get('/inventory/kardex', guard(), wrap(async (req, res) => {
    const { from, to } = period(req);
    res.json(await reports.kardex(cid(req), Number(req.query.productId), from, to));
  }));
  router.post('/inventory/warehouse', guard({ write: true }), wrap(async (req, res) => {
    res.status(201).json(await postWarehouse({ ...req.body, companyId: cid(req), userId: uid(req) }));
  }));
  router.get('/inventory/template', guard(), wrap(async (req, res) => {
    const buf = await purchaseTemplateBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla-compras.xlsx"');
    res.send(Buffer.from(buf));
  }));
  router.post('/inventory/import', guard({ write: true }), wrap(async (req, res) => {
    if (!req.body.fileBase64) throw new AppError('Adjunte el archivo de Excel.');
    const result = await importPurchaseSheet(cid(req), uid(req), Buffer.from(req.body.fileBase64, 'base64'));
    res.json(result);
  }));
  router.get('/inventory/report', guard(), wrap(async (req, res) => {
    const { from, to } = period(req);
    if (req.query.kind === 'bodega') return res.json({ items: await reports.stockReport(cid(req)) });
    res.json({ items: await reports.movementReport(cid(req), req.query.kind === 'compras' ? 'compras' : 'ventas', from, to) });
  }));

  router.get('/journal', guard(), wrap(async (req, res) => {
    const { from, to } = period(req);
    const entries = await reports.journalList(cid(req), from, to);
    await maybeExport(req, res, 'diario-general', { from, to, entries }, () => ({
      title: 'Diario general', subtitle: `${from} a ${to}`,
      columns: [{ key: 'date', header: 'Fecha' }, { key: 'number', header: 'Número' }, { key: 'description', header: 'Descripción' }, { key: 'account', header: 'Cuenta' }, { key: 'debit', header: 'Débito', money: true }, { key: 'credit', header: 'Crédito', money: true }],
      rows: entries.flatMap((e) => e.lines.map((l) => ({ date: e.doc_date, number: e.doc_number, description: e.description, account: `${l.code} ${l.name}`, debit: l.debit_cents, credit: l.credit_cents }))),
    }));
  }));
  router.post('/journal', guard({ write: true, roles: ['admin', 'contador'] }), wrap(async (req, res) => {
    res.status(201).json(await postManualJournal({ ...req.body, companyId: cid(req), userId: uid(req) }));
  }));
  router.get('/journal/unbalanced', guard(), wrap(async (req, res) => res.json({ items: await reports.unbalanced(cid(req)) })));
  router.post('/year-close', guard({ write: true, roles: ['admin', 'contador'] }), wrap(async (req, res) => {
    res.json(await closeYear({ companyId: cid(req), userId: uid(req), year: req.body.year }));
  }));
  router.get('/year-closes', guard(), wrap(async (req, res) => {
    res.json({ items: await getDb().all('SELECT * FROM year_closes WHERE company_id = ? ORDER BY year', [cid(req)]) });
  }));

  router.get('/reports/ledger', guard(), wrap(async (req, res) => {
    const { from, to } = period(req);
    const data = await reports.ledger(cid(req), Number(req.query.accountId), from, to);
    await maybeExport(req, res, 'mayor', data, () => ({
      title: `Mayor ${data.account.code} ${data.account.name}`, subtitle: `${from} a ${to}`,
      columns: [{ key: 'doc_date', header: 'Fecha' }, { key: 'doc_number', header: 'Número' }, { key: 'description', header: 'Descripción' }, { key: 'debit_cents', header: 'Débito', money: true }, { key: 'credit_cents', header: 'Crédito', money: true }, { key: 'balanceCents', header: 'Saldo', money: true }],
      rows: data.items,
    }));
  }));
  router.get('/reports/trial-balance', guard(), wrap(async (req, res) => {
    const { from, to } = period(req);
    const data = await reports.trialBalance(cid(req), from, to, req.query.includeZero === '1');
    await maybeExport(req, res, 'balance-comprobacion', data, () => ({
      title: 'Balance de comprobación', subtitle: `${from} a ${to}`,
      columns: [
        { key: 'code', header: 'Código' }, { key: 'name', header: 'Cuenta' },
        { key: 'openDebit', header: 'SI debe', money: true }, { key: 'openCredit', header: 'SI haber', money: true },
        { key: 'debit', header: 'Debe', money: true }, { key: 'credit', header: 'Haber', money: true },
        { key: 'endDebit', header: 'SF debe', money: true }, { key: 'endCredit', header: 'SF haber', money: true },
      ],
      rows: data.items,
    }));
  }));
  router.get('/reports/balance-sheet', guard(), wrap(async (req, res) => {
    const date = req.query.date || todayISO();
    const data = await reports.balanceSheet(cid(req), date);
    const rows = [
      ...data.assets.map((r) => ({ group: 'Activo', ...r })),
      { group: 'Activo', code: '', name: 'Total activo', amountCents: data.totalAssets },
      ...data.liabilities.map((r) => ({ group: 'Pasivo', ...r })),
      ...data.equity.map((r) => ({ group: 'Patrimonio', ...r })),
      { group: 'Pasivo y patrimonio', code: '', name: 'Total pasivo y patrimonio', amountCents: data.totalLiabilitiesAndEquity },
    ];
    await maybeExport(req, res, 'estado-situacion-financiera', data, () => ({
      title: 'Estado de situación financiera', subtitle: `Al ${date}`,
      columns: [{ key: 'group', header: 'Grupo' }, { key: 'code', header: 'Código' }, { key: 'name', header: 'Cuenta' }, { key: 'amountCents', header: 'Saldo', money: true }],
      rows,
    }));
  }));
  router.get('/reports/income', guard(), wrap(async (req, res) => {
    const { from, to } = period(req);
    const data = await reports.incomeStatement(cid(req), from, to);
    const rows = [
      ...data.income.map((r) => ({ group: 'Ingresos', ...r })),
      ...data.costs.map((r) => ({ group: 'Costos', ...r })),
      ...data.expenses.map((r) => ({ group: 'Gastos', ...r })),
      { group: 'Resultado', code: '', name: 'Utilidad o pérdida', amountCents: data.profitCents },
    ];
    await maybeExport(req, res, 'estado-resultados', data, () => ({
      title: 'Estado de resultados', subtitle: `${from} a ${to}`,
      columns: [{ key: 'group', header: 'Grupo' }, { key: 'code', header: 'Código' }, { key: 'name', header: 'Cuenta' }, { key: 'amountCents', header: 'Saldo', money: true }],
      rows,
    }));
  }));
  router.get('/reports/crosscheck', guard(), wrap(async (req, res) => res.json(await reports.crosscheck(cid(req), req.query.date || todayISO()))));
  router.get('/reports/statement', guard(), wrap(async (req, res) => {
    const { from, to } = period(req);
    const data = await reports.statement(cid(req), req.query.side === 'AP' ? 'AP' : 'AR', Number(req.query.partyId), from, to);
    await maybeExport(req, res, 'estado-de-cuenta', data, () => ({
      title: `Estado de cuenta ${data.party.name}`, subtitle: `${from} a ${to}`,
      columns: [{ key: 'doc_date', header: 'Fecha' }, { key: 'doc_number', header: 'Número' }, { key: 'description', header: 'Detalle' }, { key: 'debit_cents', header: 'Cargo', money: true }, { key: 'credit_cents', header: 'Abono', money: true }, { key: 'balanceCents', header: 'Saldo', money: true }],
      rows: data.items,
    }));
  }));
  router.get('/reports/aging', guard(), wrap(async (req, res) => {
    const cutoff = req.query.cutoff || todayISO();
    const data = await reports.agingReport(cid(req), req.query.side === 'AP' ? 'AP' : 'AR', cutoff);
    const rows = data.buckets.flatMap((b) => b.items.map((item) => ({ bucket: b.label, ...item })));
    await maybeExport(req, res, 'cartera', { ...data, rows }, () => ({
      title: 'Cartera por vencimiento', subtitle: `Corte ${cutoff}`,
      columns: [{ key: 'bucket', header: 'Tramo' }, { key: 'partyName', header: 'Persona' }, { key: 'docNumber', header: 'Documento' }, { key: 'dueDate', header: 'Vence' }, { key: 'balanceCents', header: 'Saldo', money: true }],
      rows,
    }));
  }));
  router.get('/reports/debts', guard(), wrap(async (req, res) => {
    const data = await reports.debtReport(cid(req), req.query.side === 'AP' ? 'AP' : 'AR', req.query.cutoff || todayISO());
    await maybeExport(req, res, 'deudas', data, () => ({
      title: 'Deudas a la fecha de corte', subtitle: data.cutoff,
      columns: [{ key: 'name', header: 'Persona' }, { key: 'identification', header: 'Identificación' }, { key: 'balanceCents', header: 'Saldo', money: true }],
      rows: data.parties,
    }));
  }));

  router.get('/sri/104', guard(), wrap(async (req, res) => res.json(await reports.form104(cid(req), req.query.year, req.query.month))));
  router.get('/sri/103', guard(), wrap(async (req, res) => res.json(await reports.form103(cid(req), req.query.year, req.query.month))));
  router.get('/sri/ats', guard(), wrap(async (req, res) => {
    if (req.query.format === 'xml') {
      const xml = await reports.atsXml(cid(req), req.query.year, req.query.month);
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="ATS-${req.query.year}-${req.query.month}.xml"`);
      return res.send(xml);
    }
    const data = await reports.atsData(cid(req), req.query.year, req.query.month);
    res.json({ year: data.year, month: data.month, purchases: data.purchases.length, sales: data.sales.length, company: data.company.name });
  }));
  router.get('/dashboard', guard(), wrap(async (req, res) => res.json(await reports.dashboard(cid(req)))));
  router.get('/einvoice', guard(), wrap(async (req, res) => res.json(await reports.einvoiceQueue(cid(req)))));

  router.post('/payroll/preview', guard({ write: true }), wrap(async (req, res) => res.json(await previewPayroll({ ...req.body, companyId: cid(req) }))));
  router.post('/payroll', guard({ write: true, roles: ['admin', 'contador'] }), wrap(async (req, res) => {
    res.status(201).json(await postPayroll({ ...req.body, companyId: cid(req), userId: uid(req) }));
  }));
  router.get('/payroll', guard(), wrap(async (req, res) => {
    const items = await getDb().all('SELECT * FROM payroll_runs WHERE company_id = ? ORDER BY year DESC, month DESC', [cid(req)]);
    res.json({ items });
  }));
  router.get('/payroll/:id', guard(), wrap(async (req, res) => {
    const run = await getDb().get('SELECT * FROM payroll_runs WHERE id = ? AND company_id = ?', [Number(req.params.id), cid(req)]);
    if (!run) throw new AppError('Rol no encontrado.', 404);
    run.lines = await getDb().all(
      `SELECT l.*, p.name, p.identification FROM payroll_lines l JOIN parties p ON p.id = l.employee_id WHERE l.run_id = ?`,
      [run.id]
    );
    res.json(run);
  }));

  router.get('/backup', guard({ roles: ['admin', 'contador'] }), wrap(async (req, res) => {
    const data = await backupCompany(cid(req));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="respaldo-empresa-${cid(req)}.json"`);
    res.send(JSON.stringify(data));
  }));
  router.post('/backup/restore', guard({ write: true, roles: ['admin', 'contador'] }), wrap(async (req, res) => {
    res.json(await restoreCompany(cid(req), req.body.data || req.body));
  }));

  router.use((req, res) => res.status(404).json({ error: 'No encontrado.' }));
  return router;
}

async function documentDetail(companyId, id) {
  const doc = await getDb().get('SELECT * FROM documents WHERE id = ? AND company_id = ?', [id, companyId]);
  if (!doc) throw new AppError('Documento no encontrado.', 404);
  doc.lines = await getDb().all('SELECT * FROM document_lines WHERE document_id = ? ORDER BY id', [id]);
  doc.retentions = await getDb().all('SELECT * FROM retention_lines WHERE document_id = ? ORDER BY id', [id]);
  doc.journal = [];
  if (doc.journal_entry_id) {
    doc.entry = await getDb().get('SELECT * FROM journal_entries WHERE id = ?', [doc.journal_entry_id]);
    doc.journal = await getDb().all(
      `SELECT l.*, a.code, a.name FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ? ORDER BY l.id`,
      [doc.journal_entry_id]
    );
  }
  const open = await getDb().get(`SELECT * FROM open_items WHERE document_id = ? AND kind = 'FACTURA'`, [id]);
  doc.open_item = open || null;
  return doc;
}

module.exports = { buildRouter };
