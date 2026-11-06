const { AppError } = require('./errors');

function consolidate(lines) {
  const map = new Map();
  for (const line of lines) {
    const debit = Math.round(line.debitCents || 0);
    const credit = Math.round(line.creditCents || 0);
    if (!debit && !credit) continue;
    if (debit < 0 || credit < 0) throw new AppError('Un asiento no puede tener valores negativos.');
    if (debit && credit) throw new AppError('Una línea no puede tener débito y crédito a la vez.');
    const dir = debit ? 'D' : 'C';
    const key = `${line.account}|${dir}|${line.partyId || ''}`;
    const cur = map.get(key);
    if (cur) {
      cur.debitCents += debit;
      cur.creditCents += credit;
    } else {
      map.set(key, {
        account: line.account,
        debitCents: debit,
        creditCents: credit,
        description: line.description || '',
        partyId: line.partyId || null,
      });
    }
  }
  return [...map.values()];
}

function assertBalanced(lines) {
  const clean = consolidate(lines);
  const debit = clean.reduce((s, l) => s + l.debitCents, 0);
  const credit = clean.reduce((s, l) => s + l.creditCents, 0);
  if (debit !== credit) {
    throw new AppError(`El asiento no cuadra: débitos ${debit} y créditos ${credit}.`);
  }
  return { lines: clean, total: debit };
}

function summarizeLines(lines) {
  if (!lines.length) throw new AppError('Agregue al menos un ítem.');
  const acc = {
    subtotalCents: 0,
    discountCents: 0,
    base15Goods: 0,
    base0Goods: 0,
    base15Services: 0,
    base0Services: 0,
    iceCents: 0,
    ivaCents: 0,
    capitalizableCents: 0,
    expenseCents: 0,
    lines: [],
  };
  for (const line of lines) {
    const qty = Number(line.qty);
    if (!(qty > 0)) throw new AppError('La cantidad debe ser mayor a cero.');
    const price = Math.round(Number(line.priceCents));
    if (!Number.isInteger(price) || price < 0) throw new AppError('El precio no es válido.');
    const gross = Math.round(qty * price);
    const discount = Math.round(Number(line.discountCents || 0));
    if (!Number.isInteger(discount) || discount < 0 || discount > gross) {
      throw new AppError('El descuento del ítem no es válido.');
    }
    const base = gross - discount;
    const iceRate = Number(line.iceRate || 0);
    const ivaRate = Number(line.ivaRate);
    if (ivaRate !== 0 && ivaRate !== 15) throw new AppError('La tarifa de IVA debe ser 15% o 0%.');
    if (iceRate < 0) throw new AppError('La tarifa de ICE no es válida.');
    const ice = Math.round(base * iceRate / 100);
    const iva = ivaRate ? Math.round((base + ice) * ivaRate / 100) : 0;
    const isService = line.kind === 'SERVICIO';
    if (isService) {
      if (ivaRate === 15) acc.base15Services += base;
      else acc.base0Services += base;
    } else if (ivaRate === 15) acc.base15Goods += base;
    else acc.base0Goods += base;
    const costBase = base + ice;
    if (line.inventoriable) acc.capitalizableCents += costBase;
    else acc.expenseCents += costBase;
    acc.subtotalCents += gross;
    acc.discountCents += discount;
    acc.iceCents += ice;
    acc.ivaCents += iva;
    acc.lines.push({
      ...line,
      qty,
      priceCents: price,
      discountCents: discount,
      grossCents: gross,
      baseCents: base,
      iceCents: ice,
      ivaCents: iva,
      totalCents: base + ice + iva,
    });
  }
  acc.base15 = acc.base15Goods + acc.base15Services;
  acc.base0 = acc.base0Goods + acc.base0Services;
  acc.totalCents = acc.subtotalCents - acc.discountCents + acc.iceCents + acc.ivaCents;
  return acc;
}

function push(lines, account, debit, credit, extra = {}) {
  if (!debit && !credit) return;
  lines.push({ account, debitCents: debit || 0, creditCents: credit || 0, ...extra });
}

function revenueLines(totals, lines) {
  push(lines, 'ventas15', 0, totals.base15Goods);
  push(lines, 'ventas0', 0, totals.base0Goods);
  push(lines, 'servicios15', 0, totals.base15Services);
  push(lines, 'servicios0', 0, totals.base0Services);
  push(lines, 'ice', 0, totals.iceCents);
  push(lines, 'ivaVentas', 0, totals.ivaCents);
}

function buildSalesJournal({ totals, counterAccount, partyId, retIva = 0, retRenta = 0, cogs = 0 }) {
  const lines = [];
  const net = totals.totalCents - retIva - retRenta;
  if (net < 0) throw new AppError('Las retenciones superan el total del documento.');
  push(lines, counterAccount, net, 0, { partyId });
  push(lines, 'retRentaFavor', retRenta, 0, { partyId });
  push(lines, 'retIvaFavor', retIva, 0, { partyId });
  revenueLines(totals, lines);
  push(lines, 'costo', cogs, 0);
  push(lines, 'inventario', 0, cogs);
  return assertBalanced(lines);
}

function buildSalesReturnJournal({ totals, counterAccount, partyId, cogs = 0 }) {
  const lines = [];
  push(lines, 'devoluciones', totals.base15 + totals.base0, 0);
  push(lines, 'ice', totals.iceCents, 0);
  push(lines, 'ivaVentas', totals.ivaCents, 0);
  push(lines, counterAccount, 0, totals.totalCents, { partyId });
  push(lines, 'inventario', cogs, 0);
  push(lines, 'costo', 0, cogs);
  return assertBalanced(lines);
}

function buildPurchaseJournal({ totals, counterAccount, partyId }) {
  const lines = [];
  push(lines, 'inventario', totals.capitalizableCents, 0);
  push(lines, 'gastoCompras', totals.expenseCents, 0);
  push(lines, 'ivaCompras', totals.ivaCents, 0);
  push(lines, counterAccount, 0, totals.totalCents, { partyId });
  return assertBalanced(lines);
}

function buildPurchaseReturnJournal({ totals, counterAccount, partyId }) {
  const lines = [];
  push(lines, counterAccount, totals.totalCents, 0, { partyId });
  push(lines, 'inventario', 0, totals.capitalizableCents);
  push(lines, 'gastoCompras', 0, totals.expenseCents);
  push(lines, 'ivaCompras', 0, totals.ivaCents);
  return assertBalanced(lines);
}

function buildRetentionJournal({ rentaCents = 0, ivaCents = 0, partyId }) {
  const lines = [];
  const total = rentaCents + ivaCents;
  if (total <= 0) throw new AppError('La retención no tiene valor.');
  push(lines, 'proveedores', total, 0, { partyId });
  push(lines, 'retRentaPagar', 0, rentaCents, { partyId });
  push(lines, 'retIvaPagar', 0, ivaCents, { partyId });
  return assertBalanced(lines);
}

function retentionAmount(baseCents, rate) {
  const base = Math.round(Number(baseCents));
  const pct = Number(rate);
  if (!Number.isInteger(base) || base < 0) throw new AppError('La base de la retención no es válida.');
  if (!(pct >= 0)) throw new AppError('El porcentaje de retención no es válido.');
  return Math.round(base * pct / 100);
}

function applySequential(openItems, amountCents) {
  const amount = Math.round(Number(amountCents));
  if (!Number.isInteger(amount) || amount < 0) throw new AppError('El valor a aplicar no es válido.');
  const ordered = [...openItems].sort((a, b) => String(a.dueDate || a.docDate).localeCompare(String(b.dueDate || b.docDate))
    || String(a.docDate).localeCompare(String(b.docDate))
    || (a.id || 0) - (b.id || 0));
  const applications = [];
  let left = amount;
  for (const item of ordered) {
    if (left <= 0) break;
    const balance = Math.round(item.balanceCents || 0);
    if (balance <= 0) continue;
    const take = Math.min(balance, left);
    applications.push({ openItemId: item.id, amountCents: take, docNumber: item.docNumber, partyId: item.partyId });
    left -= take;
  }
  return { applications, appliedCents: amount - left, unappliedCents: left };
}

const AGING_BUCKETS = [
  { id: 'por_vencer', label: 'Por vencer' },
  { id: '0-30', label: '0-30' },
  { id: '31-60', label: '31-60' },
  { id: '61-90', label: '61-90' },
  { id: '91-120', label: '91-120' },
  { id: '121-150', label: '121-150' },
  { id: '>150', label: '>150' },
];

function daysOverdue(dueDate, cutoff) {
  const [y1, m1, d1] = String(dueDate).split('-').map(Number);
  const [y2, m2, d2] = String(cutoff).split('-').map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86400000);
}

function agingBucket(days) {
  if (days <= 0) return 'por_vencer';
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  if (days <= 120) return '91-120';
  if (days <= 150) return '121-150';
  return '>150';
}

function buildAging(items, cutoff) {
  const buckets = Object.fromEntries(AGING_BUCKETS.map((b) => [b.id, { ...b, cents: 0, count: 0, items: [] }]));
  for (const item of items) {
    const days = daysOverdue(item.dueDate || item.docDate, cutoff);
    const id = agingBucket(days);
    const row = { ...item, days, bucket: id };
    buckets[id].cents += item.balanceCents;
    buckets[id].count += 1;
    buckets[id].items.push(row);
  }
  const list = AGING_BUCKETS.map((b) => buckets[b.id]);
  return {
    buckets: list,
    totalCents: list.reduce((s, b) => s + b.cents, 0),
    overdueCents: list.filter((b) => b.id !== 'por_vencer').reduce((s, b) => s + b.cents, 0),
  };
}

function splitDebitCredit(netDebitMinusCredit) {
  const net = Math.round(netDebitMinusCredit);
  if (net >= 0) return { debit: net, credit: 0 };
  return { debit: 0, credit: -net };
}

function accountingEquation(byType) {
  const net = (type) => {
    const row = byType[type] || { debit: 0, credit: 0 };
    return Math.round(row.debit || 0) - Math.round(row.credit || 0);
  };
  const assets = net('ACTIVO');
  const liabilities = -net('PASIVO');
  const equity = -net('PATRIMONIO');
  const result = -(net('INGRESO') + net('GASTO') + net('COSTO'));
  const difference = assets - liabilities - equity - result;
  return { assets, liabilities, equity, result, difference, balanced: difference === 0 };
}

function buildClosingJournal(accounts) {
  const lines = [];
  let utilidadCredit = 0;
  for (const account of accounts) {
    const balance = Math.round(account.debitCents || 0) - Math.round(account.creditCents || 0);
    if (!balance) continue;
    if (balance > 0) {
      lines.push({ account: account.code, debitCents: 0, creditCents: balance });
      utilidadCredit -= balance;
    } else {
      lines.push({ account: account.code, debitCents: -balance, creditCents: 0 });
      utilidadCredit += -balance;
    }
  }
  if (utilidadCredit > 0) lines.push({ account: 'utilidad', debitCents: 0, creditCents: utilidadCredit });
  else if (utilidadCredit < 0) lines.push({ account: 'utilidad', debitCents: -utilidadCredit, creditCents: 0 });
  if (!lines.length) return { lines: [], total: 0 };
  return assertBalanced(lines);
}

function naturalBalance(nature, debit, credit) {
  return nature === 'DEUDORA' ? debit - credit : credit - debit;
}

module.exports = {
  consolidate,
  assertBalanced,
  summarizeLines,
  buildSalesJournal,
  buildSalesReturnJournal,
  buildPurchaseJournal,
  buildPurchaseReturnJournal,
  buildRetentionJournal,
  retentionAmount,
  applySequential,
  AGING_BUCKETS,
  daysOverdue,
  agingBucket,
  buildAging,
  splitDebitCredit,
  accountingEquation,
  buildClosingJournal,
  naturalBalance,
};
