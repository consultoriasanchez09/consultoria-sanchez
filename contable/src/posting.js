const { insert } = require('./db');
const { AppError } = require('./errors');
const { parseMoney } = require('./money');
const { DOC_TYPES } = require('./catalogs');
const { applyIn, applyOut, snapshot } = require('./inventory');
const {
  summarizeLines, buildSalesJournal, buildSalesReturnJournal, buildPurchaseJournal,
  buildPurchaseReturnJournal, buildRetentionJournal, retentionAmount, assertBalanced,
} = require('./accounting');
const { db, isoNow, assertDate, addDays, loadCtx, assertPeriodOpen, nextNumber, insertJournal, decorateJournal } = require('./ctx');

const SALE = new Set(['FV', 'NV', 'NCV', 'NDV', 'COT']);
const PURCHASE = new Set(['FC', 'LIQ', 'NCC', 'NDC', 'RET']);

function centsField(raw, name) {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number' && Number.isInteger(raw) && Math.abs(raw) > 1000 && name === 'maybe') return raw;
  return parseMoney(raw);
}

function priceOf(raw, product) {
  if (raw.priceCents != null && raw.priceCents !== '') return Math.round(Number(raw.priceCents));
  if (raw.price != null && raw.price !== '') return parseMoney(raw.price);
  if (product) return product.price_cents;
  throw new AppError('Indique el precio del ítem.');
}

async function getParty(companyId, id) {
  if (!id) return null;
  const row = await db().get('SELECT * FROM parties WHERE id = ? AND company_id = ?', [id, companyId]);
  if (!row) throw new AppError('La persona no pertenece a esta empresa.', 404);
  return row;
}

async function getProduct(companyId, id) {
  const row = await db().get('SELECT * FROM products WHERE id = ? AND company_id = ?', [id, companyId]);
  if (!row) throw new AppError('El producto no pertenece a esta empresa.', 404);
  return row;
}

async function getBank(companyId, id) {
  if (!id) return null;
  const bank = await db().get(
    `SELECT b.*, a.code AS ledger_code FROM bank_accounts b
     JOIN accounts a ON a.id = b.ledger_account_id
     WHERE b.id = ? AND b.company_id = ?`,
    [id, companyId]
  );
  if (!bank) throw new AppError('La cuenta bancaria no pertenece a esta empresa.');
  if (!bank.active) throw new AppError('La cuenta bancaria está inactiva.');
  return bank;
}

function counterAccount(method, side, bank, postdatedCheque) {
  if (method === 'CREDITO') return side === 'VENTA' ? 'clientes' : 'proveedores';
  if (method === 'EFECTIVO') return 'caja';
  if (method === 'CHEQUE' && postdatedCheque && side === 'COMPRA') return 'chequesPosfechados';
  if (bank) return bank.ledger_code;
  return 'bancos';
}

async function normalizeLines(companyId, rawLines) {
  if (!rawLines || !rawLines.length) throw new AppError('Agregue al menos un ítem.');
  const out = [];
  for (const raw of rawLines) {
    const product = raw.productId ? await getProduct(companyId, raw.productId) : null;
    if (product && !product.active) throw new AppError(`El producto ${product.code} está inactivo.`);
    if (!product && !String(raw.description || '').trim()) throw new AppError('Cada ítem necesita un producto o una descripción.');
    out.push({
      productId: product ? product.id : null,
      description: String(raw.description || product.name).trim(),
      qty: Number(String(raw.qty).replace(',', '.')),
      priceCents: priceOf(raw, product),
      discountCents: raw.discountCents != null && raw.discountCents !== '' && raw.discount == null
        ? Math.round(Number(raw.discountCents))
        : parseMoney(raw.discount || 0),
      ivaRate: raw.ivaRate != null && raw.ivaRate !== '' ? Number(raw.ivaRate) : (product ? product.iva_rate : 15),
      iceRate: raw.iceRate != null && raw.iceRate !== '' ? Number(raw.iceRate) : (product ? Number(product.ice_rate) : 0),
      kind: product ? product.kind : (raw.kind === 'BIEN' ? 'BIEN' : 'SERVICIO'),
      inventoriable: product ? !!product.inventoriable : false,
      product,
    });
  }
  return out;
}

function freshState(map, product) {
  if (!map.has(product.id)) {
    map.set(product.id, snapshot({
      stockQty: product.stock_qty,
      stockValueCents: product.stock_value_cents,
      avgCostCents: product.avg_cost_cents,
    }));
  }
  return map.get(product.id);
}

async function originalLines(documentId) {
  if (!documentId) return [];
  return db().all('SELECT * FROM document_lines WHERE document_id = ?', [documentId]);
}

async function openFactura(documentId) {
  if (!documentId) return null;
  return db().all(
    `SELECT * FROM open_items WHERE document_id = ? AND kind = 'FACTURA'`,
    [documentId]
  );
}

function normalizeRetentions(rawLines) {
  if (!rawLines || !rawLines.length) throw new AppError('Agregue al menos un código de retención.');
  return rawLines.map((raw) => {
    const baseCents = raw.baseCents != null && raw.base == null ? Math.round(Number(raw.baseCents)) : parseMoney(raw.base);
    const rate = Number(raw.rate);
    const amount = retentionAmount(baseCents, rate);
    if (!raw.code) throw new AppError('Indique el código de retención.');
    if (raw.tax !== 'RENTA' && raw.tax !== 'IVA') throw new AppError('El impuesto de la retención debe ser RENTA o IVA.');
    if (amount <= 0) throw new AppError('La retención debe ser mayor a cero.');
    return { tax: raw.tax, code: String(raw.code), baseCents, rate, amountCents: amount };
  });
}

async function computeDocument(input, preview) {
  const docType = input.docType;
  const meta = DOC_TYPES[docType];
  if (!meta) throw new AppError('Tipo de documento no reconocido.');
  const companyId = input.companyId;
  const ctx = await loadCtx(companyId);
  const date = assertDate(input.date);
  await assertPeriodOpen(companyId, date);
  const party = await getParty(companyId, input.partyId);
  if (!party || party.kind !== meta.party) throw new AppError(`Seleccione un ${meta.party === 'CLIENTE' ? 'cliente' : 'proveedor'} válido.`);
  if (party.blocked) throw new AppError('La persona está bloqueada.');
  if (!party.active) throw new AppError('La persona está inactiva.');

  let related = null;
  if (meta.related) {
    related = await db().get('SELECT * FROM documents WHERE id = ? AND company_id = ?', [input.relatedDocumentId, companyId]);
    if (!related || related.status !== 'EMITIDO') throw new AppError('El documento relacionado no está emitido.');
    const expected = docType === 'RET' || docType === 'NCC' || docType === 'NDC' ? ['FC', 'LIQ'] : ['FV', 'NV'];
    if (!expected.includes(related.doc_type)) throw new AppError('El documento relacionado no corresponde a este tipo.');
  }

  if (docType === 'RET') {
    const retLines = normalizeRetentions(input.retentions || input.lines);
    const renta = retLines.filter((r) => r.tax === 'RENTA').reduce((s, r) => s + r.amountCents, 0);
    const iva = retLines.filter((r) => r.tax === 'IVA').reduce((s, r) => s + r.amountCents, 0);
    const journal = buildRetentionJournal({ rentaCents: renta, ivaCents: iva, partyId: party.id });
    const items = await openFactura(related.id);
    const open = items.find((i) => i.status === 'ABIERTO') || items[0];
    if (!open) throw new AppError('La factura relacionada no tiene saldo por pagar.');
    if (renta + iva > open.balance_cents) throw new AppError('La retención supera el saldo del proveedor.');
    return {
      ctx, meta, docType, date, party, related, retLines, journal, openItem: open,
      totals: { subtotalCents: renta + iva, discountCents: 0, base15: 0, base0: 0, iceCents: 0, ivaCents: iva, totalCents: renta + iva },
      stockOps: [], bankPlan: null, warnings: [], receivable: 0,
    };
  }

  const norm = await normalizeLines(companyId, input.lines);
  const totals = summarizeLines(norm);
  let method = input.paymentMethod || 'CREDITO';
  if (related && ['NCV', 'NDV', 'NCC', 'NDC'].includes(docType)) method = related.payment_method || method;
  const bank = await getBank(companyId, input.bankAccountId);
  const postdated = !!(input.chequePostdated || input.cheque?.postdated);
  const side = meta.side;
  const counter = counterAccount(method, side, bank, postdated);
  const retIva = parseMoney(input.retIva ?? 0);
  const retRenta = parseMoney(input.retRenta ?? 0);
  const states = new Map();
  const stockOps = [];
  let cogs = 0;
  const prior = related ? await originalLines(related.id) : [];

  const touchOut = (line) => {
    if (!line.inventoriable || !line.product) return 0;
    const state = freshState(states, line.product);
    const out = applyOut(state, line.qty);
    if (out.stockQty < -0.0001) throw new AppError(`Stock insuficiente de ${line.product.name}.`);
    states.set(line.product.id, out);
    stockOps.push({ product: line.product, direction: 'out', qty: line.qty, cost: out.costCents, state: out, description: line.description });
    line.costCents = out.costCents;
    return out.costCents;
  };
  const touchIn = (line, cost) => {
    if (!line.inventoriable || !line.product) return;
    const state = freshState(states, line.product);
    const inn = applyIn(state, line.qty, cost);
    states.set(line.product.id, inn);
    stockOps.push({ product: line.product, direction: 'in', qty: line.qty, cost, state: inn, description: line.description });
    line.costCents = cost;
  };

  if (docType === 'FV' || docType === 'NV') {
    for (const line of totals.lines) cogs += touchOut(line);
  } else if (docType === 'NCV') {
    for (const line of totals.lines) {
      if (!line.inventoriable || !line.product) continue;
      const orig = prior.find((p) => p.product_id === line.product.id);
      const unit = orig && Number(orig.qty) ? Math.round(Number(orig.cost_cents) / Number(orig.qty)) : (line.product.avg_cost_cents || 0);
      const cost = Math.round(unit * line.qty);
      touchIn(line, cost);
      cogs += cost;
    }
  } else if (docType === 'FC' || docType === 'LIQ' || docType === 'NDC') {
    for (const line of totals.lines) if (line.inventoriable) touchIn(line, line.baseCents + line.iceCents);
  } else if (docType === 'NCC') {
    for (const line of totals.lines) cogs += touchOut(line);
  }

  let journal = { lines: [], total: 0 };
  if (docType !== 'COT') {
    if (docType === 'FV' || docType === 'NV' || docType === 'NDV') {
      journal = buildSalesJournal({ totals, counterAccount: counter, partyId: party.id, retIva, retRenta, cogs: docType === 'NDV' ? 0 : cogs });
    } else if (docType === 'NCV') {
      journal = buildSalesReturnJournal({ totals, counterAccount: counter, partyId: party.id, cogs });
    } else if (docType === 'FC' || docType === 'LIQ' || docType === 'NDC') {
      journal = buildPurchaseJournal({ totals, counterAccount: counter, partyId: party.id });
    } else if (docType === 'NCC') {
      const actual = stockOps.reduce((s, op) => s + op.cost, 0);
      const plug = totals.capitalizableCents - actual;
      const lines = [
        { account: counter, debitCents: totals.totalCents, creditCents: 0, partyId: party.id },
      ];
      if (actual) lines.push({ account: 'inventario', debitCents: 0, creditCents: actual });
      if (totals.expenseCents) lines.push({ account: 'gastoCompras', debitCents: 0, creditCents: totals.expenseCents });
      if (totals.ivaCents) lines.push({ account: 'ivaCompras', debitCents: 0, creditCents: totals.ivaCents });
      if (plug > 0) lines.push({ account: 'ajusteInventario', debitCents: 0, creditCents: plug });
      if (plug < 0) lines.push({ account: 'ajusteInventario', debitCents: -plug, creditCents: 0 });
      journal = assertBalanced(lines);
    }
  }

  const term = Number(input.termDays ?? party.credit_days ?? 0);
  const due = input.dueDate ? assertDate(input.dueDate, 'fecha de vencimiento') : (method === 'CREDITO' ? addDays(date, term) : date);
  const netAr = totals.totalCents - retIva - retRenta;
  const warnings = [];
  if (method === 'CREDITO' && party.credit_limit_cents > 0 && (docType === 'FV' || docType === 'NV' || docType === 'NDV')) {
    const row = await db().get(
      `SELECT COALESCE(SUM(balance_cents),0) AS s FROM open_items WHERE company_id = ? AND party_id = ? AND side = 'AR' AND kind = 'FACTURA' AND status = 'ABIERTO'`,
      [companyId, party.id]
    );
    if (Number(row.s) + netAr > party.credit_limit_cents) warnings.push('El documento supera el cupo de crédito del cliente.');
  }
  if ((docType === 'NCV' || docType === 'NCC' || docType === 'RET') && related && related.payment_method === 'CREDITO') {
    const items = await openFactura(related.id);
    const open = items.find((i) => i.status === 'ABIERTO');
    const amount = docType === 'RET' ? 0 : totals.totalCents;
    if (open && amount > open.balance_cents) throw new AppError('El valor supera el saldo pendiente del documento relacionado.');
    if (!open && amount > 0 && related.payment_method === 'CREDITO') {
      throw new AppError('El documento relacionado no tiene saldo pendiente.');
    }
  }

  let bankPlan = null;
  const moneyMoves = method === 'TRANSFERENCIA' || method === 'TARJETA' || method === 'CHEQUE';
  if (moneyMoves && bank && docType !== 'COT') {
    const inbound = side === 'VENTA' && docType !== 'NCV';
    const outbound = side === 'COMPRA' && docType !== 'NCC' || (side === 'VENTA' && docType === 'NCV');
    const pending = method === 'CHEQUE' && postdated && side === 'COMPRA' && docType !== 'NCC';
    bankPlan = {
      bankId: bank.id,
      inbound: inbound && !pending,
      outbound: outbound || pending,
      pending,
      amount: docType === 'NCV' || docType === 'NCC' ? totals.totalCents : (side === 'VENTA' ? netAr : totals.totalCents),
    };
  }

  return {
    ctx, meta, docType, date, due, term, party, related, totals, journal, stockOps, bankPlan, warnings,
    method, bank, postdated, retIva, retRenta, netAr, norm: totals.lines,
  };
}

async function persistDocument(input, preview) {
  const built = await computeDocument(input, preview);
  const view = {
    totals: {
      subtotalCents: built.totals.subtotalCents,
      discountCents: built.totals.discountCents,
      base15Cents: built.totals.base15 || 0,
      base0Cents: built.totals.base0 || 0,
      iceCents: built.totals.iceCents,
      ivaCents: built.totals.ivaCents,
      totalCents: built.totals.totalCents,
    },
    journal: decorateJournal(built.ctx, built.journal.lines || []),
    warnings: built.warnings,
    posts: built.docType !== 'COT',
  };
  if (preview) return view;

  const number = await nextNumber(built.ctx.company.id, built.docType, built.ctx.company.establecimiento, built.ctx.company.punto_emision);
  const cheque = input.cheque || {};
  const doc = await insert('documents', {
    company_id: input.companyId,
    doc_type: built.docType,
    doc_number: number,
    doc_date: built.date,
    due_date: built.due || built.date,
    party_id: built.party.id,
    party_name: built.party.name,
    party_ident: built.party.identification,
    status: 'EMITIDO',
    payment_method: built.method || null,
    sri_pay_code: input.sriPayCode || (built.method === 'EFECTIVO' ? '01' : '20'),
    term_days: built.term || 0,
    subtotal_cents: view.totals.subtotalCents,
    discount_cents: view.totals.discountCents,
    base15_cents: view.totals.base15Cents,
    base0_cents: view.totals.base0Cents,
    ice_cents: view.totals.iceCents,
    iva_cents: view.totals.ivaCents,
    total_cents: view.totals.totalCents,
    ret_iva_cents: built.retIva || 0,
    ret_renta_cents: built.retRenta || 0,
    cheque_number: cheque.number || input.chequeNumber || null,
    cheque_bank: cheque.bank || input.chequeBank || null,
    cheque_date: cheque.date || input.chequeDate || null,
    cheque_postdated: built.postdated ? 1 : 0,
    notes: input.notes || null,
    related_document_id: built.related ? built.related.id : null,
    sustento: input.sustento || '01',
    establecimiento: built.ctx.company.establecimiento,
    punto_emision: built.ctx.company.punto_emision,
    journal_entry_id: null,
    sri_status: built.docType === 'COT' ? 'NO_APLICA' : 'PENDIENTE',
    created_by: input.userId || null,
    created_at: isoNow(),
  });
  const documentId = doc.lastId;

  if (built.docType === 'RET') {
    for (const line of built.retLines) {
      await insert('retention_lines', {
        document_id: documentId, tax: line.tax, code: line.code,
        base_cents: line.baseCents, rate: line.rate, amount_cents: line.amountCents,
      });
    }
  } else {
    for (const line of built.norm) {
      await insert('document_lines', {
        document_id: documentId,
        product_id: line.productId,
        description: line.description,
        qty: line.qty,
        unit_price_cents: line.priceCents,
        discount_cents: line.discountCents,
        iva_rate: line.ivaRate,
        ice_rate: line.iceRate,
        base_cents: line.baseCents,
        ice_cents: line.iceCents,
        iva_cents: line.ivaCents,
        total_cents: line.totalCents,
        cost_cents: line.costCents || 0,
        kind: line.kind,
      });
    }
  }

  let entry = null;
  if (built.docType !== 'COT') {
    const label = `${built.meta.label} ${number} · ${built.party.name}`;
    entry = await insertJournal(built.ctx, {
      date: built.date,
      description: label,
      source: built.docType,
      sourceId: documentId,
      userId: input.userId,
      lines: built.journal.lines,
    });
    await db().run('UPDATE documents SET journal_entry_id = ? WHERE id = ?', [entry.id, documentId]);
  }

  for (const op of built.stockOps) {
    await db().run(
      'UPDATE products SET stock_qty = ?, stock_value_cents = ?, avg_cost_cents = ? WHERE id = ?',
      [op.state.stockQty, op.state.stockValueCents, op.state.avgCostCents, op.product.id]
    );
    await insert('inventory_moves', {
      company_id: input.companyId,
      product_id: op.product.id,
      doc_date: built.date,
      kind: built.docType,
      doc_number: number,
      document_id: documentId,
      warehouse_doc_id: null,
      description: op.description,
      qty_in: op.direction === 'in' ? op.qty : 0,
      qty_out: op.direction === 'out' ? op.qty : 0,
      total_cost_cents: op.cost,
      balance_qty: op.state.stockQty,
      balance_value_cents: op.state.stockValueCents,
      avg_cost_cents: op.state.avgCostCents,
    });
  }

  const createsOpen = built.method === 'CREDITO' && ['FV', 'NV', 'NDV', 'FC', 'LIQ', 'NDC'].includes(built.docType);
  if (createsOpen) {
    const amount = built.meta.side === 'VENTA' ? built.netAr : built.totals.totalCents;
    if (amount > 0) {
      await insert('open_items', {
        company_id: input.companyId,
        side: built.meta.side === 'VENTA' ? 'AR' : 'AP',
        kind: 'FACTURA',
        party_id: built.party.id,
        document_id: documentId,
        doc_date: built.date,
        due_date: built.due,
        doc_number: number,
        description: built.meta.label,
        original_cents: amount,
        balance_cents: amount,
        status: 'ABIERTO',
      });
    }
  }

  if ((built.docType === 'NCV' || built.docType === 'NCC') && built.related && built.related.payment_method === 'CREDITO') {
    const items = await openFactura(built.related.id);
    const open = items.find((i) => i.status === 'ABIERTO');
    if (open) {
      const balance = open.balance_cents - built.totals.totalCents;
      await db().run('UPDATE open_items SET balance_cents = ?, status = ? WHERE id = ?', [balance, balance === 0 ? 'CERRADO' : 'ABIERTO', open.id]);
    }
  }
  if (built.docType === 'RET') {
    const balance = built.openItem.balance_cents - view.totals.totalCents;
    await db().run('UPDATE open_items SET balance_cents = ?, status = ? WHERE id = ?', [balance, balance === 0 ? 'CERRADO' : 'ABIERTO', built.openItem.id]);
  }

  if (built.bankPlan && built.bankPlan.amount > 0) {
    const inbound = built.meta.side === 'VENTA' ? built.docType !== 'NCV' : built.docType === 'NCC';
    await insert('bank_movements', {
      company_id: input.companyId,
      bank_account_id: built.bankPlan.bankId,
      doc_date: built.date,
      kind: built.method === 'CHEQUE' ? 'CHEQUE' : built.method === 'TARJETA' ? 'TARJETA' : 'TRANSFERENCIA',
      doc_number: cheque.number || number,
      description: `${built.meta.label} ${number}`,
      debit_cents: inbound && !built.bankPlan.pending ? built.bankPlan.amount : 0,
      credit_cents: !inbound || built.bankPlan.pending ? built.bankPlan.amount : 0,
      status: built.bankPlan.pending ? 'PENDIENTE' : 'CONTABILIZADO',
      reconciled: 0,
      postdated: built.bankPlan.pending ? 1 : 0,
      posts_journal: 0,
      source: 'DOC',
      source_id: documentId,
      created_at: isoNow(),
    });
  }

  return { id: documentId, number, ...view, journalEntryId: entry ? entry.id : null };
}

function inTx(work) {
  return db().tx(work);
}

async function postDocument(input) {
  return inTx(() => persistDocument(input, false));
}

async function previewDocument(input) {
  return inTx(() => persistDocument(input, true));
}

async function voidDocument({ companyId, userId, documentId }) {
  return inTx(async () => {
    const doc = await db().get('SELECT * FROM documents WHERE id = ? AND company_id = ?', [documentId, companyId]);
    if (!doc) throw new AppError('Documento no encontrado.', 404);
    if (doc.status !== 'EMITIDO') throw new AppError('Solo se anulan documentos emitidos.');
    const child = await db().get(
      `SELECT doc_number FROM documents WHERE related_document_id = ? AND status = 'EMITIDO'`,
      [documentId]
    );
    if (child) throw new AppError(`No se puede anular: está relacionado con ${child.doc_number}.`);
    await assertPeriodOpen(companyId, doc.doc_date);
    const items = await openFactura(documentId);
    for (const item of items) {
      if (item.balance_cents !== item.original_cents) throw new AppError('No se puede anular: ya tiene cobros o pagos aplicados. Use una nota de crédito.');
    }
    const moves = await db().all('SELECT * FROM inventory_moves WHERE document_id = ? ORDER BY id', [documentId]);
    for (const move of moves) {
      const later = await db().get(
        'SELECT id FROM inventory_moves WHERE product_id = ? AND company_id = ? AND id > ?',
        [move.product_id, companyId, move.id]
      );
      if (later) throw new AppError('No se puede anular: hay movimientos de inventario posteriores. Emita una nota de crédito.');
    }
    if (doc.journal_entry_id) {
      await db().run(`UPDATE journal_entries SET status = 'ANULADO' WHERE id = ?`, [doc.journal_entry_id]);
    }
    for (const move of [...moves].reverse()) {
      const product = await getProduct(companyId, move.product_id);
      const state = snapshot({ stockQty: product.stock_qty, stockValueCents: product.stock_value_cents, avgCostCents: product.avg_cost_cents });
      let next;
      if (Number(move.qty_in) > 0) {
        const stockQty = Math.round((Number(state.stockQty) - Number(move.qty_in)) * 10000) / 10000;
        const stockValueCents = Math.round(state.stockValueCents) - Math.round(move.total_cost_cents);
        if (stockQty < -0.0001 || stockValueCents < 0) throw new AppError('No se puede revertir el inventario de este documento.');
        next = {
          stockQty,
          stockValueCents,
          avgCostCents: stockQty > 0 ? Math.round(stockValueCents / stockQty) : 0,
        };
      } else {
        next = applyIn(state, Number(move.qty_out), move.total_cost_cents);
      }
      await db().run(
        'UPDATE products SET stock_qty = ?, stock_value_cents = ?, avg_cost_cents = ? WHERE id = ?',
        [next.stockQty, next.stockValueCents, next.avgCostCents, product.id]
      );
    }
    for (const item of items) {
      await db().run(`UPDATE open_items SET balance_cents = 0, status = 'ANULADO' WHERE id = ?`, [item.id]);
    }
    if (doc.related_document_id && (doc.doc_type === 'NCV' || doc.doc_type === 'NCC' || doc.doc_type === 'RET')) {
      const amount = doc.total_cents;
      const relatedItems = await openFactura(doc.related_document_id);
      const target = relatedItems[0];
      if (target && target.status !== 'ANULADO') {
        const balance = target.balance_cents + amount;
        await db().run(
          `UPDATE open_items SET balance_cents = ?, status = 'ABIERTO' WHERE id = ?`,
          [Math.min(balance, target.original_cents), target.id]
        );
      }
    }
    await db().run(
      `UPDATE bank_movements SET status = 'ANULADO' WHERE company_id = ? AND source = 'DOC' AND source_id = ?`,
      [companyId, documentId]
    );
    await db().run(`UPDATE documents SET status = 'ANULADO' WHERE id = ?`, [documentId]);
    return { ok: true };
  });
}

async function convertQuote({ companyId, userId, documentId, date }) {
  return inTx(async () => {
    const doc = await db().get('SELECT * FROM documents WHERE id = ? AND company_id = ?', [documentId, companyId]);
    if (!doc || doc.doc_type !== 'COT') throw new AppError('La cotización no existe.');
    if (doc.status !== 'EMITIDO') throw new AppError('La cotización ya no está disponible.');
    const lines = await db().all('SELECT * FROM document_lines WHERE document_id = ?', [documentId]);
    const created = await persistDocument({
      companyId,
      userId,
      docType: 'FV',
      date: date || doc.doc_date,
      partyId: doc.party_id,
      paymentMethod: doc.payment_method || 'CREDITO',
      termDays: doc.term_days,
      sriPayCode: doc.sri_pay_code,
      notes: `Desde cotización ${doc.doc_number}`,
      lines: lines.map((l) => ({
        productId: l.product_id,
        description: l.description,
        qty: l.qty,
        priceCents: l.unit_price_cents,
        discountCents: l.discount_cents,
        ivaRate: l.iva_rate,
        iceRate: l.ice_rate,
        kind: l.kind,
      })),
    }, false);
    await db().run(`UPDATE documents SET status = 'CONVERTIDA' WHERE id = ?`, [documentId]);
    return created;
  });
}

module.exports = {
  postDocument, previewDocument, voidDocument, convertQuote, getParty, getProduct, getBank, centsField,
};
