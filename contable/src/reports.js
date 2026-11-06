const { AppError } = require('./errors');
const { db, loadCtx, todayISO } = require('./ctx');
const { splitDebitCredit, accountingEquation, buildAging, naturalBalance } = require('./accounting');
const { buildAtsXml } = require('./ats');
const { monthRange, RETENTION_CODES, DOC_TYPES } = require('./catalogs');
const { bankPosition } = require('./treasury');

function n(value) { return Number(value || 0); }

function lastMonths(anchor, count = 6) {
  const [y, m] = anchor.split('-').map(Number);
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const label = new Intl.DateTimeFormat('es-EC', { month: 'short', timeZone: 'UTC' }).format(d).replace('.', '');
    out.push({ year, month, key: `${year}-${String(month).padStart(2, '0')}`, label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return out;
}

async function salesBase(companyId, yearMonth) {
  const rows = await db().all(
    `SELECT doc_type, COALESCE(SUM(base15_cents + base0_cents),0) AS base
     FROM documents
     WHERE company_id = ? AND status = 'EMITIDO' AND substr(doc_date, 1, 7) = ?
       AND doc_type IN ('FV','NV','NDV','NCV')
     GROUP BY doc_type`,
    [companyId, yearMonth]
  );
  let total = 0;
  for (const row of rows) total += row.doc_type === 'NCV' ? -n(row.base) : n(row.base);
  return total;
}

async function glBalance(companyId, code, until) {
  const row = await db().get(
    `SELECT COALESCE(SUM(l.debit_cents),0) AS d, COALESCE(SUM(l.credit_cents),0) AS c
     FROM journal_lines l
     JOIN journal_entries e ON e.id = l.entry_id
     JOIN accounts a ON a.id = l.account_id
     WHERE e.company_id = ? AND e.status = 'CONTABILIZADO' AND a.code = ? AND e.doc_date <= ?`,
    [companyId, code, until]
  );
  return n(row.d) - n(row.c);
}

async function dashboard(companyId) {
  const today = todayISO();
  const monthKey = today.slice(0, 7);
  const months = lastMonths(today, 6);
  const years = [months[0].year - 2, months[0].year - 1, months[months.length - 1].year];
  const uniqueYears = [...new Set(years)].sort();
  const series = [];
  for (const year of uniqueYears) {
    const values = [];
    for (const month of months) values.push(await salesBase(companyId, `${year}-${String(month.month).padStart(2, '0')}`));
    series.push({ year, values });
  }
  const aging = await agingReport(companyId, 'AR', today);
  const ar = await db().get(
    `SELECT COALESCE(SUM(balance_cents),0) AS s FROM open_items WHERE company_id = ? AND side = 'AR' AND kind = 'FACTURA' AND status = 'ABIERTO'`,
    [companyId]
  );
  const ap = await db().get(
    `SELECT COALESCE(SUM(balance_cents),0) AS s FROM open_items WHERE company_id = ? AND side = 'AP' AND kind = 'FACTURA' AND status = 'ABIERTO'`,
    [companyId]
  );
  const ctx = await loadCtx(companyId);
  const cash = await glBalance(companyId, ctx.settings.cuenta_caja, today) + await glBalance(companyId, ctx.settings.cuenta_bancos, today);
  const from = `${today.slice(0, 4)}-01-01`;
  const income = await incomeStatement(companyId, monthKey + '-01', today);
  const ytd = await incomeStatement(companyId, from, today);
  const elapsed = Number(today.slice(5, 7));
  const sales = ytd.totalIncomeCents;
  const variable = ytd.totalCostCents;
  const fixed = ytd.totalExpenseCents;
  const margin = sales > 0 ? (sales - variable) / sales : 0;
  const monthlyFixed = elapsed ? Math.round(fixed / elapsed) : 0;
  const point = margin > 0 ? Math.round(monthlyFixed / margin) : 0;
  const monthlySales = [];
  for (let m = 1; m <= elapsed; m += 1) {
    const key = `${today.slice(0, 4)}-${String(m).padStart(2, '0')}`;
    const endDay = new Date(Date.UTC(Number(today.slice(0, 4)), m, 0)).getUTCDate();
    const slice = await incomeStatement(companyId, `${key}-01`, m === elapsed ? today : `${key}-${String(endDay).padStart(2, '0')}`);
    monthlySales.push(slice.totalIncomeCents);
  }
  const recent = await db().all(
    `SELECT id, doc_type, doc_number, doc_date, party_name, total_cents, status
     FROM documents WHERE company_id = ? ORDER BY doc_date DESC, id DESC LIMIT 8`,
    [companyId]
  );
  return {
    today,
    kpis: {
      salesMonthCents: await salesBase(companyId, monthKey),
      arOpenCents: n(ar.s),
      apOpenCents: n(ap.s),
      resultMonthCents: income.profitCents,
      cashCents: cash,
    },
    salesComparison: { months: months.map((m) => ({ label: m.label, month: m.month })), series },
    aging: { buckets: aging.buckets.map(({ items, ...rest }) => rest), totalCents: aging.totalCents, overdueCents: aging.overdueCents },
    breakeven: { monthlySales, pointCents: point, monthlyFixedCents: monthlyFixed, margin, salesCents: sales, variableCents: variable, fixedCents: fixed },
    recent,
  };
}

async function totalsJoin(companyId, { from, to, until, excludeClose = false } = {}) {
  const params = [];
  let on = `e.id = l.entry_id AND e.status = 'CONTABILIZADO'`;
  if (excludeClose) on += ` AND e.source <> 'CIERRE'`;
  if (until) { on += ' AND e.doc_date <= ?'; params.push(until); }
  if (from && to) {
    return db().all(
      `SELECT a.id, a.code, a.name, a.type, a.nature, a.is_movement,
        COALESCE(SUM(CASE WHEN e.doc_date < ? THEN l.debit_cents ELSE 0 END),0) AS open_d,
        COALESCE(SUM(CASE WHEN e.doc_date < ? THEN l.credit_cents ELSE 0 END),0) AS open_c,
        COALESCE(SUM(CASE WHEN e.doc_date >= ? AND e.doc_date <= ? THEN l.debit_cents ELSE 0 END),0) AS per_d,
        COALESCE(SUM(CASE WHEN e.doc_date >= ? AND e.doc_date <= ? THEN l.credit_cents ELSE 0 END),0) AS per_c
       FROM accounts a
       LEFT JOIN journal_lines l ON l.account_id = a.id
       LEFT JOIN journal_entries e ON ${on}
       WHERE a.company_id = ?
       GROUP BY a.id, a.code, a.name, a.type, a.nature, a.is_movement
       ORDER BY a.code`,
      [from, from, from, to, from, to, ...params, companyId]
    );
  }
  const rows = await db().all(
    `SELECT a.id, a.code, a.name, a.type, a.nature, a.is_movement,
      COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.debit_cents ELSE 0 END),0) AS debit_cents,
      COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.credit_cents ELSE 0 END),0) AS credit_cents
     FROM accounts a
     LEFT JOIN journal_lines l ON l.account_id = a.id
     LEFT JOIN journal_entries e ON ${on}
     WHERE a.company_id = ?
     GROUP BY a.id, a.code, a.name, a.type, a.nature, a.is_movement
     ORDER BY a.code`,
    [...params, companyId]
  );
  return rows.map((row) => ({ ...row, debit_cents: n(row.debit_cents), credit_cents: n(row.credit_cents) }));
}

async function trialBalance(companyId, from, to, includeZero) {
  const rows = await totalsJoin(companyId, { from, to });
  const items = rows.filter((row) => row.is_movement).map((row) => {
    const open = splitDebitCredit(n(row.open_d) - n(row.open_c));
    const end = splitDebitCredit(n(row.open_d) + n(row.per_d) - n(row.open_c) - n(row.per_c));
    return {
      code: row.code, name: row.name, type: row.type,
      openDebit: open.debit, openCredit: open.credit,
      debit: n(row.per_d), credit: n(row.per_c),
      endDebit: end.debit, endCredit: end.credit,
    };
  }).filter((row) => includeZero || row.openDebit || row.openCredit || row.debit || row.credit || row.endDebit || row.endCredit);
  const sum = (key) => items.reduce((s, row) => s + row[key], 0);
  return {
    from, to, items,
    totals: {
      openDebit: sum('openDebit'), openCredit: sum('openCredit'),
      debit: sum('debit'), credit: sum('credit'),
      endDebit: sum('endDebit'), endCredit: sum('endCredit'),
    },
  };
}

async function balanceSheet(companyId, date) {
  const rows = await totalsJoin(companyId, { until: date });
  const assets = [];
  const liabilities = [];
  const equity = [];
  let result = 0;
  for (const row of rows) {
    if (!row.is_movement) continue;
    const debit = n(row.debit_cents);
    const credit = n(row.credit_cents);
    if (row.type === 'ACTIVO') {
      const amount = debit - credit;
      if (amount) assets.push({ code: row.code, name: row.name, amountCents: amount, current: !row.code.startsWith('1.2') });
    } else if (row.type === 'PASIVO') {
      const amount = credit - debit;
      if (amount) liabilities.push({ code: row.code, name: row.name, amountCents: amount, current: true });
    } else if (row.type === 'PATRIMONIO') {
      const amount = credit - debit;
      if (amount) equity.push({ code: row.code, name: row.name, amountCents: amount });
    } else if (['INGRESO', 'GASTO', 'COSTO'].includes(row.type)) {
      result += credit - debit;
    }
  }
  if (result) equity.push({ code: '', name: 'Resultado del ejercicio', amountCents: result, synthetic: true });
  const totalAssets = assets.reduce((s, r) => s + r.amountCents, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.amountCents, 0);
  const totalEquity = equity.reduce((s, r) => s + r.amountCents, 0);
  return {
    date,
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
    difference: totalAssets - totalLiabilities - totalEquity,
    balanced: totalAssets - totalLiabilities - totalEquity === 0,
  };
}

async function incomeStatement(companyId, from, to) {
  const rows = await totalsJoin(companyId, { from, to, excludeClose: true });
  const income = [];
  const costs = [];
  const expenses = [];
  for (const row of rows) {
    if (!row.is_movement) continue;
    const debit = n(row.per_d);
    const credit = n(row.per_c);
    if (!debit && !credit) continue;
    if (row.type === 'INGRESO') income.push({ code: row.code, name: row.name, amountCents: credit - debit, nature: row.nature });
    if (row.type === 'COSTO') costs.push({ code: row.code, name: row.name, amountCents: debit - credit });
    if (row.type === 'GASTO') expenses.push({ code: row.code, name: row.name, amountCents: debit - credit });
  }
  const totalIncomeCents = income.reduce((s, r) => s + r.amountCents, 0);
  const totalCostCents = costs.reduce((s, r) => s + r.amountCents, 0);
  const totalExpenseCents = expenses.reduce((s, r) => s + r.amountCents, 0);
  return {
    from, to, income, costs, expenses, totalIncomeCents, totalCostCents, totalExpenseCents,
    profitCents: totalIncomeCents - totalCostCents - totalExpenseCents,
  };
}

async function ledger(companyId, accountId, from, to) {
  const account = await db().get('SELECT * FROM accounts WHERE id = ? AND company_id = ?', [accountId, companyId]);
  if (!account) throw new AppError('Cuenta no encontrada.', 404);
  const opening = await db().get(
    `SELECT COALESCE(SUM(l.debit_cents),0) AS d, COALESCE(SUM(l.credit_cents),0) AS c
     FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
     WHERE l.account_id = ? AND e.status = 'CONTABILIZADO' AND e.doc_date < ?`,
    [accountId, from]
  );
  const moves = await db().all(
    `SELECT e.doc_date, e.doc_number, e.description, l.debit_cents, l.credit_cents
     FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
     WHERE l.account_id = ? AND e.status = 'CONTABILIZADO' AND e.doc_date >= ? AND e.doc_date <= ?
     ORDER BY e.doc_date, e.id, l.id`,
    [accountId, from, to]
  );
  let running = n(opening.d) - n(opening.c);
  const items = moves.map((move) => {
    running += n(move.debit_cents) - n(move.credit_cents);
    return { ...move, debit_cents: n(move.debit_cents), credit_cents: n(move.credit_cents), balanceCents: running };
  });
  return { account, openingCents: n(opening.d) - n(opening.c), items, endingCents: running };
}

async function journalList(companyId, from, to) {
  const entries = await db().all(
    `SELECT * FROM journal_entries WHERE company_id = ? AND doc_date >= ? AND doc_date <= ? ORDER BY doc_date, id`,
    [companyId, from, to]
  );
  for (const entry of entries) {
    entry.lines = await db().all(
      `SELECT l.*, a.code, a.name FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ? ORDER BY l.id`,
      [entry.id]
    );
    entry.debit_cents = entry.lines.reduce((s, l) => s + n(l.debit_cents), 0);
    entry.credit_cents = entry.lines.reduce((s, l) => s + n(l.credit_cents), 0);
  }
  return entries;
}

async function unbalanced(companyId) {
  return db().all(
    `SELECT e.id, e.doc_number, e.doc_date, e.description, e.source,
       SUM(l.debit_cents) AS debit_cents, SUM(l.credit_cents) AS credit_cents
     FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
     WHERE e.company_id = ? AND e.status = 'CONTABILIZADO'
     GROUP BY e.id, e.doc_number, e.doc_date, e.description, e.source
     HAVING SUM(l.debit_cents) <> SUM(l.credit_cents)
     ORDER BY e.doc_date`,
    [companyId]
  );
}

async function equation(companyId, date) {
  const rows = await db().all(
    `SELECT a.type AS type, COALESCE(SUM(l.debit_cents),0) AS debit, COALESCE(SUM(l.credit_cents),0) AS credit
     FROM journal_lines l
     JOIN journal_entries e ON e.id = l.entry_id
     JOIN accounts a ON a.id = l.account_id
     WHERE e.company_id = ? AND e.status = 'CONTABILIZADO' AND e.doc_date <= ?
     GROUP BY a.type`,
    [companyId, date]
  );
  const byType = {};
  for (const row of rows) byType[row.type] = { debit: n(row.debit), credit: n(row.credit) };
  return accountingEquation(byType);
}

async function historicalBalance(companyId, side, cutoff) {
  const rows = await db().all(
    `SELECT oi.*, p.name AS party_name, p.identification,
       oi.original_cents - COALESCE((
         SELECT SUM(sl.amount_cents) FROM settlement_lines sl
         JOIN settlements s ON s.id = sl.settlement_id
         WHERE sl.target_item_id = oi.id AND s.doc_date <= ? AND s.status = 'CONTABILIZADO'
       ), 0) AS balance_at
     FROM open_items oi
     JOIN parties p ON p.id = oi.party_id
     WHERE oi.company_id = ? AND oi.side = ? AND oi.kind = 'FACTURA' AND oi.doc_date <= ? AND oi.status <> 'ANULADO'`,
    [cutoff, companyId, side, cutoff]
  );
  return rows.map((row) => ({ ...row, balance_at: n(row.balance_at), balance_cents: n(row.balance_cents), original_cents: n(row.original_cents) }))
    .filter((row) => row.balance_at > 0);
}

async function agingReport(companyId, side, cutoff) {
  const items = await historicalBalance(companyId, side, cutoff);
  return buildAging(items.map((row) => ({
    id: row.id,
    partyId: row.party_id,
    partyName: row.party_name,
    identification: row.identification,
    docNumber: row.doc_number,
    docDate: row.doc_date,
    dueDate: row.due_date || row.doc_date,
    balanceCents: row.balance_at,
  })), cutoff);
}

async function debtReport(companyId, side, cutoff) {
  const items = await historicalBalance(companyId, side, cutoff);
  const byParty = new Map();
  for (const item of items) {
    const cur = byParty.get(item.party_id) || { partyId: item.party_id, name: item.party_name, identification: item.identification, balanceCents: 0, documents: [] };
    cur.balanceCents += item.balance_at;
    cur.documents.push({ number: item.doc_number, date: item.doc_date, due: item.due_date, balanceCents: item.balance_at });
    byParty.set(item.party_id, cur);
  }
  const parties = [...byParty.values()].sort((a, b) => b.balanceCents - a.balanceCents);
  return { cutoff, side, parties, totalCents: parties.reduce((s, p) => s + p.balanceCents, 0) };
}

async function statement(companyId, side, partyId, from, to) {
  const party = await db().get('SELECT * FROM parties WHERE id = ? AND company_id = ?', [partyId, companyId]);
  if (!party) throw new AppError('Persona no encontrada.', 404);
  const charges = await db().all(
    `SELECT doc_date, doc_number, description, original_cents AS debit_cents, 0 AS credit_cents
     FROM open_items WHERE company_id = ? AND party_id = ? AND side = ? AND kind = 'FACTURA' AND status <> 'ANULADO'
       AND doc_date >= ? AND doc_date <= ?`,
    [companyId, partyId, side, from, to]
  );
  const credits = await db().all(
    `SELECT s.doc_date, s.doc_number, s.kind AS description, 0 AS debit_cents, sl.amount_cents AS credit_cents
     FROM settlement_lines sl
     JOIN settlements s ON s.id = sl.settlement_id
     JOIN open_items oi ON oi.id = sl.target_item_id
     WHERE oi.party_id = ? AND oi.side = ? AND s.status = 'CONTABILIZADO' AND s.doc_date >= ? AND s.doc_date <= ?`,
    [partyId, side, from, to]
  );
  const advances = await db().all(
    `SELECT doc_date, doc_number, description, original_cents AS debit_cents, 0 AS credit_cents
     FROM open_items WHERE company_id = ? AND party_id = ? AND side = ? AND kind = 'ANTICIPO' AND doc_date >= ? AND doc_date <= ?`,
    [companyId, partyId, side, from, to]
  );
  const prior = await db().get(
    `SELECT
       COALESCE((SELECT SUM(original_cents) FROM open_items WHERE company_id = ? AND party_id = ? AND side = ? AND kind = 'FACTURA' AND status <> 'ANULADO' AND doc_date < ?),0)
       - COALESCE((SELECT SUM(sl.amount_cents) FROM settlement_lines sl JOIN settlements s ON s.id = sl.settlement_id JOIN open_items oi ON oi.id = sl.target_item_id
           WHERE oi.party_id = ? AND oi.side = ? AND s.status = 'CONTABILIZADO' AND s.doc_date < ?),0) AS balance`,
    [companyId, partyId, side, from, partyId, side, from]
  );
  const items = [...charges, ...credits, ...advances].sort((a, b) => String(a.doc_date).localeCompare(b.doc_date));
  let running = n(prior.balance);
  for (const item of items) {
    running += n(item.debit_cents) - n(item.credit_cents);
    item.balanceCents = running;
    item.debit_cents = n(item.debit_cents);
    item.credit_cents = n(item.credit_cents);
  }
  return { party, from, to, openingCents: n(prior.balance), items, endingCents: running };
}

async function crosscheck(companyId, date) {
  const ctx = await loadCtx(companyId);
  async function sub(side, kind) {
    const row = await db().get(
      `SELECT COALESCE(SUM(balance_cents),0) AS s FROM open_items WHERE company_id = ? AND side = ? AND kind = ? AND status = 'ABIERTO'`,
      [companyId, side, kind]
    );
    return n(row.s);
  }
  const clientesGl = await glBalance(companyId, ctx.settings.cuenta_clientes, date);
  const proveedoresGl = -(await glBalance(companyId, ctx.settings.cuenta_proveedores, date));
  const antCliGl = -(await glBalance(companyId, ctx.settings.cuenta_anticipo_clientes, date));
  const antProvGl = await glBalance(companyId, ctx.settings.cuenta_anticipo_proveedores, date);
  const inventarioGl = await glBalance(companyId, ctx.settings.cuenta_inventario, date);
  const stock = await db().get('SELECT COALESCE(SUM(stock_value_cents),0) AS s FROM products WHERE company_id = ?', [companyId]);
  const banks = await db().all('SELECT * FROM bank_accounts WHERE company_id = ? AND active = 1', [companyId]);
  let bankBooks = 0;
  for (const bank of banks) {
    const pos = await bankPosition(companyId, bank.id);
    if (ctx.byId.get(Number(bank.ledger_account_id))?.code === ctx.settings.cuenta_bancos) bankBooks += pos.bookCents;
  }
  const bancosGl = await glBalance(companyId, ctx.settings.cuenta_bancos, date);
  const pairs = [
    ['Clientes', clientesGl, await sub('AR', 'FACTURA')],
    ['Proveedores', proveedoresGl, await sub('AP', 'FACTURA')],
    ['Anticipo de clientes', antCliGl, await sub('AR', 'ANTICIPO')],
    ['Anticipo a proveedores', antProvGl, await sub('AP', 'ANTICIPO')],
    ['Inventario', inventarioGl, n(stock.s)],
    ['Bancos', bancosGl, bankBooks],
  ];
  const zero = (value) => (Number(value) === 0 ? 0 : Number(value));
  return {
    date,
    items: pairs.map(([name, ledgerCents, subledgerCents]) => ({
      name,
      ledgerCents: zero(ledgerCents),
      subledgerCents: zero(subledgerCents),
      differenceCents: zero(ledgerCents - subledgerCents),
    })),
  };
}

async function form104(companyId, year, month) {
  const { from, to } = monthRange(Number(year), Number(month));
  const docs = await db().all(
    `SELECT * FROM documents WHERE company_id = ? AND status = 'EMITIDO' AND doc_date >= ? AND doc_date <= ?`,
    [companyId, from, to]
  );
  const sum = (types, field) => docs.filter((d) => types.includes(d.doc_type)).reduce((s, d) => s + (d.doc_type === 'NCV' || d.doc_type === 'NCC' ? -n(d[field]) : n(d[field])), 0);
  const sales15 = sum(['FV', 'NV', 'NDV', 'NCV'], 'base15_cents');
  const sales0 = sum(['FV', 'NV', 'NDV', 'NCV'], 'base0_cents');
  const ivaSales = sum(['FV', 'NV', 'NDV', 'NCV'], 'iva_cents');
  const purchases15 = sum(['FC', 'LIQ', 'NDC', 'NCC'], 'base15_cents');
  const purchases0 = sum(['FC', 'LIQ', 'NDC', 'NCC'], 'base0_cents');
  const ivaPurchases = sum(['FC', 'LIQ', 'NDC', 'NCC'], 'iva_cents');
  const retSuffered = docs.filter((d) => ['FV', 'NV', 'NDV'].includes(d.doc_type)).reduce((s, d) => s + n(d.ret_iva_cents), 0)
    - docs.filter((d) => d.doc_type === 'NCV').reduce((s, d) => s + n(d.ret_iva_cents), 0);
  const tax = ivaSales - ivaPurchases - retSuffered;
  return {
    year: Number(year), month: Number(month), from, to,
    sales15, sales0, ivaSales, purchases15, purchases0, ivaPurchases, retSuffered,
    taxCents: tax, creditCents: tax < 0 ? -tax : 0, payableCents: tax > 0 ? tax : 0,
    note: 'Resumen de apoyo para el formulario 104. No reemplaza la declaración oficial en el SRI.',
  };
}

async function form103(companyId, year, month) {
  const { from, to } = monthRange(Number(year), Number(month));
  const rows = await db().all(
    `SELECT r.code, r.tax, r.rate, SUM(r.base_cents) AS base_cents, SUM(r.amount_cents) AS amount_cents
     FROM retention_lines r
     JOIN documents d ON d.id = r.document_id
     WHERE d.company_id = ? AND d.doc_type = 'RET' AND d.status = 'EMITIDO' AND d.doc_date >= ? AND d.doc_date <= ?
     GROUP BY r.code, r.tax, r.rate
     ORDER BY r.code`,
    [companyId, from, to]
  );
  const names = Object.fromEntries(RETENTION_CODES.map((c) => [c.code, c.name]));
  const items = rows.map((row) => ({ ...row, name: names[row.code] || row.code, base_cents: n(row.base_cents), amount_cents: n(row.amount_cents) }));
  return {
    year: Number(year), month: Number(month),
    items,
    totalCents: items.reduce((s, r) => s + r.amount_cents, 0),
    note: 'Resumen de apoyo para el formulario 103, según las retenciones emitidas.',
  };
}

async function atsData(companyId, year, month) {
  const ctx = await loadCtx(companyId);
  const { from, to } = monthRange(Number(year), Number(month));
  const sales = await db().all(
    `SELECT d.*, p.id_type, p.identification, p.related_party
     FROM documents d JOIN parties p ON p.id = d.party_id
     WHERE d.company_id = ? AND d.status = 'EMITIDO' AND d.doc_date >= ? AND d.doc_date <= ?
       AND d.doc_type IN ('FV','NV','NDV','NCV')`,
    [companyId, from, to]
  );
  const purchases = await db().all(
    `SELECT d.*, p.id_type, p.identification, p.related_party
     FROM documents d JOIN parties p ON p.id = d.party_id
     WHERE d.company_id = ? AND d.status = 'EMITIDO' AND d.doc_date >= ? AND d.doc_date <= ?
       AND d.doc_type IN ('FC','LIQ','NCC','NDC')`,
    [companyId, from, to]
  );
  const mappedSales = sales.map((d) => ({
    docType: d.doc_type, idType: d.id_type, identification: d.identification, parteRel: d.related_party ? 'SI' : 'NO',
    base15: d.base15_cents, base0: d.base0_cents, iva: d.iva_cents, ice: d.ice_cents,
    sriPayCode: d.sri_pay_code, establecimiento: d.establecimiento,
  }));
  const mappedPurchases = [];
  for (const d of purchases) {
    const rets = await db().all(
      `SELECT r.* FROM retention_lines r JOIN documents rd ON rd.id = r.document_id
       WHERE rd.related_document_id = ? AND rd.doc_type = 'RET' AND rd.status = 'EMITIDO'`,
      [d.id]
    );
    mappedPurchases.push({
      docType: d.doc_type, idType: d.id_type, identification: d.identification, parteRel: !!d.related_party,
      date: d.doc_date, docNumber: d.doc_number, sustento: d.sustento, sriPayCode: d.sri_pay_code,
      base15: d.base15_cents, base0: d.base0_cents, iva: d.iva_cents, ice: d.ice_cents,
      retenciones: rets.map((r) => ({ tax: r.tax, code: r.code, baseCents: r.base_cents, rate: r.rate, amountCents: r.amount_cents })),
    });
  }
  return { company: ctx.company, year, month, purchases: mappedPurchases, sales: mappedSales };
}

async function atsXml(companyId, year, month) {
  const data = await atsData(companyId, year, month);
  return buildAtsXml(data);
}

async function stockReport(companyId) {
  return db().all(
    `SELECT id, code, name, unit, stock_qty, avg_cost_cents, stock_value_cents, iva_rate, ice_rate, inventoriable
     FROM products WHERE company_id = ? AND active = 1 ORDER BY code`,
    [companyId]
  );
}

async function kardex(companyId, productId, from, to) {
  const product = await db().get('SELECT * FROM products WHERE id = ? AND company_id = ?', [productId, companyId]);
  if (!product) throw new AppError('Producto no encontrado.', 404);
  const items = await db().all(
    `SELECT * FROM inventory_moves WHERE company_id = ? AND product_id = ? AND doc_date >= ? AND doc_date <= ? ORDER BY doc_date, id`,
    [companyId, productId, from, to]
  );
  return { product, items };
}

async function movementReport(companyId, kind, from, to) {
  const types = kind === 'compras' ? ['FC', 'LIQ', 'NCC', 'NDC'] : ['FV', 'NV', 'NCV', 'NDV'];
  return db().all(
    `SELECT d.doc_date, d.doc_number, d.doc_type, d.party_name, l.description, l.qty, l.unit_price_cents, l.base_cents, l.iva_cents, l.total_cents
     FROM document_lines l JOIN documents d ON d.id = l.document_id
     WHERE d.company_id = ? AND d.status = 'EMITIDO' AND d.doc_date >= ? AND d.doc_date <= ?
       AND d.doc_type IN (${types.map(() => '?').join(',')})
     ORDER BY d.doc_date, d.id`,
    [companyId, from, to, ...types]
  );
}

async function einvoiceQueue(companyId) {
  const items = await db().all(
    `SELECT id, doc_type, doc_number, doc_date, party_name, party_ident, total_cents, sri_status
     FROM documents
     WHERE company_id = ? AND status = 'EMITIDO' AND sri_status = 'PENDIENTE'
     ORDER BY doc_date DESC, id DESC`,
    [companyId]
  );
  return {
    phase: 2,
    ready: false,
    message: 'La firma XAdES-BES y el envío al SRI quedan preparados para una fase 2. Este prototipo no firma ni transmite comprobantes.',
    items: items.map((item) => ({ ...item, docLabel: DOC_TYPES[item.doc_type]?.label || item.doc_type })),
  };
}

module.exports = {
  dashboard, trialBalance, balanceSheet, incomeStatement, ledger, journalList, unbalanced, equation,
  agingReport, debtReport, statement, crosscheck, form104, form103, atsXml, atsData,
  stockReport, kardex, movementReport, einvoiceQueue, glBalance, naturalBalance,
};
