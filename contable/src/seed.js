const { insert } = require('./db');
const { db, isoNow } = require('./ctx');
const { makeCedula, makeRucPrivada } = require('./ecuador');
const { createUser, provisionCompany, saveParty, saveProduct, setInitialStock } = require('./company');
const { postDocument } = require('./posting');
const { postManualJournal, closeYear } = require('./ledger');
const { postBankAccount, postBankMovement, postSettlement } = require('./treasury');
const { postPayroll } = require('./payroll-run');

function pad(n) { return String(n).padStart(2, '0'); }

async function seedIfEmpty() {
  const row = await db().get('SELECT COUNT(*) AS n FROM users');
  if (Number(row.n) > 0) return { seeded: false };
  await db().tx(async () => {
    const admin = await createUser({
      username: 'admin',
      password: process.env.ADMIN_PASSWORD || 'Consultora2026!',
      name: 'Glenda Sánchez',
      role: 'admin',
    });
    const auxiliar = await createUser({ username: 'auxiliar', password: 'Auxiliar2026!', name: 'Auxiliar contable', role: 'auxiliar' });
    const consulta = await createUser({ username: 'consulta', password: 'Consulta2026!', name: 'Usuario de consulta', role: 'consulta' });
    const first = await seedComercial(admin.id);
    const second = await seedServicios(admin.id);
    for (const user of [auxiliar, consulta]) {
      await db().run('INSERT INTO user_companies (user_id, company_id) VALUES (?, ?)', [user.id, first]);
      await db().run('INSERT INTO user_companies (user_id, company_id) VALUES (?, ?)', [user.id, second]);
    }
  });
  return { seeded: true };
}

async function seedComercial(userId) {
  const companyId = await provisionCompany({
    name: 'DEMO · Comercial Andina Cía. Ltda.',
    commercialName: 'Comercial Andina',
    ruc: makeRucPrivada('05', '120045'),
    address: 'Calle 10 de Agosto y Rocafuerte',
    city: 'La Maná',
    province: 'Cotopaxi',
    phone: '0991002001',
    email: 'contabilidad@comercial-andina.demo',
    obligado: true,
    regimen: 'GENERAL',
    agenteRetencion: true,
    resolucionAgente: 'NAC-DNCRASC26-00000123',
    tipoContribuyente: 'SOCIEDAD',
    isDemo: true,
    establecimiento: '001',
    puntoEmision: '001',
  }, userId);

  const consumidor = await party(companyId, { kind: 'CLIENTE', idType: 'CONSUMIDOR_FINAL', identification: '9999999999999', name: 'CONSUMIDOR FINAL', personType: 'NATURAL' });
  const maria = await party(companyId, { kind: 'CLIENTE', idType: 'CEDULA', identification: makeCedula('05', '1912456'), name: 'María Elena Paredes', personType: 'NATURAL', address: 'Barrio El Carmen', city: 'La Maná', creditDays: 30, email: 'maria.paredes@correo.demo' });
  const roble = await party(companyId, { kind: 'CLIENTE', idType: 'RUC', identification: makeRucPrivada('17', '200188'), name: 'Distribuidora El Roble Cía. Ltda.', commercialName: 'El Roble', personType: 'JURIDICA', creditDays: 45, address: 'Av. Naciones Unidas 120', city: 'Quito' });
  const molinos = await party(companyId, { kind: 'PROVEEDOR', idType: 'RUC', identification: makeRucPrivada('17', '445521'), name: 'Molinos del Valle S.A.', personType: 'JURIDICA', creditDays: 30, address: 'Panamericana Norte km 12', city: 'Quito' });
  const empaques = await party(companyId, { kind: 'PROVEEDOR', idType: 'RUC', identification: makeRucPrivada('09', '112244'), name: 'Empaques Costa Cía. Ltda.', personType: 'JURIDICA', creditDays: 20, city: 'Guayaquil' });
  await party(companyId, { kind: 'BENEFICIARIO', idType: 'CEDULA', identification: makeCedula('05', '1678901'), name: 'Luis Andrade Beneficiario', personType: 'NATURAL' });
  await party(companyId, { kind: 'EMPLEADO', idType: 'CEDULA', identification: makeCedula('05', '1789012'), name: 'Ana Lucía Vega', personType: 'NATURAL', position: 'Asistente administrativa', department: 'Administración', hireDate: '2024-03-01', salaryCents: 55000, reserveFund: true, thirteenthMonthly: true, fourteenthMonthly: true });
  await party(companyId, { kind: 'EMPLEADO', idType: 'CEDULA', identification: makeCedula('05', '1890123'), name: 'Carlos Mendoza', personType: 'NATURAL', position: 'Bodeguero', department: 'Operaciones', hireDate: '2026-02-01', salaryCents: 52000, reserveFund: false, thirteenthMonthly: false, fourteenthMonthly: false });

  const arz = await product(companyId, { code: 'ARZ', name: 'Arroz superior 5 kg', kind: 'BIEN', unit: 'SACO', ivaRate: 15, priceCents: 1250 });
  const ace = await product(companyId, { code: 'ACE', name: 'Aceite vegetal 1 L', kind: 'BIEN', unit: 'UND', ivaRate: 15, priceCents: 1400 });
  const azu = await product(companyId, { code: 'AZU', name: 'Azúcar 1 kg', kind: 'BIEN', unit: 'UND', ivaRate: 0, priceCents: 650 });
  const har = await product(companyId, { code: 'HAR', name: 'Harina de trigo 1 kg', kind: 'BIEN', unit: 'UND', ivaRate: 15, priceCents: 900 });
  const beb = await product(companyId, { code: 'BEB', name: 'Bebida demo 300 ml', kind: 'BIEN', unit: 'UND', ivaRate: 15, iceRate: 10, priceCents: 180 });
  const fle = await product(companyId, { code: 'FLE', name: 'Servicio de distribución', kind: 'SERVICIO', unit: 'UND', ivaRate: 15, priceCents: 2500, inventoriable: false });

  const opening = [
    [arz, 200, 800],
    [ace, 100, 900],
    [azu, 150, 400],
    [har, 80, 500],
    [beb, 50, 100],
  ];
  let inventory = 0;
  for (const [id, qty, cost] of opening) {
    const value = qty * cost;
    inventory += value;
    await setInitialStock({ companyId, productId: id, qty, valueCents: value, date: '2024-01-02', note: 'Inventario inicial DEMO' });
  }
  const caja = 200000;
  const bancos = 1200000;
  await postManualJournal({
    companyId, userId, date: '2024-01-02', description: 'Asiento de apertura DEMO',
    lines: [
      { code: '1.1.01.01', debitCents: caja, creditCents: 0 },
      { code: '1.1.01.02', debitCents: bancos, creditCents: 0 },
      { code: '1.1.03.01', debitCents: inventory, creditCents: 0 },
      { code: '3.1.01.01', debitCents: 0, creditCents: caja + bancos + inventory },
    ],
  });
  const bank = await postBankAccount({
    companyId, name: 'Cuenta corriente', bankName: 'Banco del Pacífico', accountNumber: '2100456789',
    ledgerCode: '1.1.01.02', openingCents: bancos, openingDate: '2024-01-02',
  });

  const history = {
    2024: [320000, 410000, 280000, 450000, 390000, 520000],
    2025: [380000, 460000, 350000, 510000, 470000, 580000],
  };
  for (const year of [2024, 2025]) {
    for (let i = 0; i < history[year].length; i += 1) {
      const month = 5 + i;
      const base = history[year][i];
      const iva = Math.round(base * 0.15);
      const rent = Math.round(base * 0.35);
      await postDocument({
        companyId, userId, docType: 'FV', date: `${year}-${pad(month)}-15`, partyId: consumidor,
        paymentMethod: 'EFECTIVO', sriPayCode: '01',
        lines: [{ productId: fle, qty: 1, priceCents: base, ivaRate: 15 }],
      });
      await postManualJournal({
        companyId, userId, date: `${year}-${pad(month)}-20`, description: `Declaración y pago de IVA ${pad(month)}/${year}`,
        lines: [{ code: '2.1.02.01', debitCents: iva, creditCents: 0 }, { code: '1.1.01.01', debitCents: 0, creditCents: iva }],
      });
      await postManualJournal({
        companyId, userId, date: `${year}-${pad(month)}-28`, description: `Arriendo ${pad(month)}/${year}`,
        lines: [{ code: '5.2.02.01', debitCents: rent, creditCents: 0 }, { code: '1.1.01.01', debitCents: 0, creditCents: rent }],
      });
    }
    await closeYear({ companyId, userId, year });
  }

  await postBankMovement({
    companyId, userId, bankAccountId: bank.id, kind: 'DEPOSITO', date: '2026-03-05', amountCents: 80000,
    description: 'Depósito de caja a bancos', reference: 'DEP-2026-001',
  });

  const sales = [
    { m: 5, day: 12, due: '2026-05-20', party: roble, lines: [[arz, 20], [ace, 10], [azu, 15]], extra: 280000 },
    { m: 6, day: 10, due: '2026-06-15', party: maria, lines: [[arz, 18], [ace, 8], [azu, 12]], extra: 300000 },
    { m: 7, day: 14, due: '2026-07-20', party: roble, lines: [[arz, 12], [har, 10], [beb, 10]], extra: 240000 },
    { m: 8, day: 11, due: '2026-08-15', party: maria, lines: [[arz, 16], [ace, 10], [azu, 20]], extra: 320000 },
    { m: 9, day: 9, due: '2026-09-10', party: roble, lines: [[arz, 14], [ace, 8], [har, 12]], extra: 360000 },
    { m: 10, day: 8, due: '2026-10-15', party: maria, lines: [[arz, 10], [ace, 6], [azu, 10], [beb, 8]], extra: 300000, discount: true },
  ];
  let mayDoc = null;
  for (const sale of sales) {
    if (sale.m === 6) {
      const purchase = await postDocument({
        companyId, userId, docType: 'FC', date: '2026-06-02', partyId: molinos, paymentMethod: 'CREDITO', termDays: 30, sustento: '01',
        lines: [
          { productId: arz, qty: 80, priceCents: 800, ivaRate: 15 },
          { productId: ace, qty: 40, priceCents: 900, ivaRate: 15 },
        ],
      });
      await postDocument({
        companyId, userId, docType: 'RET', date: '2026-06-03', partyId: molinos, relatedDocumentId: purchase.id,
        retentions: [
          { tax: 'RENTA', code: '312', base: '1000.00', rate: 1.75 },
          { tax: 'IVA', code: '725', base: '150.00', rate: 30 },
        ],
      });
    }
    if (sale.m === 8) {
      await postDocument({
        companyId, userId, docType: 'FC', date: '2026-08-03', partyId: empaques, paymentMethod: 'CREDITO', termDays: 20,
        lines: [
          { productId: azu, qty: 60, priceCents: 400, ivaRate: 0 },
          { productId: har, qty: 40, priceCents: 500, ivaRate: 15 },
        ],
      });
    }
    const lines = sale.lines.map(([id, qty], index) => ({
      productId: id,
      qty,
      discountCents: sale.discount && index === 0 ? 200 : 0,
    }));
    lines.push({ productId: fle, qty: 1, priceCents: sale.extra, ivaRate: 15 });
    const doc = await postDocument({
      companyId, userId, docType: 'FV', date: `2026-${pad(sale.m)}-${pad(sale.day)}`, dueDate: sale.due,
      partyId: sale.party, paymentMethod: 'CREDITO', termDays: 30, sriPayCode: '20', lines,
    });
    if (sale.m === 5) mayDoc = doc;
    await rentFromBank(companyId, userId, bank.id, sale.m);
  }

  const open = await db().get(`SELECT id, balance_cents FROM open_items WHERE document_id = ?`, [mayDoc.id]);
  await postSettlement({
    companyId, userId, kind: 'COBRO', side: 'AR', partyId: roble, date: '2026-08-01',
    method: 'TRANSFERENCIA', bankAccountId: bank.id, amountCents: 80000,
    applications: [{ openItemId: open.id, amountCents: 80000 }],
    notes: 'Abono parcial DEMO',
  });
  await postDocument({
    companyId, userId, docType: 'FV', date: '2026-10-21', dueDate: '2026-11-20', partyId: roble,
    paymentMethod: 'CREDITO', termDays: 30,
    lines: [{ productId: fle, qty: 1, priceCents: 45000, ivaRate: 15 }, { productId: arz, qty: 6, discountCents: 0 }],
  });
  await postDocument({
    companyId, userId, docType: 'NV', date: '2026-10-22', partyId: consumidor, paymentMethod: 'EFECTIVO', sriPayCode: '01',
    lines: [{ productId: azu, qty: 3 }],
  });
  await postDocument({
    companyId, userId, docType: 'COT', date: '2026-10-24', partyId: maria, paymentMethod: 'CREDITO',
    notes: 'Cotización de demostración, no contabiliza.',
    lines: [{ productId: ace, qty: 20 }, { productId: fle, qty: 1, priceCents: 8000 }],
  });
  await postSettlement({
    companyId, userId, kind: 'ANTICIPO', side: 'AR', partyId: maria, date: '2026-10-05',
    method: 'TRANSFERENCIA', bankAccountId: bank.id, amountCents: 15000, notes: 'Anticipo de cliente DEMO',
  });
  await postPayroll({ companyId, userId, year: 2026, month: 10 });
  await postBankMovement({
    companyId, userId, bankAccountId: bank.id, kind: 'CHEQUE', date: '2026-11-15', amountCents: 12500,
    postdated: true, accountCode: '5.2.02.05', description: 'Cheque posfechado de suministros', reference: '004512',
  });
  return companyId;
}

async function rentFromBank(companyId, userId, bankId, month) {
  const date = `2026-${pad(month)}-27`;
  await postManualJournal({
    companyId, userId, date, description: `Arriendo local ${pad(month)}/2026`,
    lines: [{ code: '5.2.02.01', debitCents: 35000, creditCents: 0 }, { code: '1.1.01.02', debitCents: 0, creditCents: 35000 }],
  });
  await insert('bank_movements', {
    company_id: companyId, bank_account_id: bankId, doc_date: date, kind: 'ND', doc_number: `ARR-${pad(month)}`,
    description: `Arriendo ${pad(month)}/2026`, debit_cents: 0, credit_cents: 35000, status: 'CONTABILIZADO',
    reconciled: 0, postdated: 0, posts_journal: 0, source: 'MANUAL', source_id: null, created_at: isoNow(),
  });
}

async function seedServicios(userId) {
  const companyId = await provisionCompany({
    name: 'DEMO · Servicios del Pacífico S.A.',
    commercialName: 'Pacífico Servicios',
    ruc: makeRucPrivada('13', '330210'),
    address: 'Malecón y Calle 13',
    city: 'Manta',
    province: 'Manabí',
    phone: '0991002002',
    email: 'info@pacifico-servicios.demo',
    obligado: true,
    regimen: 'GENERAL',
    agenteRetencion: false,
    tipoContribuyente: 'SOCIEDAD',
    isDemo: true,
  }, userId);
  const cliente = await party(companyId, { kind: 'CLIENTE', idType: 'RUC', identification: makeRucPrivada('13', '808811'), name: 'Hotel Bahía Azul S.A.', personType: 'JURIDICA', creditDays: 15, city: 'Manta' });
  const cons = await product(companyId, { code: 'CONS', name: 'Consultoría tributaria', kind: 'SERVICIO', unit: 'HORA', ivaRate: 15, priceCents: 4500, inventoriable: false });
  const capa = await product(companyId, { code: 'CAPA', name: 'Capacitación contable', kind: 'SERVICIO', unit: 'HORA', ivaRate: 15, priceCents: 3000, inventoriable: false });
  await party(companyId, { kind: 'EMPLEADO', idType: 'CEDULA', identification: makeCedula('13', '1900001'), name: 'Andrea Cedeño', position: 'Consultora', department: 'Servicios', hireDate: '2025-01-15', salaryCents: 70000, reserveFund: true, thirteenthMonthly: true, fourteenthMonthly: true });
  await postManualJournal({
    companyId, userId, date: '2026-01-05', description: 'Apertura DEMO servicios',
    lines: [
      { code: '1.1.01.01', debitCents: 50000, creditCents: 0 },
      { code: '1.1.01.02', debitCents: 400000, creditCents: 0 },
      { code: '3.1.01.01', debitCents: 0, creditCents: 450000 },
    ],
  });
  const bank = await postBankAccount({
    companyId, name: 'Cuenta de ahorros', bankName: 'Banco Pichincha', accountNumber: '3300112233',
    ledgerCode: '1.1.01.02', openingCents: 400000, openingDate: '2026-01-05',
  });
  const months = [5, 6, 7, 8, 9, 10];
  const hours = [12, 18, 10, 20, 16, 14];
  for (let i = 0; i < months.length; i += 1) {
    await postDocument({
      companyId, userId, docType: 'FV', date: `2026-${pad(months[i])}-18`, dueDate: `2026-${pad(months[i] + (months[i] === 10 ? 0 : 1))}-05`,
      partyId: cliente, paymentMethod: i % 2 === 0 ? 'CREDITO' : 'TRANSFERENCIA', bankAccountId: i % 2 ? bank.id : null,
      lines: [{ productId: cons, qty: hours[i] }, { productId: capa, qty: 4 }],
    });
  }
  await postPayroll({ companyId, userId, year: 2026, month: 9 });
  return companyId;
}

function party(companyId, fields) { return saveParty(companyId, fields).then((row) => row.id); }
function product(companyId, fields) { return saveProduct(companyId, fields).then((row) => row.id); }

module.exports = { seedIfEmpty };
