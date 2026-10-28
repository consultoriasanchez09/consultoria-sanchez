process.env.NODE_ENV = 'test';
process.env.SQLITE_PATH = ':memory:';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { initDb } = require('../src/db');
const { ensureSchema } = require('../src/schema');
const { makeRucPrivada, makeCedula } = require('../src/ecuador');
const { provisionCompany, saveParty, saveProduct, setInitialStock } = require('../src/company');
const { postDocument } = require('../src/posting');
const { postManualJournal } = require('../src/ledger');
const { postSettlement } = require('../src/treasury');
const { postPayroll } = require('../src/payroll-run');
const { balanceSheet, trialBalance, crosscheck, equation, form104 } = require('../src/reports');
const { backupCompany, restoreCompany } = require('../src/backup');
const { getDb } = require('../src/db');

test('asientos, inventario, nómina, balance y respaldo', async () => {
  await initDb();
  await ensureSchema();
  const companyId = await provisionCompany({
    name: 'Prueba Contable Cía. Ltda.',
    ruc: makeRucPrivada('05', '100001'),
    obligado: true,
    regimen: 'GENERAL',
    isDemo: true,
  });
  const client = await saveParty(companyId, { kind: 'CLIENTE', idType: 'CEDULA', identification: makeCedula('05', '1912456'), name: 'Cliente Prueba', creditDays: 30 });
  const supplier = await saveParty(companyId, { kind: 'PROVEEDOR', idType: 'RUC', identification: makeRucPrivada('17', '200188'), name: 'Proveedor Prueba', creditDays: 30 });
  const employee = await saveParty(companyId, {
    kind: 'EMPLEADO', idType: 'CEDULA', identification: makeCedula('05', '1789012'), name: 'Empleado Prueba',
    salaryCents: 50000, reserveFund: true, thirteenthMonthly: true, fourteenthMonthly: true, hireDate: '2024-01-01',
  });
  const product = await saveProduct(companyId, { code: 'A1', name: 'Producto prueba', kind: 'BIEN', ivaRate: 15, priceCents: 1500 });
  await setInitialStock({ companyId, productId: product.id, qty: 10, valueCents: 50000, date: '2026-01-02' });
  await postManualJournal({
    companyId, date: '2026-01-02', description: 'Apertura',
    lines: [
      { code: '1.1.01.01', debitCents: 100000, creditCents: 0 },
      { code: '1.1.03.01', debitCents: 50000, creditCents: 0 },
      { code: '3.1.01.01', debitCents: 0, creditCents: 150000 },
    ],
  });
  const purchase = await postDocument({
    companyId, docType: 'FC', date: '2026-02-01', partyId: supplier.id, paymentMethod: 'CREDITO',
    lines: [{ productId: product.id, qty: 10, priceCents: 800, ivaRate: 15 }],
  });
  assert.equal(purchase.journal.reduce((s, l) => s + l.debitCents, 0), purchase.journal.reduce((s, l) => s + l.creditCents, 0));
  const sale = await postDocument({
    companyId, docType: 'FV', date: '2026-02-10', dueDate: '2026-03-10', partyId: client.id, paymentMethod: 'CREDITO',
    lines: [{ productId: product.id, qty: 4, priceCents: 1500, discountCents: 100, ivaRate: 15 }],
  });
  assert.equal(sale.totals.base15Cents, 4 * 1500 - 100);
  assert.equal(sale.totals.ivaCents, Math.round(sale.totals.base15Cents * 0.15));
  assert.equal(sale.journal.reduce((s, l) => s + l.debitCents, 0), sale.journal.reduce((s, l) => s + l.creditCents, 0));

  const open = await getDb().get('SELECT * FROM open_items WHERE document_id = ?', [sale.id]);
  await postSettlement({
    companyId, kind: 'COBRO', side: 'AR', partyId: client.id, date: '2026-02-20', method: 'EFECTIVO',
    amountCents: 1000, applications: [{ openItemId: open.id, amountCents: 1000 }],
  });
  await postDocument({
    companyId, docType: 'RET', date: '2026-02-05', partyId: supplier.id, relatedDocumentId: purchase.id,
    retentions: [{ tax: 'RENTA', code: '307', baseCents: 8000, rate: 2 }],
  });
  const payroll = await postPayroll({ companyId, year: 2026, month: 2, items: [{ employeeId: employee.id, hours50: 2, bonuses: '10.00' }] });
  assert.ok(payroll.totals.netCents > 0);

  const eq = await equation(companyId, '2026-02-28');
  assert.equal(eq.balanced, true, JSON.stringify(eq));
  const trial = await trialBalance(companyId, '2026-01-01', '2026-02-28', false);
  assert.equal(trial.totals.endDebit, trial.totals.endCredit);
  assert.equal(trial.totals.debit, trial.totals.credit);
  const sheet = await balanceSheet(companyId, '2026-02-28');
  assert.equal(sheet.balanced, true, JSON.stringify({ a: sheet.totalAssets, b: sheet.totalLiabilitiesAndEquity, d: sheet.difference }));
  const cross = await crosscheck(companyId, '2026-02-28');
  for (const item of cross.items) {
    if (item.name === 'Bancos') continue;
    assert.equal(item.differenceCents, 0, item.name + ' ' + JSON.stringify(item));
  }
  const tax = await form104(companyId, 2026, 2);
  assert.equal(tax.sales15, sale.totals.base15Cents);
  assert.ok(tax.ivaSales > 0);

  const other = await provisionCompany({ name: 'Otra Empresa S.A.', ruc: makeRucPrivada('09', '100002'), obligado: true, isDemo: true });
  const otherEq = await equation(other, '2026-02-28');
  assert.equal(otherEq.assets, 0);

  const snap = await backupCompany(companyId);
  await postDocument({
    companyId, docType: 'FV', date: '2026-02-25', partyId: client.id, paymentMethod: 'EFECTIVO',
    lines: [{ productId: product.id, qty: 1, priceCents: 1500, ivaRate: 15 }],
  });
  await restoreCompany(companyId, snap);
  const count = await getDb().get(`SELECT COUNT(*) AS n FROM documents WHERE company_id = ? AND doc_type = 'FV'`, [companyId]);
  assert.equal(Number(count.n), 1);
  const after = await equation(companyId, '2026-02-28');
  assert.equal(after.balanced, true);
});
