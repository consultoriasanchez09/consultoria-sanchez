const DEFAULT_RATES = {
  iessPersonal: 0.0945,
  iessEmployer: 0.1115,
  reserveFund: 0.0833,
  sbuCents: 47000,
};

function calcEmployeePayroll(emp, input = {}, rates = DEFAULT_RATES) {
  const salary = Math.round(emp.salaryCents || 0);
  const hours50 = Number(input.hours50 || 0);
  const hours100 = Number(input.hours100 || 0);
  if (hours50 < 0 || hours100 < 0) throw new Error('Las horas extra no pueden ser negativas.');
  const hourly = salary / 240;
  const overtime = Math.round(hourly * 1.5 * hours50) + Math.round(hourly * 2 * hours100);
  const bonuses = Math.round(input.bonusesCents || 0);
  const deductions = Math.round(input.deductionsCents || 0);
  if (bonuses < 0 || deductions < 0) throw new Error('Bonificaciones y deducciones no pueden ser negativas.');
  const iessBase = salary + overtime;
  const iessPersonal = Math.round(iessBase * rates.iessPersonal);
  const iessEmployer = Math.round(iessBase * rates.iessEmployer);
  const thirteenth = Math.round(salary / 12);
  const fourteenth = Math.round(rates.sbuCents / 12);
  const reserveMonthly = !!emp.reserveFund;
  const reserve = reserveMonthly ? Math.round(iessBase * rates.reserveFund) : 0;
  const thirteenthMonthly = emp.thirteenthMonthly !== false && emp.thirteenthMonthly !== 0;
  const fourteenthMonthly = emp.fourteenthMonthly !== false && emp.fourteenthMonthly !== 0;
  const net = salary + overtime + bonuses
    + (thirteenthMonthly ? thirteenth : 0)
    + (fourteenthMonthly ? fourteenth : 0)
    + (reserveMonthly ? reserve : 0)
    - iessPersonal - deductions;
  if (net < 0) throw new Error(`El líquido a recibir de ${emp.name || 'un empleado'} queda negativo.`);
  return {
    employeeId: emp.id,
    name: emp.name,
    salaryCents: salary,
    hours50,
    hours100,
    overtimeCents: overtime,
    bonusesCents: bonuses,
    thirteenthCents: thirteenth,
    fourteenthCents: fourteenth,
    reserveCents: reserve,
    iessPersonalCents: iessPersonal,
    iessEmployerCents: iessEmployer,
    deductionsCents: deductions,
    netCents: net,
    thirteenthMonthly,
    fourteenthMonthly,
    reserveMonthly,
  };
}

function sumPayroll(lines) {
  const keys = ['salaryCents','overtimeCents','bonusesCents','thirteenthCents','fourteenthCents','reserveCents','iessPersonalCents','iessEmployerCents','deductionsCents','netCents'];
  const tot = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const line of lines) for (const k of keys) tot[k] += line[k] || 0;
  return tot;
}

function buildPayrollJournal(lines) {
  const acc = {
    sueldos: 0, horas: 0, bonos: 0, decimo3: 0, decimo4: 0, fondos: 0, patronal: 0,
    iessPersonal: 0, iessPatronal: 0, decimo3Pagar: 0, decimo4Pagar: 0, fondosPagar: 0,
    anticipos: 0, neto: 0,
  };
  for (const l of lines) {
    acc.sueldos += l.salaryCents;
    acc.horas += l.overtimeCents;
    acc.bonos += l.bonusesCents;
    acc.decimo3 += l.thirteenthCents;
    acc.decimo4 += l.fourteenthCents;
    acc.fondos += l.reserveCents;
    acc.patronal += l.iessEmployerCents;
    acc.iessPersonal += l.iessPersonalCents;
    acc.iessPatronal += l.iessEmployerCents;
    if (!l.thirteenthMonthly) acc.decimo3Pagar += l.thirteenthCents;
    if (!l.fourteenthMonthly) acc.decimo4Pagar += l.fourteenthCents;
    if (!l.reserveMonthly) acc.fondosPagar += l.reserveCents;
    acc.anticipos += l.deductionsCents;
    acc.neto += l.netCents;
  }
  const jl = [];
  const add = (account, debit, credit) => {
    if (debit || credit) jl.push({ account, debitCents: debit, creditCents: credit });
  };
  add('sueldos', acc.sueldos, 0);
  add('horasExtra', acc.horas, 0);
  add('bonificaciones', acc.bonos, 0);
  add('decimo3', acc.decimo3, 0);
  add('decimo4', acc.decimo4, 0);
  add('fondosReserva', acc.fondos, 0);
  add('aportePatronal', acc.patronal, 0);
  add('iessPersonal', 0, acc.iessPersonal);
  add('iessPatronal', 0, acc.iessPatronal);
  add('decimo3Pagar', 0, acc.decimo3Pagar);
  add('decimo4Pagar', 0, acc.decimo4Pagar);
  add('fondosPagar', 0, acc.fondosPagar);
  add('anticipoEmpleados', 0, acc.anticipos);
  add('sueldosPagar', 0, acc.neto);
  return jl;
}

module.exports = { DEFAULT_RATES, calcEmployeePayroll, sumPayroll, buildPayrollJournal };
