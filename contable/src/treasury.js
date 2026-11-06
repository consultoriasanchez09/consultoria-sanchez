const { insert } = require('./db');
const { AppError } = require('./errors');
const { parseMoney } = require('./money');
const { applySequential } = require('./accounting');
const { db, isoNow, assertDate, loadCtx, assertPeriodOpen, nextNumber, insertJournal } = require('./ctx');
const { getParty, getBank } = require('./posting');

function moneyOf(input, centsKey, plainKey) {
  if (input[centsKey] != null && input[centsKey] !== '') return Math.round(Number(input[centsKey]));
  return parseMoney(input[plainKey] ?? input.amount ?? 0);
}

async function openInvoices(companyId, side, partyId, cutoff, kind = 'FACTURA') {
  const params = [companyId, side, kind];
  let sql = `SELECT * FROM open_items WHERE company_id = ? AND side = ? AND kind = ? AND status = 'ABIERTO' AND balance_cents > 0`;
  if (partyId) { sql += ' AND party_id = ?'; params.push(partyId); }
  if (cutoff) { sql += ' AND doc_date <= ?'; params.push(cutoff); }
  sql += ' ORDER BY due_date, doc_date, id';
  return db().all(sql, params);
}

async function proposeApplication({ companyId, side, partyId, amountCents, cutoff }) {
  const items = await openInvoices(companyId, side, partyId, cutoff);
  return applySequential(items.map(toItem), amountCents);
}

function toItem(row) {
  return {
    id: row.id,
    balanceCents: row.balance_cents,
    dueDate: row.due_date,
    docDate: row.doc_date,
    docNumber: row.doc_number,
    partyId: row.party_id,
  };
}

async function postSettlement(input) {
  return db().tx(async () => {
    const ctx = await loadCtx(input.companyId);
    const date = assertDate(input.date);
    await assertPeriodOpen(input.companyId, date);
    const side = input.side === 'AP' ? 'AP' : 'AR';
    const kind = input.kind;
    const amount = moneyOf(input, 'amountCents', 'amount');
    if (!(amount > 0) && kind !== 'CRUCE') throw new AppError('Indique un valor mayor a cero.');
    const bank = await getBank(input.companyId, input.bankAccountId);
    const method = input.method || (bank ? 'TRANSFERENCIA' : 'EFECTIVO');
    const cashAccount = method === 'EFECTIVO' ? 'caja' : (bank ? bank.ledger_code : 'bancos');
    if (kind !== 'CRUCE' && method !== 'EFECTIVO' && !bank) throw new AppError('Seleccione la cuenta bancaria.');

    if (kind === 'ANTICIPO') {
      const party = await getParty(input.companyId, input.partyId);
      const expected = side === 'AR' ? 'CLIENTE' : 'PROVEEDOR';
      if (!party || party.kind !== expected) throw new AppError('Seleccione la persona del anticipo.');
      const lines = side === 'AR'
        ? [{ account: cashAccount, debitCents: amount, creditCents: 0 }, { account: 'anticipoClientes', debitCents: 0, creditCents: amount, partyId: party.id }]
        : [{ account: 'anticipoProveedores', debitCents: amount, creditCents: 0, partyId: party.id }, { account: cashAccount, debitCents: 0, creditCents: amount }];
      const number = await nextNumber(input.companyId, side === 'AR' ? 'ANTC' : 'ANTP');
      const entry = await insertJournal(ctx, { date, description: `Anticipo ${number} · ${party.name}`, source: 'ANTICIPO', userId: input.userId, lines });
      const item = await insert('open_items', {
        company_id: input.companyId, side, kind: 'ANTICIPO', party_id: party.id, document_id: null,
        doc_date: date, due_date: date, doc_number: number, description: 'Anticipo',
        original_cents: amount, balance_cents: amount, status: 'ABIERTO',
      });
      const settlement = await insert('settlements', {
        company_id: input.companyId, side, kind, doc_number: number, doc_date: date, party_id: party.id,
        method, bank_account_id: bank ? bank.id : null, total_cents: amount, unapplied_cents: amount,
        advance_item_id: item.lastId, journal_entry_id: entry.id, notes: input.notes || null,
        status: 'CONTABILIZADO', created_by: input.userId || null, created_at: isoNow(),
      });
      await addBankMovement({ input, bank, date, number, amount, inbound: side === 'AR', description: `Anticipo ${number}`, sourceId: settlement.lastId });
      return { id: settlement.lastId, number, totalCents: amount };
    }

    if (kind === 'CRUCE') {
      const party = await getParty(input.companyId, input.partyId);
      const advance = await db().get(
        `SELECT * FROM open_items WHERE id = ? AND company_id = ? AND kind = 'ANTICIPO' AND side = ? AND status = 'ABIERTO'`,
        [input.advanceItemId, input.companyId, side]
      );
      if (!advance) throw new AppError('El anticipo no tiene saldo.');
      const applications = await resolveApplications(input, side, party.id, advance.balance_cents);
      const applied = applications.reduce((s, a) => s + a.amountCents, 0);
      if (applied <= 0) throw new AppError('No hay saldo para cruzar.');
      if (applied > advance.balance_cents) throw new AppError('El cruce supera el anticipo disponible.');
      const lines = side === 'AR'
        ? [{ account: 'anticipoClientes', debitCents: applied, creditCents: 0, partyId: party.id }, { account: 'clientes', debitCents: 0, creditCents: applied, partyId: party.id }]
        : [{ account: 'proveedores', debitCents: applied, creditCents: 0, partyId: party.id }, { account: 'anticipoProveedores', debitCents: 0, creditCents: applied, partyId: party.id }];
      const number = await nextNumber(input.companyId, 'CRUCE');
      const entry = await insertJournal(ctx, { date, description: `Cruce de anticipo ${number} · ${party.name}`, source: 'CRUCE', userId: input.userId, lines });
      const settlement = await saveApplications({ input, side, kind, number, date, partyId: party.id, method: 'CRUCE', bank, total: applied, unapplied: 0, entryId: entry.id, applications, advanceId: advance.id });
      await reduceAdvance(advance, applied);
      return { id: settlement, number, totalCents: applied };
    }

    if (!['COBRO', 'PAGO', 'VARIOS'].includes(kind)) throw new AppError('Tipo de cobro o pago no reconocido.');
    const party = kind === 'VARIOS' ? null : await getParty(input.companyId, input.partyId);
    if (kind !== 'VARIOS') {
      const expected = side === 'AR' ? 'CLIENTE' : 'PROVEEDOR';
      if (!party || party.kind !== expected) throw new AppError('Seleccione la persona.');
    }
    const applications = await resolveApplications(input, side, party ? party.id : null, amount);
    const applied = applications.reduce((s, a) => s + a.amountCents, 0);
    const unapplied = amount - applied;
    if (unapplied < 0) throw new AppError('La aplicación supera el valor recibido.');
    if (unapplied > 0 && !input.asAdvance) throw new AppError('Queda un sobrante. Regístrelo como anticipo o reduzca el valor.');
    if (unapplied > 0 && kind === 'VARIOS') throw new AppError('El cobro o pago a varios no admite sobrante.');
    const lines = [];
    if (side === 'AR') {
      lines.push({ account: cashAccount, debitCents: amount, creditCents: 0, partyId: party?.id });
      if (applied) lines.push({ account: 'clientes', debitCents: 0, creditCents: applied, partyId: party?.id });
      if (unapplied) lines.push({ account: 'anticipoClientes', debitCents: 0, creditCents: unapplied, partyId: party?.id });
    } else {
      if (applied) lines.push({ account: 'proveedores', debitCents: applied, creditCents: 0, partyId: party?.id });
      if (unapplied) lines.push({ account: 'anticipoProveedores', debitCents: unapplied, creditCents: 0, partyId: party?.id });
      lines.push({ account: cashAccount, debitCents: 0, creditCents: amount, partyId: party?.id });
    }
    const number = await nextNumber(input.companyId, kind === 'VARIOS' ? (side === 'AR' ? 'COBV' : 'PAGV') : (side === 'AR' ? 'COB' : 'PAG'));
    const entry = await insertJournal(ctx, {
      date,
      description: `${side === 'AR' ? 'Cobro' : 'Pago'} ${number}${party ? ' · ' + party.name : ' a varios'}`,
      source: kind,
      userId: input.userId,
      lines,
    });
    let advanceId = null;
    if (unapplied > 0) {
      const advNumber = await nextNumber(input.companyId, side === 'AR' ? 'ANTC' : 'ANTP');
      const adv = await insert('open_items', {
        company_id: input.companyId, side, kind: 'ANTICIPO', party_id: party.id, document_id: null,
        doc_date: date, due_date: date, doc_number: advNumber, description: `Sobrante de ${number}`,
        original_cents: unapplied, balance_cents: unapplied, status: 'ABIERTO',
      });
      advanceId = adv.lastId;
    }
    const settlement = await saveApplications({
      input, side, kind, number, date, partyId: party?.id || null, method, bank, total: amount, unapplied, entryId: entry.id, applications, advanceId,
    });
    await addBankMovement({ input, bank, date, number, amount, inbound: side === 'AR', description: `${side === 'AR' ? 'Cobro' : 'Pago'} ${number}`, sourceId: settlement });
    return { id: settlement, number, totalCents: amount, appliedCents: applied, unappliedCents: unapplied };
  });
}

async function resolveApplications(input, side, partyId, cap) {
  let applications = input.applications;
  if ((!applications || !applications.length) && input.sequential) {
    const proposed = await proposeApplication({ companyId: input.companyId, side, partyId, amountCents: cap });
    applications = proposed.applications;
  }
  if (!applications || !applications.length) throw new AppError('Seleccione los documentos a aplicar.');
  const clean = [];
  for (const raw of applications) {
    const amount = raw.amountCents != null ? Math.round(Number(raw.amountCents)) : parseMoney(raw.amount);
    if (!(amount > 0)) continue;
    const item = await db().get('SELECT * FROM open_items WHERE id = ? AND company_id = ?', [raw.openItemId || raw.id, input.companyId]);
    if (!item || item.side !== side || item.kind !== 'FACTURA' || item.status !== 'ABIERTO') throw new AppError('Hay un documento que ya no está pendiente.');
    if (partyId && item.party_id !== partyId) throw new AppError('El documento no corresponde a la persona seleccionada.');
    if (amount > item.balance_cents) throw new AppError(`El valor supera el saldo de ${item.doc_number}.`);
    clean.push({ openItemId: item.id, amountCents: amount, partyId: item.party_id });
  }
  if (!clean.length) throw new AppError('No hay valores para aplicar.');
  return clean;
}

async function saveApplications({ input, side, kind, number, date, partyId, method, bank, total, unapplied, entryId, applications, advanceId }) {
  const settlement = await insert('settlements', {
    company_id: input.companyId, side, kind, doc_number: number, doc_date: date, party_id: partyId,
    method, bank_account_id: bank ? bank.id : null, total_cents: total, unapplied_cents: unapplied || 0,
    advance_item_id: advanceId || null, journal_entry_id: entryId, notes: input.notes || null,
    status: 'CONTABILIZADO', created_by: input.userId || null, created_at: isoNow(),
  });
  for (const app of applications) {
    await insert('settlement_lines', { settlement_id: settlement.lastId, target_item_id: app.openItemId, amount_cents: app.amountCents });
    const item = await db().get('SELECT balance_cents FROM open_items WHERE id = ?', [app.openItemId]);
    const balance = item.balance_cents - app.amountCents;
    await db().run('UPDATE open_items SET balance_cents = ?, status = ? WHERE id = ?', [balance, balance === 0 ? 'CERRADO' : 'ABIERTO', app.openItemId]);
  }
  return settlement.lastId;
}

async function reduceAdvance(advance, amount) {
  const balance = advance.balance_cents - amount;
  await db().run('UPDATE open_items SET balance_cents = ?, status = ? WHERE id = ?', [balance, balance === 0 ? 'CERRADO' : 'ABIERTO', advance.id]);
}

async function addBankMovement({ input, bank, date, number, amount, inbound, description, sourceId, pending = false }) {
  if (!bank || methodIsCash(input.method)) return;
  if (!amount) return;
  await insert('bank_movements', {
    company_id: input.companyId,
    bank_account_id: bank.id,
    doc_date: date,
    kind: input.method === 'CHEQUE' ? 'CHEQUE' : 'TRANSFERENCIA',
    doc_number: number,
    description,
    debit_cents: inbound && !pending ? amount : 0,
    credit_cents: !inbound || pending ? amount : 0,
    status: pending ? 'PENDIENTE' : 'CONTABILIZADO',
    reconciled: 0,
    postdated: pending ? 1 : 0,
    posts_journal: 0,
    source: 'SETTLEMENT',
    source_id: sourceId,
    created_at: isoNow(),
  });
}

function methodIsCash(method) {
  return !method || method === 'EFECTIVO' || method === 'CRUCE';
}

async function postBankAccount(input) {
  if (!String(input.name || '').trim()) throw new AppError('Indique el nombre de la cuenta bancaria.');
  const ctx = await loadCtx(input.companyId);
  const ledger = ctx.byCode.get(input.ledgerCode || input.ledger_code || ctx.settings.cuenta_bancos);
  if (!ledger) throw new AppError('Seleccione la cuenta contable del banco.');
  const row = await insert('bank_accounts', {
    company_id: input.companyId,
    name: String(input.name || '').trim(),
    bank_name: input.bankName || input.bank_name || '',
    account_number: input.accountNumber || input.account_number || '',
    ledger_account_id: ledger.id,
    opening_balance_cents: input.openingCents != null ? Math.round(Number(input.openingCents)) : parseMoney(input.opening || 0),
    opening_date: input.openingDate || input.opening_date || null,
    active: 1,
  });
  return db().get('SELECT * FROM bank_accounts WHERE id = ?', [row.lastId]);
}

async function postBankMovement(input) {
  return db().tx(async () => {
    const ctx = await loadCtx(input.companyId);
    const date = assertDate(input.date);
    await assertPeriodOpen(input.companyId, date);
    const bank = await getBank(input.companyId, input.bankAccountId);
    if (!bank) throw new AppError('Seleccione la cuenta bancaria.');
    const amount = moneyOf(input, 'amountCents', 'amount');
    if (!(amount > 0)) throw new AppError('Indique un valor mayor a cero.');
    const kind = input.kind;
    const number = await nextNumber(input.companyId, kind === 'TRANSFERENCIA' ? 'TRA' : kind === 'CHEQUE' ? 'CHQ' : kind);
    let lines = [];
    let debit = 0;
    let credit = 0;
    let pending = false;
    if (kind === 'DEPOSITO') {
      lines = [{ account: bank.ledger_code, debitCents: amount, creditCents: 0 }, { account: 'caja', debitCents: 0, creditCents: amount }];
      debit = amount;
    } else if (kind === 'RETIRO') {
      lines = [{ account: 'caja', debitCents: amount, creditCents: 0 }, { account: bank.ledger_code, debitCents: 0, creditCents: amount }];
      credit = amount;
    } else if (kind === 'ND') {
      lines = [{ account: 'gastoBancario', debitCents: amount, creditCents: 0 }, { account: bank.ledger_code, debitCents: 0, creditCents: amount }];
      credit = amount;
    } else if (kind === 'NC') {
      lines = [{ account: bank.ledger_code, debitCents: amount, creditCents: 0 }, { account: 'otrosIngresos', debitCents: 0, creditCents: amount }];
      debit = amount;
    } else if (kind === 'CHEQUE') {
      const counter = input.accountCode || 'gastoCompras';
      pending = !!input.postdated;
      if (pending) lines = [{ account: counter, debitCents: amount, creditCents: 0 }, { account: 'chequesPosfechados', debitCents: 0, creditCents: amount }];
      else lines = [{ account: counter, debitCents: amount, creditCents: 0 }, { account: bank.ledger_code, debitCents: 0, creditCents: amount }];
      credit = amount;
    } else if (kind === 'TRANSFERENCIA') {
      const other = await getBank(input.companyId, input.counterpartBankId);
      if (!other) throw new AppError('Seleccione la cuenta de destino.');
      if (other.id === bank.id) throw new AppError('La cuenta de destino debe ser distinta.');
      lines = [{ account: other.ledger_code, debitCents: amount, creditCents: 0 }, { account: bank.ledger_code, debitCents: 0, creditCents: amount }];
      credit = amount;
      const entry = await insertJournal(ctx, { date, description: input.description || `Transferencia ${number}`, source: 'BANCO', userId: input.userId, lines });
      const out = await insert('bank_movements', movementRow(input, bank.id, date, kind, number, 0, amount, 'CONTABILIZADO', entry?.id));
      await insert('bank_movements', {
        ...movementRow(input, other.id, date, kind, number, amount, 0, 'CONTABILIZADO', entry?.id),
        counterpart_bank_id: bank.id,
      });
      return { id: out.lastId, number };
    } else throw new AppError('Tipo de movimiento bancario no reconocido.');

    const entry = await insertJournal(ctx, { date, description: input.description || `${kind} ${number}`, source: 'BANCO', userId: input.userId, lines });
    const row = await insert('bank_movements', movementRow(input, bank.id, date, kind, number, debit, pending ? 0 : credit, pending ? 'PENDIENTE' : 'CONTABILIZADO', entry?.id, pending));
    if (pending) {
      await db().run('UPDATE bank_movements SET credit_cents = ?, postdated = 1, status = ? WHERE id = ?', [amount, 'PENDIENTE', row.lastId]);
    }
    return { id: row.lastId, number };
  });
}

function movementRow(input, bankId, date, kind, number, debit, credit, status, entryId, pending = false) {
  return {
    company_id: input.companyId,
    bank_account_id: bankId,
    doc_date: date,
    kind,
    doc_number: input.reference || number,
    description: input.description || kind,
    debit_cents: debit,
    credit_cents: credit,
    status,
    reconciled: 0,
    postdated: pending ? 1 : 0,
    posts_journal: 1,
    journal_entry_id: entryId || null,
    source: 'BANCO',
    source_id: null,
    created_at: isoNow(),
  };
}

async function clearPostdated({ companyId, userId, movementId, date }) {
  return db().tx(async () => {
    const ctx = await loadCtx(companyId);
    const move = await db().get('SELECT * FROM bank_movements WHERE id = ? AND company_id = ?', [movementId, companyId]);
    if (!move || move.status !== 'PENDIENTE') throw new AppError('El cheque posfechado no está pendiente.');
    const bank = await getBank(companyId, move.bank_account_id);
    const when = assertDate(date || move.doc_date);
    await assertPeriodOpen(companyId, when);
    const amount = move.credit_cents || move.debit_cents;
    const entry = await insertJournal(ctx, {
      date: when,
      description: `Efectivización de cheque ${move.doc_number}`,
      source: 'BANCO',
      userId,
      lines: [
        { account: 'chequesPosfechados', debitCents: amount, creditCents: 0 },
        { account: bank.ledger_code, debitCents: 0, creditCents: amount },
      ],
    });
    await db().run(
      `UPDATE bank_movements SET status = 'CONTABILIZADO', doc_date = ?, journal_entry_id = ? WHERE id = ?`,
      [when, entry.id, movementId]
    );
    return { ok: true };
  });
}

async function reconcile({ companyId, bankId, movementIds, statementCents, date }) {
  const bank = await getBank(companyId, bankId);
  if (!bank) throw new AppError('Cuenta bancaria no encontrada.');
  await db().run(
    `UPDATE bank_movements SET reconciled = 0, reconcile_date = NULL WHERE company_id = ? AND bank_account_id = ?`,
    [companyId, bankId]
  );
  for (const id of movementIds || []) {
    await db().run(
      `UPDATE bank_movements SET reconciled = 1, reconcile_date = ? WHERE id = ? AND company_id = ? AND bank_account_id = ? AND status = 'CONTABILIZADO'`,
      [date || null, id, companyId, bankId]
    );
  }
  return bankPosition(companyId, bankId, statementCents);
}

async function bankPosition(companyId, bankId, statementCents) {
  const bank = await db().get('SELECT * FROM bank_accounts WHERE id = ? AND company_id = ?', [bankId, companyId]);
  const moves = await db().all('SELECT * FROM bank_movements WHERE bank_account_id = ? ORDER BY doc_date, id', [bankId]);
  const book = moves.filter((m) => m.status === 'CONTABILIZADO');
  const net = book.reduce((s, m) => s + m.debit_cents - m.credit_cents, 0);
  const bookCents = bank.opening_balance_cents + net;
  const pending = moves.filter((m) => m.status === 'PENDIENTE');
  const reconciledNet = book.filter((m) => m.reconciled).reduce((s, m) => s + m.debit_cents - m.credit_cents, 0);
  return {
    bank,
    bookCents,
    reconciledCents: bank.opening_balance_cents + reconciledNet,
    statementCents: statementCents == null ? null : Math.round(Number(statementCents)),
    differenceCents: statementCents == null ? null : Math.round(Number(statementCents)) - bookCents,
    movements: moves,
    pending,
  };
}

module.exports = {
  postSettlement, proposeApplication, postBankAccount, postBankMovement, clearPostdated, reconcile, bankPosition, openInvoices,
};
