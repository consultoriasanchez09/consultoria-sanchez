const { insert } = require('./db');
const { AppError } = require('./errors');
const { parseMoney } = require('./money');
const { calcEmployeePayroll, buildPayrollJournal, sumPayroll } = require('./payroll');
const { db, isoNow, loadCtx, assertPeriodOpen, insertJournal, decorateJournal } = require('./ctx');

function ratesOf(settings) {
  return {
    iessPersonal: Number(settings.iess_personal || 0.0945),
    iessEmployer: Number(settings.iess_patronal || 0.1115),
    reserveFund: Number(settings.fondos_reserva || 0.0833),
    sbuCents: Number(settings.sbu_cents || 47000),
  };
}

function mapEmp(row) {
  return {
    id: row.id,
    name: row.name,
    salaryCents: row.salary_cents,
    reserveFund: !!row.reserve_fund,
    thirteenthMonthly: !!row.thirteenth_monthly,
    fourteenthMonthly: !!row.fourteenth_monthly,
  };
}

async function preparePayroll(input) {
  const ctx = await loadCtx(input.companyId);
  const year = Number(input.year);
  const month = Number(input.month);
  if (!year || month < 1 || month > 12) throw new AppError('Indique año y mes del rol.');
  const employees = await db().all(
    `SELECT * FROM parties WHERE company_id = ? AND kind = 'EMPLEADO' AND active = 1 ORDER BY name`,
    [input.companyId]
  );
  const extras = new Map((input.items || []).map((item) => [Number(item.employeeId), item]));
  const selected = input.items && input.items.length
    ? employees.filter((emp) => extras.has(emp.id))
    : employees;
  if (!selected.length) throw new AppError('No hay empleados activos para el rol.');
  const rates = ratesOf(ctx.settings);
  const lines = selected.map((emp) => {
    const extra = extras.get(emp.id) || {};
    return calcEmployeePayroll(mapEmp(emp), {
      hours50: Number(extra.hours50 || 0),
      hours100: Number(extra.hours100 || 0),
      bonusesCents: extra.bonusesCents != null ? Math.round(Number(extra.bonusesCents)) : parseMoney(extra.bonuses || 0),
      deductionsCents: extra.deductionsCents != null ? Math.round(Number(extra.deductionsCents)) : parseMoney(extra.deductions || 0),
    }, rates);
  });
  let journalLines = buildPayrollJournal(lines);
  if (input.payFrom === 'caja' || input.payFrom === 'bancos') {
    journalLines = journalLines.map((line) => (line.account === 'sueldosPagar' ? { ...line, account: input.payFrom } : line));
  }
  return { ctx, year, month, lines, journalLines, totals: sumPayroll(lines), rates };
}

async function previewPayroll(input) {
  const prepared = await preparePayroll(input);
  return {
    lines: prepared.lines,
    totals: prepared.totals,
    journal: decorateJournal(prepared.ctx, prepared.journalLines),
    rates: prepared.rates,
  };
}

async function postPayroll(input) {
  return db().tx(async () => {
    const prepared = await preparePayroll(input);
    const month = String(prepared.month).padStart(2, '0');
    const date = `${prepared.year}-${month}-${String(new Date(Date.UTC(prepared.year, prepared.month, 0)).getUTCDate()).padStart(2, '0')}`;
    await assertPeriodOpen(input.companyId, date);
    const exists = await db().get(
      'SELECT id FROM payroll_runs WHERE company_id = ? AND year = ? AND month = ?',
      [input.companyId, prepared.year, prepared.month]
    );
    if (exists) throw new AppError('Ya existe un rol para ese mes.');
    const entry = await insertJournal(prepared.ctx, {
      date,
      description: `Rol de pagos ${month}/${prepared.year}`,
      source: 'NOMINA',
      userId: input.userId,
      lines: prepared.journalLines,
    });
    const run = await insert('payroll_runs', {
      company_id: input.companyId,
      year: prepared.year,
      month: prepared.month,
      status: 'CONTABILIZADO',
      journal_entry_id: entry.id,
      total_net_cents: prepared.totals.netCents,
      created_at: isoNow(),
    });
    for (const line of prepared.lines) {
      await insert('payroll_lines', {
        run_id: run.lastId,
        employee_id: line.employeeId,
        salary_cents: line.salaryCents,
        hours50: line.hours50,
        hours100: line.hours100,
        overtime_cents: line.overtimeCents,
        bonuses_cents: line.bonusesCents,
        thirteenth_cents: line.thirteenthCents,
        fourteenth_cents: line.fourteenthCents,
        reserve_cents: line.reserveCents,
        iess_personal_cents: line.iessPersonalCents,
        iess_employer_cents: line.iessEmployerCents,
        deductions_cents: line.deductionsCents,
        net_cents: line.netCents,
        thirteenth_monthly: line.thirteenthMonthly ? 1 : 0,
        fourteenth_monthly: line.fourteenthMonthly ? 1 : 0,
        reserve_monthly: line.reserveMonthly ? 1 : 0,
      });
    }
    return { id: run.lastId, journalEntryId: entry.id, totals: prepared.totals, lines: prepared.lines };
  });
}

module.exports = { previewPayroll, postPayroll };
