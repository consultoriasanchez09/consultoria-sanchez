const { AppError } = require('./errors');
const { parseMoney } = require('./money');
const { buildClosingJournal } = require('./accounting');
const { applyIn, applyOut, snapshot, roundQty } = require('./inventory');
const { db, isoNow, assertDate, loadCtx, assertPeriodOpen, nextNumber, insertJournal } = require('./ctx');
const { insert } = require('./db');

async function postManualJournal(input) {
  return db().tx(async () => {
    const ctx = await loadCtx(input.companyId);
    const date = assertDate(input.date);
    await assertPeriodOpen(input.companyId, date);
    const description = String(input.description || '').trim();
    if (!description) throw new AppError('Indique el concepto del asiento.');
    const lines = (input.lines || []).map((line) => ({
      account: line.code || line.account,
      debitCents: line.debitCents != null && line.debit == null ? Math.round(Number(line.debitCents)) : parseMoney(line.debit || 0),
      creditCents: line.creditCents != null && line.credit == null ? Math.round(Number(line.creditCents)) : parseMoney(line.credit || 0),
      description: line.description || description,
    })).filter((line) => line.debitCents || line.creditCents);
    if (lines.length < 2) throw new AppError('El asiento necesita al menos dos líneas.');
    const entry = await insertJournal(ctx, { date, description, source: 'MANUAL', userId: input.userId, lines });
    return { id: entry.id, number: entry.number, totalCents: entry.total };
  });
}

async function closeYear({ companyId, userId, year }) {
  const y = Number(year);
  if (!y || y < 2000 || y > 2100) throw new AppError('Año de ejercicio no válido.');
  return db().tx(async () => {
    const ctx = await loadCtx(companyId);
    const exists = await db().get('SELECT 1 AS ok FROM year_closes WHERE company_id = ? AND year = ?', [companyId, y]);
    if (exists) throw new AppError(`El ejercicio ${y} ya está cerrado.`);
    const prevHas = await db().get(
      'SELECT 1 AS ok FROM journal_entries WHERE company_id = ? AND doc_date < ? AND status = ?',
      [companyId, `${y}-01-01`, 'CONTABILIZADO']
    );
    const prevClosed = await db().get('SELECT 1 AS ok FROM year_closes WHERE company_id = ? AND year = ?', [companyId, y - 1]);
    if (prevHas && !prevClosed) throw new AppError(`Cierre primero el ejercicio ${y - 1}.`);
    const rows = await db().all(
      `SELECT a.code AS code, SUM(l.debit_cents) AS debit_cents, SUM(l.credit_cents) AS credit_cents
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounts a ON a.id = l.account_id
       WHERE e.company_id = ? AND e.status = 'CONTABILIZADO' AND e.doc_date <= ?
         AND a.type IN ('INGRESO', 'GASTO', 'COSTO') AND a.is_movement = 1
       GROUP BY a.code`,
      [companyId, `${y}-12-31`]
    );
    const journal = buildClosingJournal(rows.map((row) => ({
      code: row.code,
      debitCents: Number(row.debit_cents || 0),
      creditCents: Number(row.credit_cents || 0),
    })));
    let entryId = null;
    if (journal.lines.length) {
      const entry = await insertJournal(ctx, {
        date: `${y}-12-31`,
        description: `Cierre del ejercicio ${y}`,
        source: 'CIERRE',
        userId,
        lines: journal.lines,
      });
      entryId = entry.id;
    }
    await db().run(
      'INSERT INTO year_closes (company_id, year, entry_id, closed_at) VALUES (?, ?, ?, ?)',
      [companyId, y, entryId, isoNow()]
    );
    return { year: y, entryId };
  });
}

async function postWarehouse(input) {
  return db().tx(async () => {
    const ctx = await loadCtx(input.companyId);
    const date = assertDate(input.date);
    await assertPeriodOpen(input.companyId, date);
    const docType = input.docType;
    if (!['INGRESO', 'EGRESO', 'TRANSFERENCIA'].includes(docType)) throw new AppError('Tipo de documento de bodega no válido.');
    const lines = input.lines || [];
    if (!lines.length) throw new AppError('Agregue al menos un producto.');
    const number = await nextNumber(input.companyId, 'BOD');
    const ops = [];
    let totalCost = 0;
    for (const raw of lines) {
      const product = await db().get('SELECT * FROM products WHERE id = ? AND company_id = ?', [raw.productId, input.companyId]);
      if (!product || !product.inventoriable) throw new AppError('Seleccione un producto inventariable.');
      const qty = roundQty(raw.qty);
      if (!(qty > 0)) throw new AppError('La cantidad debe ser mayor a cero.');
      const state = snapshot({ stockQty: product.stock_qty, stockValueCents: product.stock_value_cents, avgCostCents: product.avg_cost_cents });
      if (docType === 'INGRESO') {
        const unit = raw.unitCostCents != null ? Math.round(Number(raw.unitCostCents)) : parseMoney(raw.unitCost);
        if (!(unit > 0)) throw new AppError('Indique el costo unitario del ingreso.');
        const cost = Math.round(unit * qty);
        const next = applyIn(state, qty, cost);
        ops.push({ product, qty, cost, next, direction: 'in' });
        totalCost += cost;
      } else if (docType === 'EGRESO') {
        const next = applyOut(state, qty);
        ops.push({ product, qty, cost: next.costCents, next, direction: 'out' });
        totalCost += next.costCents;
      } else {
        const next = applyOut(state, qty);
        const back = applyIn(next, qty, next.costCents);
        back.stockQty = state.stockQty;
        back.stockValueCents = state.stockValueCents;
        back.avgCostCents = state.avgCostCents;
        ops.push({ product, qty, cost: next.costCents, next: back, direction: 'transfer', mid: next });
      }
      await db().run(
        'UPDATE products SET stock_qty = ?, stock_value_cents = ?, avg_cost_cents = ? WHERE id = ?',
        [ops[ops.length - 1].next.stockQty, ops[ops.length - 1].next.stockValueCents, ops[ops.length - 1].next.avgCostCents, product.id]
      );
    }
    let entryId = null;
    if (docType === 'INGRESO') {
      const entry = await insertJournal(ctx, {
        date, description: `Ingreso de bodega ${number}`, source: 'INV', userId: input.userId,
        lines: [{ account: 'inventario', debitCents: totalCost, creditCents: 0 }, { account: 'ajusteInventario', debitCents: 0, creditCents: totalCost }],
      });
      entryId = entry.id;
    } else if (docType === 'EGRESO') {
      const entry = await insertJournal(ctx, {
        date, description: `Egreso de bodega ${number}`, source: 'INV', userId: input.userId,
        lines: [{ account: 'ajusteInventario', debitCents: totalCost, creditCents: 0 }, { account: 'inventario', debitCents: 0, creditCents: totalCost }],
      });
      entryId = entry.id;
    }
    const doc = await insert('warehouse_docs', {
      company_id: input.companyId, doc_type: docType, doc_number: number, doc_date: date,
      notes: input.notes || '', from_warehouse: input.fromWarehouse || 'GENERAL', to_warehouse: input.toWarehouse || 'SUCURSAL',
      journal_entry_id: entryId, created_at: isoNow(),
    });
    for (const op of ops) {
      if (op.direction === 'transfer') {
        await insert('inventory_moves', move(input.companyId, op, date, number, doc.lastId, 'TRANSFERENCIA', op.qty, 0, `Sale ${input.fromWarehouse || 'GENERAL'}`));
        const back = op.next;
        await insert('inventory_moves', {
          company_id: input.companyId, product_id: op.product.id, doc_date: date, kind: 'TRANSFERENCIA', doc_number: number,
          document_id: null, warehouse_doc_id: doc.lastId, description: `Entra ${input.toWarehouse || 'SUCURSAL'}`,
          qty_in: op.qty, qty_out: 0, total_cost_cents: op.cost, balance_qty: back.stockQty,
          balance_value_cents: back.stockValueCents, avg_cost_cents: back.avgCostCents,
        });
      } else {
        await insert('inventory_moves', move(
          input.companyId, op, date, number, doc.lastId, docType,
          op.direction === 'in' ? op.qty : 0,
          op.direction === 'out' ? op.qty : 0,
          input.notes || docType
        ));
      }
    }
    return { id: doc.lastId, number, totalCostCents: totalCost };
  });
}

function move(companyId, op, date, number, warehouseId, kind, qtyIn, qtyOut, description) {
  return {
    company_id: companyId, product_id: op.product.id, doc_date: date, kind, doc_number: number,
    document_id: null, warehouse_doc_id: warehouseId, description,
    qty_in: qtyIn, qty_out: qtyOut, total_cost_cents: op.cost,
    balance_qty: op.next.stockQty, balance_value_cents: op.next.stockValueCents, avg_cost_cents: op.next.avgCostCents,
  };
}

module.exports = { postManualJournal, closeYear, postWarehouse };
