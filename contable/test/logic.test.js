const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCedula, validateRuc, makeCedula, makeRucNatural, makeRucPrivada } = require('../src/ecuador');
const { parseMoney } = require('../src/money');
const { applyIn, applyOut } = require('../src/inventory');
const { calcEmployeePayroll, buildPayrollJournal } = require('../src/payroll');
const {
  summarizeLines, buildSalesJournal, buildPurchaseJournal, buildSalesReturnJournal,
  applySequential, buildAging, accountingEquation, buildClosingJournal, retentionAmount,
} = require('../src/accounting');
const { CHART, DEFAULT_SETTINGS, parentCode } = require('../src/plan');
const { buildAtsXml } = require('../src/ats');

test('cédula y RUC ecuatorianos', () => {
  assert.equal(validateCedula('1710034065').ok, true);
  assert.equal(validateCedula('1710034066').ok, false);
  const cedula = makeCedula('05', '1912456');
  assert.equal(validateCedula(cedula).ok, true);
  assert.equal(validateRuc(makeRucNatural(cedula)).ok, true);
  const ruc = makeRucPrivada('17', '200188');
  const checked = validateRuc(ruc);
  assert.equal(checked.ok, true, checked.error);
  assert.equal(checked.person, 'PRIVADA');
  assert.equal(validateRuc('1799999999001').ok, false);
});

test('el plan de cuentas tiene padre y las cuentas de enlace existen', () => {
  const codes = new Set(CHART.map((a) => a.code));
  for (const account of CHART) {
    const parent = parentCode(account.code);
    if (parent) assert.equal(codes.has(parent), true, parent);
  }
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (key.startsWith('cuenta_')) assert.equal(codes.has(value), true, key);
  }
});

test('IVA 15% y 0% por línea, con descuento e ICE', () => {
  const totals = summarizeLines([
    { qty: 2, priceCents: 1000, discountCents: 200, ivaRate: 15, iceRate: 0, kind: 'BIEN', inventoriable: true },
    { qty: 1, priceCents: 500, discountCents: 0, ivaRate: 0, iceRate: 0, kind: 'BIEN', inventoriable: true },
    { qty: 1, priceCents: 1000, discountCents: 0, ivaRate: 15, iceRate: 10, kind: 'SERVICIO', inventoriable: false },
  ]);
  assert.equal(totals.base15Goods, 1800);
  assert.equal(totals.base0Goods, 500);
  assert.equal(totals.base15Services, 1000);
  assert.equal(totals.iceCents, 100);
  assert.equal(totals.ivaCents, Math.round(1800 * 0.15) + Math.round(1100 * 0.15));
  assert.equal(totals.totalCents, totals.base15 + totals.base0 + totals.iceCents + totals.ivaCents);
});

test('la factura de venta y la de compra cuadran', () => {
  const totals = summarizeLines([{ qty: 2, priceCents: 1000, discountCents: 0, ivaRate: 15, iceRate: 0, kind: 'BIEN', inventoriable: true }]);
  const sale = buildSalesJournal({ totals, counterAccount: 'clientes', partyId: 1, cogs: 1200, retIva: 50, retRenta: 30 });
  assert.equal(sale.lines.reduce((s, l) => s + l.debitCents, 0), sale.lines.reduce((s, l) => s + l.creditCents, 0));
  assert.equal(sale.lines.find((l) => l.account === 'clientes').debitCents, totals.totalCents - 80);
  const back = buildSalesReturnJournal({ totals, counterAccount: 'clientes', partyId: 1, cogs: 1200 });
  assert.equal(back.total, back.lines.reduce((s, l) => s + l.debitCents, 0));
  const purchase = buildPurchaseJournal({ totals, counterAccount: 'proveedores', partyId: 2 });
  assert.equal(purchase.lines.find((l) => l.account === 'inventario').debitCents, totals.capitalizableCents);
  assert.equal(purchase.total, totals.totalCents);
});

test('aplicación secuencial y cartera por tramos', () => {
  const seq = applySequential([
    { id: 1, balanceCents: 100, dueDate: '2026-01-01', docDate: '2026-01-01' },
    { id: 2, balanceCents: 40, dueDate: '2026-02-01', docDate: '2026-02-01' },
    { id: 3, balanceCents: 25, dueDate: '2026-03-01', docDate: '2026-03-01' },
  ], 120);
  assert.deepEqual(seq.applications.map((a) => a.amountCents), [100, 20]);
  assert.equal(seq.unappliedCents, 0);
  const aging = buildAging([
    { dueDate: '2026-11-01', balanceCents: 10, docDate: '2026-10-01' },
    { dueDate: '2026-10-01', balanceCents: 20, docDate: '2026-09-01' },
    { dueDate: '2026-08-01', balanceCents: 30, docDate: '2026-07-01' },
    { dueDate: '2026-05-01', balanceCents: 40, docDate: '2026-04-01' },
  ], '2026-10-28');
  assert.equal(aging.buckets.find((b) => b.id === 'por_vencer').cents, 10);
  assert.equal(aging.buckets.find((b) => b.id === '0-30').cents, 20);
  assert.equal(aging.buckets.find((b) => b.id === '61-90').cents, 30);
  assert.equal(aging.buckets.find((b) => b.id === '>150').cents, 40);
});

test('la ecuación contable y el cierre', () => {
  const eq = accountingEquation({
    ACTIVO: { debit: 1500, credit: 200 },
    PASIVO: { debit: 50, credit: 400 },
    PATRIMONIO: { debit: 0, credit: 700 },
    INGRESO: { debit: 0, credit: 500 },
    GASTO: { debit: 250, credit: 0 },
  });
  assert.equal(eq.difference, 0);
  assert.equal(eq.balanced, true);
  const close = buildClosingJournal([
    { code: '4.1.01.01', debitCents: 0, creditCents: 1000 },
    { code: '5.2.02.01', debitCents: 400, creditCents: 0 },
  ]);
  assert.equal(close.lines.find((l) => l.account === 'utilidad').creditCents, 600);
  assert.equal(close.total, 1000);
});

test('costo promedio del kardex', () => {
  let state = applyIn({ stockQty: 0, stockValueCents: 0 }, 10, 100000);
  state = applyIn(state, 10, 200000);
  assert.equal(state.avgCostCents, 15000);
  const sold = applyOut(state, 5);
  assert.equal(sold.costCents, 75000);
  assert.equal(sold.stockQty, 15);
  assert.equal(sold.stockValueCents, 225000);
});

test('rol de pagos IESS, décimos y fondos de reserva', () => {
  const line = calcEmployeePayroll({
    id: 1, name: 'Ana', salaryCents: 50000, reserveFund: true, thirteenthMonthly: true, fourteenthMonthly: true,
  }, { hours50: 0, hours100: 0, bonusesCents: 0, deductionsCents: 0 });
  assert.equal(line.iessPersonalCents, 4725);
  assert.equal(line.iessEmployerCents, 5575);
  assert.equal(line.thirteenthCents, Math.round(50000 / 12));
  assert.equal(line.fourteenthCents, Math.round(47000 / 12));
  assert.equal(line.reserveCents, Math.round(50000 * 0.0833));
  assert.equal(line.netCents, 50000 + line.thirteenthCents + line.fourteenthCents + line.reserveCents - line.iessPersonalCents);
  const journal = buildPayrollJournal([line]);
  const debit = journal.reduce((s, l) => s + l.debitCents, 0);
  const credit = journal.reduce((s, l) => s + l.creditCents, 0);
  assert.equal(debit, credit);

  const accrued = calcEmployeePayroll({
    id: 2, name: 'Carlos', salaryCents: 50000, reserveFund: false, thirteenthMonthly: false, fourteenthMonthly: false,
  }, {});
  assert.equal(accrued.netCents, 50000 - 4725);
  assert.equal(accrued.reserveCents, 0);
  const accruedJournal = buildPayrollJournal([accrued]);
  assert.equal(accruedJournal.reduce((s, l) => s + l.debitCents, 0), accruedJournal.reduce((s, l) => s + l.creditCents, 0));
  assert.ok(accruedJournal.find((l) => l.account === 'decimo3Pagar').creditCents > 0);
});

test('horas extra al 50% y 100%', () => {
  const line = calcEmployeePayroll({
    salaryCents: 24000, reserveFund: false, thirteenthMonthly: false, fourteenthMonthly: false,
  }, { hours50: 2, hours100: 1 });
  const hourly = 24000 / 240;
  assert.equal(line.overtimeCents, Math.round(hourly * 1.5 * 2) + Math.round(hourly * 2 * 1));
});

test('retención y ATS', () => {
  assert.equal(retentionAmount(100000, 1.75), 1750);
  const xml = buildAtsXml({
    company: { ruc: '0591234567001', name: 'DEMO', establecimiento: '001' },
    year: 2026, month: 10,
    purchases: [{ docType: 'FC', idType: 'RUC', identification: '1791234567001', date: '2026-10-02', docNumber: '001-001-000000001', base15: 100000, base0: 0, iva: 15000, ice: 0, sustento: '01', retenciones: [{ tax: 'RENTA', code: '312', baseCents: 100000, rate: 1.75, amountCents: 1750 }] }],
    sales: [{ docType: 'FV', idType: 'CEDULA', identification: '1710034065', base15: 20000, base0: 0, iva: 3000, ice: 0, establecimiento: '001' }],
  });
  assert.match(xml, /<IdInformante>0591234567001<\/IdInformante>/);
  assert.match(xml, /<detalleCompras>/);
  assert.match(xml, /<detalleVentas>/);
  assert.match(xml, /<codRetAir>312<\/codRetAir>/);
  assert.equal(parseMoney('1.234,50'), 123450);
  assert.equal(parseMoney('12,5'), 1250);
});
