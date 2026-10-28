process.env.NODE_ENV = 'test';
process.env.SQLITE_PATH = ':memory:';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { initDb } = require('../src/db');
const { ensureSchema } = require('../src/schema');
const { seedIfEmpty } = require('../src/seed');
const { getDb } = require('../src/db');
const { equation, crosscheck, balanceSheet, trialBalance } = require('../src/reports');

test('las empresas DEMO quedan separadas y con libros cuadrados', async () => {
  await initDb();
  await ensureSchema();
  await seedIfEmpty();
  const companies = await getDb().all('SELECT * FROM companies ORDER BY name');
  assert.equal(companies.length, 2);
  assert.ok(companies.every((c) => c.is_demo === 1 && c.name.startsWith('DEMO ·')));
  for (const company of companies) {
    const eq = await equation(company.id, '2026-10-28');
    assert.equal(eq.balanced, true, company.name + ' ' + JSON.stringify(eq));
    const sheet = await balanceSheet(company.id, '2026-10-28');
    assert.equal(sheet.balanced, true, company.name);
    assert.ok(sheet.totalAssets > 0, company.name);
    const trial = await trialBalance(company.id, '2026-01-01', '2026-10-28', true);
    assert.equal(trial.totals.endDebit, trial.totals.endCredit, company.name);
    const cross = await crosscheck(company.id, '2026-10-28');
    for (const item of cross.items) assert.equal(item.differenceCents, 0, company.name + ' ' + item.name);
  }
  const [a, b] = companies;
  const salesA = await getDb().get(`SELECT COUNT(*) AS n FROM documents WHERE company_id = ? AND doc_type = 'FV'`, [a.id]);
  const salesB = await getDb().get(`SELECT COUNT(*) AS n FROM documents WHERE company_id = ? AND doc_type = 'FV'`, [b.id]);
  assert.notEqual(Number(salesA.n), Number(salesB.n));
});
