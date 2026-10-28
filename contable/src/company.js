const bcrypt = require('bcryptjs');
const { insert } = require('./db');
const { AppError } = require('./errors');
const { validateIdentification } = require('./ecuador');
const { CHART, DEFAULT_SETTINGS, parentCode } = require('./plan');
const { db, isoNow, loadCtx } = require('./ctx');
const { roundQty } = require('./inventory');

async function provisionCompany(fields, userId) {
  const ruc = validateIdentification('RUC', fields.ruc);
  if (!ruc.ok) throw new AppError(ruc.error);
  return db().tx(async () => {
    const created = await insert('companies', {
      name: String(fields.name || '').trim(),
      commercial_name: fields.commercialName || fields.commercial_name || fields.name,
      ruc: ruc.normalized,
      address: fields.address || '',
      city: fields.city || '',
      province: fields.province || '',
      phone: fields.phone || '',
      email: fields.email || '',
      obligado: fields.obligado ? 1 : 0,
      regimen: fields.regimen || 'GENERAL',
      agente_retencion: fields.agenteRetencion || fields.agente_retencion ? 1 : 0,
      resolucion_agente: fields.resolucionAgente || fields.resolucion_agente || '',
      tipo_contribuyente: fields.tipoContribuyente || fields.tipo_contribuyente || (ruc.person === 'NATURAL' ? 'NATURAL' : 'SOCIEDAD'),
      is_demo: fields.isDemo || fields.is_demo ? 1 : 0,
      establecimiento: fields.establecimiento || '001',
      punto_emision: fields.puntoEmision || fields.punto_emision || '001',
      ambiente_sri: fields.ambienteSri || '1',
      created_at: isoNow(),
    });
    if (!created.lastId) throw new AppError('No se pudo crear la empresa.');
    if (!String(fields.name || '').trim()) throw new AppError('La razón social es obligatoria.');
    const companyId = created.lastId;
    const ids = new Map();
    for (const account of CHART) {
      const parent = parentCode(account.code);
      const row = await insert('accounts', {
        company_id: companyId,
        parent_id: parent ? ids.get(parent) : null,
        code: account.code,
        name: account.name,
        type: account.type,
        nature: account.nature,
        is_movement: account.isMovement,
        active: 1,
      });
      ids.set(account.code, row.lastId);
    }
    for (const [skey, svalue] of Object.entries(DEFAULT_SETTINGS)) {
      await db().run('INSERT INTO settings (company_id, skey, svalue) VALUES (?, ?, ?)', [companyId, skey, String(svalue)]);
    }
    if (userId) {
      const user = await db().get('SELECT role FROM users WHERE id = ?', [userId]);
      if (user && user.role !== 'admin') {
        await db().run('INSERT INTO user_companies (user_id, company_id) VALUES (?, ?)', [userId, companyId]);
      }
    }
    return companyId;
  });
}

async function updateCompany(companyId, fields) {
  const current = await db().get('SELECT * FROM companies WHERE id = ?', [companyId]);
  if (!current) throw new AppError('Empresa no encontrada.', 404);
  const ruc = validateIdentification('RUC', fields.ruc || current.ruc);
  if (!ruc.ok) throw new AppError(ruc.error);
  const name = String(fields.name || current.name).trim();
  if (!name) throw new AppError('La razón social es obligatoria.');
  await db().run(
    `UPDATE companies SET name=?, commercial_name=?, ruc=?, address=?, city=?, province=?, phone=?, email=?,
      obligado=?, regimen=?, agente_retencion=?, resolucion_agente=?, tipo_contribuyente=?, establecimiento=?, punto_emision=?, ambiente_sri=?
     WHERE id=?`,
    [
      name,
      fields.commercialName ?? fields.commercial_name ?? current.commercial_name,
      ruc.normalized,
      fields.address ?? current.address,
      fields.city ?? current.city,
      fields.province ?? current.province,
      fields.phone ?? current.phone,
      fields.email ?? current.email,
      fields.obligado != null ? (fields.obligado ? 1 : 0) : current.obligado,
      fields.regimen || current.regimen,
      fields.agenteRetencion != null || fields.agente_retencion != null
        ? ((fields.agenteRetencion ?? fields.agente_retencion) ? 1 : 0)
        : current.agente_retencion,
      fields.resolucionAgente ?? fields.resolucion_agente ?? current.resolucion_agente,
      fields.tipoContribuyente ?? fields.tipo_contribuyente ?? current.tipo_contribuyente,
      fields.establecimiento || current.establecimiento,
      fields.puntoEmision || fields.punto_emision || current.punto_emision,
      fields.ambienteSri || fields.ambiente_sri || current.ambiente_sri,
      companyId,
    ]
  );
  return db().get('SELECT * FROM companies WHERE id = ?', [companyId]);
}

async function saveSettings(companyId, values) {
  const ctx = await loadCtx(companyId);
  await db().tx(async () => {
    for (const [skey, svalue] of Object.entries(values || {})) {
      if (skey.startsWith('cuenta_')) {
        const account = ctx.byCode.get(String(svalue));
        if (!account || !account.is_movement) throw new AppError(`La cuenta ${svalue} no es de movimiento.`);
      }
      const exists = await db().get('SELECT 1 AS ok FROM settings WHERE company_id = ? AND skey = ?', [companyId, skey]);
      if (exists) await db().run('UPDATE settings SET svalue = ? WHERE company_id = ? AND skey = ?', [String(svalue), companyId, skey]);
      else await db().run('INSERT INTO settings (company_id, skey, svalue) VALUES (?, ?, ?)', [companyId, skey, String(svalue)]);
    }
  });
  return loadCtx(companyId).then((c) => c.settings);
}

function partyPayload(companyId, fields, current = {}) {
  const kind = fields.kind || current.kind;
  const idType = fields.idType || fields.id_type || current.id_type;
  const ident = validateIdentification(idType, fields.identification ?? current.identification);
  if (!ident.ok) throw new AppError(ident.error);
  const name = String(fields.name ?? current.name ?? '').trim();
  if (!name) throw new AppError('El nombre o razón social es obligatorio.');
  if (kind === 'EMPLEADO') {
    const salary = fields.salaryCents != null ? Math.round(Number(fields.salaryCents)) : (fields.salary != null ? Math.round(Number(fields.salary) * 100) : current.salary_cents);
    if (!(salary > 0)) throw new AppError('Indique el sueldo del empleado.');
  }
  return {
    company_id: companyId,
    kind,
    id_type: idType,
    identification: ident.normalized,
    name,
    commercial_name: fields.commercialName ?? fields.commercial_name ?? current.commercial_name ?? '',
    person_type: fields.personType ?? fields.person_type ?? current.person_type ?? (ident.person === 'NATURAL' || idType === 'CEDULA' ? 'NATURAL' : 'JURIDICA'),
    email: fields.email ?? current.email ?? '',
    phone: fields.phone ?? current.phone ?? '',
    address: fields.address ?? current.address ?? '',
    related_party: (fields.relatedParty ?? fields.related_party ?? current.related_party) ? 1 : 0,
    is_partner: (fields.isPartner ?? fields.is_partner ?? current.is_partner) ? 1 : 0,
    blocked: (fields.blocked ?? current.blocked) ? 1 : 0,
    active: fields.active == null && current.active == null ? 1 : ((fields.active ?? current.active) ? 1 : 0),
    credit_days: Number(fields.creditDays ?? fields.credit_days ?? current.credit_days ?? 0),
    credit_limit_cents: fields.creditLimitCents != null
      ? Math.round(Number(fields.creditLimitCents))
      : (fields.creditLimit != null ? Math.round(Number(fields.creditLimit) * 100) : (current.credit_limit_cents || 0)),
    also_client: (fields.alsoClient ?? fields.also_client ?? current.also_client) ? 1 : 0,
    position: fields.position ?? current.position ?? '',
    department: fields.department ?? current.department ?? '',
    hire_date: fields.hireDate ?? fields.hire_date ?? current.hire_date ?? null,
    salary_cents: fields.salaryCents != null
      ? Math.round(Number(fields.salaryCents))
      : (fields.salary != null ? Math.round(Number(fields.salary) * 100) : (current.salary_cents || 0)),
    reserve_fund: (fields.reserveFund ?? fields.reserve_fund ?? current.reserve_fund) ? 1 : 0,
    thirteenth_monthly: (fields.thirteenthMonthly ?? fields.thirteenth_monthly ?? current.thirteenth_monthly ?? 1) ? 1 : 0,
    fourteenth_monthly: (fields.fourteenthMonthly ?? fields.fourteenth_monthly ?? current.fourteenth_monthly ?? 1) ? 1 : 0,
  };
}

async function saveParty(companyId, fields, id) {
  return db().tx(async () => {
    const current = id ? await db().get('SELECT * FROM parties WHERE id = ? AND company_id = ?', [id, companyId]) : null;
    if (id && !current) throw new AppError('Registro no encontrado.', 404);
    const data = partyPayload(companyId, { ...fields, kind: fields.kind || current?.kind }, current || {});
    if (!['CLIENTE', 'PROVEEDOR', 'BENEFICIARIO', 'EMPLEADO'].includes(data.kind)) throw new AppError('Tipo de maestro no válido.');
    let partyId = id;
    if (id) {
      const keys = Object.keys(data).filter((k) => k !== 'company_id' && k !== 'kind');
      await db().run(
        `UPDATE parties SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND company_id = ?`,
        [...keys.map((k) => data[k]), id, companyId]
      );
    } else {
      const row = await insert('parties', data);
      partyId = row.lastId;
    }
    if (data.kind === 'BENEFICIARIO' && data.also_client) {
      const existing = await db().get(
        `SELECT id FROM parties WHERE company_id = ? AND kind = 'CLIENTE' AND identification = ?`,
        [companyId, data.identification]
      );
      if (!existing) {
        await insert('parties', { ...data, kind: 'CLIENTE', also_client: 0, salary_cents: 0, reserve_fund: 0 });
      }
    }
    return db().get('SELECT * FROM parties WHERE id = ?', [partyId]);
  });
}

async function saveProduct(companyId, fields, id) {
  const code = String(fields.code || '').trim().toUpperCase();
  const name = String(fields.name || '').trim();
  if (!code || !name) throw new AppError('Código y nombre del producto son obligatorios.');
  const kind = fields.kind === 'BIEN' ? 'BIEN' : 'SERVICIO';
  const iva = Number(fields.ivaRate ?? fields.iva_rate ?? 15);
  if (iva !== 15 && iva !== 0) throw new AppError('La tarifa de IVA debe ser 15% o 0%.');
  const inventoriable = kind === 'BIEN' && (fields.inventoriable == null ? true : !!fields.inventoriable);
  const price = fields.priceCents != null ? Math.round(Number(fields.priceCents)) : Math.round(Number(fields.price || 0) * 100);
  if (price < 0) throw new AppError('El precio no puede ser negativo.');
  const payload = {
    code, name, kind, unit: fields.unit || 'UND', inventoriable: inventoriable ? 1 : 0, iva_rate: iva,
    ice_rate: Number(fields.iceRate ?? fields.ice_rate ?? 0),
    price_cents: price,
    active: fields.active == null ? 1 : (fields.active ? 1 : 0),
  };
  if (id) {
    const current = await db().get('SELECT * FROM products WHERE id = ? AND company_id = ?', [id, companyId]);
    if (!current) throw new AppError('Producto no encontrado.', 404);
    await db().run(
      `UPDATE products SET code=?, name=?, kind=?, unit=?, inventoriable=?, iva_rate=?, ice_rate=?, price_cents=?, active=? WHERE id=? AND company_id=?`,
      [payload.code, payload.name, payload.kind, payload.unit, payload.inventoriable, payload.iva_rate, payload.ice_rate, payload.price_cents, payload.active, id, companyId]
    );
    return db().get('SELECT * FROM products WHERE id = ?', [id]);
  }
  const row = await insert('products', { company_id: companyId, ...payload, stock_qty: 0, stock_value_cents: 0, avg_cost_cents: 0 });
  return db().get('SELECT * FROM products WHERE id = ?', [row.lastId]);
}

async function setInitialStock({ companyId, productId, qty, valueCents, date, note }) {
  const product = await db().get('SELECT * FROM products WHERE id = ? AND company_id = ?', [productId, companyId]);
  if (!product) throw new AppError('Producto no encontrado.', 404);
  if (!product.inventoriable) throw new AppError('El producto no es inventariable.');
  if (Number(product.stock_qty) !== 0) throw new AppError('El producto ya tiene stock.');
  const q = roundQty(qty);
  const value = Math.round(valueCents);
  if (!(q > 0) || value < 0) throw new AppError('Cantidad o costo inicial inválido.');
  const avg = Math.round(value / q);
  await db().run(
    'UPDATE products SET stock_qty = ?, stock_value_cents = ?, avg_cost_cents = ? WHERE id = ?',
    [q, value, avg, productId]
  );
  await insert('inventory_moves', {
    company_id: companyId,
    product_id: productId,
    doc_date: date,
    kind: 'APERTURA',
    doc_number: 'APERTURA',
    document_id: null,
    warehouse_doc_id: null,
    description: note || 'Saldo inicial',
    qty_in: q,
    qty_out: 0,
    total_cost_cents: value,
    balance_qty: q,
    balance_value_cents: value,
    avg_cost_cents: avg,
  });
}

async function saveAccount(companyId, fields, id) {
  const code = String(fields.code || '').trim();
  const name = String(fields.name || '').trim();
  if (!code || !name) throw new AppError('Código y nombre de la cuenta son obligatorios.');
  const type = fields.type;
  const nature = fields.nature;
  if (!['ACTIVO', 'PASIVO', 'PATRIMONIO', 'INGRESO', 'GASTO', 'COSTO'].includes(type)) throw new AppError('Tipo de cuenta no válido.');
  if (!['DEUDORA', 'ACREEDORA'].includes(nature)) throw new AppError('Naturaleza no válida.');
  const parent = parentCode(code);
  let parentId = null;
  if (parent) {
    const row = await db().get('SELECT id FROM accounts WHERE company_id = ? AND code = ?', [companyId, parent]);
    if (!row) throw new AppError(`No existe la cuenta padre ${parent}.`);
    parentId = row.id;
  }
  if (id) {
    await db().run(
      'UPDATE accounts SET name = ?, type = ?, nature = ?, is_movement = ?, active = ? WHERE id = ? AND company_id = ?',
      [name, type, nature, fields.isMovement || fields.is_movement ? 1 : 0, fields.active == null ? 1 : (fields.active ? 1 : 0), id, companyId]
    );
    return db().get('SELECT * FROM accounts WHERE id = ?', [id]);
  }
  const row = await insert('accounts', {
    company_id: companyId, parent_id: parentId, code, name, type, nature,
    is_movement: fields.isMovement || fields.is_movement ? 1 : 0, active: 1,
  });
  return db().get('SELECT * FROM accounts WHERE id = ?', [row.lastId]);
}

async function createUser({ username, password, name, role, companyIds }) {
  const user = String(username || '').trim().toLowerCase();
  if (!user || !password || !name) throw new AppError('Usuario, nombre y contraseña son obligatorios.');
  if (!['admin', 'contador', 'auxiliar', 'consulta'].includes(role)) throw new AppError('Rol no válido.');
  const row = await insert('users', {
    username: user,
    password_hash: bcrypt.hashSync(password, 10),
    name: String(name).trim(),
    role,
    active: 1,
    created_at: isoNow(),
  });
  for (const companyId of companyIds || []) {
    await db().run('INSERT INTO user_companies (user_id, company_id) VALUES (?, ?)', [row.lastId, companyId]);
  }
  return db().get('SELECT id, username, name, role, active FROM users WHERE id = ?', [row.lastId]);
}

async function updateUser(id, fields) {
  const current = await db().get('SELECT * FROM users WHERE id = ?', [id]);
  if (!current) throw new AppError('Usuario no encontrado.', 404);
  const role = fields.role || current.role;
  if (!['admin', 'contador', 'auxiliar', 'consulta'].includes(role)) throw new AppError('Rol no válido.');
  await db().run('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?', [
    fields.name || current.name, role, fields.active == null ? current.active : (fields.active ? 1 : 0), id,
  ]);
  if (fields.password) {
    await db().run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(fields.password, 10), id]);
  }
  if (Array.isArray(fields.companyIds)) {
    await db().run('DELETE FROM user_companies WHERE user_id = ?', [id]);
    for (const companyId of fields.companyIds) {
      await db().run('INSERT INTO user_companies (user_id, company_id) VALUES (?, ?)', [id, companyId]);
    }
  }
  return db().get('SELECT id, username, name, role, active FROM users WHERE id = ?', [id]);
}

async function companiesFor(user) {
  if (user.role === 'admin') return db().all('SELECT * FROM companies ORDER BY name');
  return db().all(
    `SELECT c.* FROM companies c JOIN user_companies u ON u.company_id = c.id WHERE u.user_id = ? ORDER BY c.name`,
    [user.id]
  );
}

module.exports = {
  provisionCompany, updateCompany, saveSettings, saveParty, saveProduct, setInitialStock,
  saveAccount, createUser, updateUser, companiesFor, partyPayload,
};
