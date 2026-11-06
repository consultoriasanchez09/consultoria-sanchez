const fs = require('fs');
const path = require('path');

function parseOrigin() {
  const file = path.join(__dirname, '..', 'docs', 'plan_cuentas_origen.tsv');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(1);
  return lines.filter(Boolean).map((line) => {
    const [code, name] = line.split('\t');
    return { code: String(code).replace(/\.+$/, ''), name: String(name).trim() };
  });
}

function upsert(rows, code, name) {
  const found = rows.find((row) => row.code === code);
  if (found) found.name = name;
  else rows.push({ code, name });
}

function remove(rows, code) {
  const index = rows.findIndex((row) => row.code === code);
  if (index >= 0) rows.splice(index, 1);
}

function applyCorrections(rows) {
  const replace = [
    [/INTERNACICONAL/g, 'INTERNACIONAL'],
    [/OFICNA/g, 'OFICINA'],
    [/INTAGIBLES/g, 'INTANGIBLES'],
    [/GANACIAS/g, 'GANANCIAS'],
    [/SUMINSITROS/g, 'SUMINISTROS'],
    [/ARRIENDAMIENTO/g, 'ARRENDAMIENTO'],
  ];
  for (const row of rows) {
    for (const [from, to] of replace) row.name = row.name.replace(from, to);
  }

  const rename = {
    '2.1.4.01.01': 'IVA 15% VENTAS LOCALES',
    '4.1.1.01': 'VENTAS GRAVADAS TARIFA 15%',
    '4.1.1.01.01': 'BIENES TARIFA 15',
    '4.1.1.01.02': 'SERVICIOS TARIFA 15',
    '5.1.1.01': 'COSTO MERCADERIA TARIFA 15%',
    '3.1.6.01': 'RESULTADOS DEL EJERCICIO',
    '1.1.2.01': 'DOCUMENTOS Y CUENTAS POR COBRAR CLIENTES NO RELACIONADOS',
    '1.1.2.02': 'OTRAS CUENTAS POR COBRAR NO RELACIONADAS',
    '1.1.2.01.02': 'CLIENTES NO RELACIONADOS',
    '2.1.1.01.02': 'DOCUMENTOS POR PAGAR A PROVEEDORES',
    '2.1.3.01.01': 'SOCIO 1',
    '3.1.1.01.02': 'SOCIO 2',
    '3.1.2.01.01': 'SOCIO 1',
    '3.1.2.01.02': 'SOCIO 2',
    '5.1.2.03.01': 'APORTE PATRONAL IESS',
    '5.2.1.03.01': 'APORTE PATRONAL IESS',
    '2.1.4.03.03': 'RET. FUENTE 10% PREDOMINA INTELECTO (304)',
    '2.1.4.03.04': 'RET. FUENTE 3% PREDOMINA MANO OBRA (307)',
    '2.1.4.03.05': 'RET. FUENTE 3% PROMOCION Y PUBLICIDAD (309)',
    '2.1.4.03.07': 'RET. FUENTE 3% SERVICIOS MEDIANTE LIQ. COMPRAS (311)',
    '2.1.4.03.08': 'RET. FUENTE 2% TRANSFERENCIA DE BIENES (312)',
    '2.1.4.03.09': 'RET. FUENTE 10% ARRENDAMIENTO BIEN INMUEBLE (320)',
    '2.1.4.03.10': 'RET. FUENTE 2% SEGUROS Y REASEGUROS (322)',
  };
  for (const row of rows) if (rename[row.code]) row.name = rename[row.code];

  remove(rows, '2.1.2.02.01');
  upsert(rows, '2.1.2.01.04', 'BANCO PICHINCHA');
  upsert(rows, '2.1.2.02.01', 'OBLIGACIONES CON INSTITUCIONES DEL EXTERIOR');

  remove(rows, '2.1.1.01.03');
  upsert(rows, '2.1.9', 'ANTICIPOS DE CLIENTES');
  upsert(rows, '2.1.9.01', 'ANTICIPOS DE CLIENTES');
  upsert(rows, '2.1.9.01.01', 'ANTICIPO DE CLIENTES');

  upsert(rows, '1.1.2.03', 'DOCUMENTOS Y CUENTAS POR COBRAR RELACIONADAS');
  upsert(rows, '1.1.2.03.01', 'CLIENTES RELACIONADOS');
  upsert(rows, '1.1.2.04', 'OTRAS CUENTAS POR COBRAR RELACIONADAS');
  upsert(rows, '1.1.2.04.01', 'OTRAS CUENTAS POR COBRAR RELACIONADAS');

  upsert(rows, '2.1.4.02.04', 'RETENCION IVA 10% (721)');
  upsert(rows, '2.1.4.02.05', 'RETENCION IVA 20% (723)');
  upsert(rows, '2.1.4.02.06', 'RETENCION IVA 50% (727)');
  upsert(rows, '2.1.4.02.07', 'IMPUESTO POR PAGAR IVA');

  upsert(rows, '2.1.4.03.12', 'RET. FUENTE 1% OTRAS RETENCIONES APLICABLES (343)');

  remove(rows, '5.1.2.03.02');
  remove(rows, '5.2.1.03.02');
  remove(rows, '2.1.6.01.04');
  upsert(rows, '5.1.2.03.02', 'SEGURO JORNADA PARCIAL');
  upsert(rows, '5.2.1.03.02', 'SEGURO JORNADA PARCIAL');
  remove(rows, '5.1.2.03.03');
  remove(rows, '5.2.1.03.03');

  upsert(rows, '2.2.2', 'PROVISIONES POR BENEFICIOS A EMPLEADOS');
  upsert(rows, '2.2.2.01', 'PROVISIONES POR BENEFICIOS A EMPLEADOS');
  upsert(rows, '2.2.2.01.01', 'JUBILACIÓN PATRONAL');
  upsert(rows, '2.2.2.01.02', 'DESAHUCIO');
  upsert(rows, '2.2.3', 'PASIVO POR IMPUESTOS DIFERIDOS');
  upsert(rows, '2.2.3.01', 'PASIVO POR IMPUESTOS DIFERIDOS');
  upsert(rows, '2.2.3.01.01', 'PASIVO POR IMPUESTOS DIFERIDOS');
  upsert(rows, '5.3', 'GASTO IMPUESTO A LA RENTA Y PARTICIPACIÓN');
  upsert(rows, '5.3.1', 'GASTO IMPUESTO A LA RENTA Y PARTICIPACIÓN');
  upsert(rows, '5.3.1.01', 'PARTICIPACIÓN TRABAJADORES E IMPUESTO A LA RENTA');
  upsert(rows, '5.3.1.01.01', '15% PARTICIPACIÓN TRABAJADORES');
  upsert(rows, '5.3.1.01.02', 'IMPUESTO A LA RENTA CORRIENTE');
  upsert(rows, '5.3.1.01.03', 'IMPUESTO DIFERIDO');
  upsert(rows, '1.2.1.03.07', '(-) DEP. ACUM. EDIFICIOS');
  upsert(rows, '1.2.1.03.08', '(-) DEP. ACUM. HERRAMIENTAS Y ACCESORIOS');
  upsert(rows, '1.2.1.03.09', '(-) DETERIORO ACUMULADO DE PROPIEDAD, PLANTA Y EQUIPO');
  upsert(rows, '5.2.1.18.05', 'DEPRECIACION EDIFICIOS');
  upsert(rows, '5.2.1.18.06', 'DEPRECIACION EQUIPO DE OFICINA');
  upsert(rows, '5.2.1.18.07', 'DEPRECIACION HERRAMIENTAS');
  upsert(rows, '5.2.1.02.08', 'PROVISIÓN JUBILACIÓN PATRONAL');
  upsert(rows, '5.2.1.02.09', 'PROVISIÓN DESAHUCIO');
  upsert(rows, '2.1.4.05', 'ICE POR PAGAR');
  upsert(rows, '2.1.4.05.01', 'ICE POR PAGAR');
  upsert(rows, '2.1.8.01.02', 'CHEQUES GIRADOS POSFECHADOS');
  upsert(rows, '5.1.1.03', 'AJUSTE DE INVENTARIO');
  upsert(rows, '5.1.1.03.01', 'AJUSTE DE INVENTARIO');

  const children = new Set();
  for (const row of rows) {
    const parent = row.code.includes('.') ? row.code.slice(0, row.code.lastIndexOf('.')) : null;
    if (parent) children.add(parent);
  }
  return rows.map((row) => {
    const agrupador = children.has(row.code);
    return {
      code: row.code,
      name: row.name,
      level: row.code.split('.').length,
      agrupador,
      ...classify(row.code, row.name),
    };
  }).sort((a, b) => a.code.split('.').map((part) => part.padStart(4, '0')).join('.').localeCompare(
    b.code.split('.').map((part) => part.padStart(4, '0')).join('.')
  ));
}

function classify(code, name) {
  const root = code.split('.')[0];
  const contra = name.startsWith('(-)') || name.includes('(-)');
  const loss = /P[ÉE]RDIDA/.test(name);
  if (root === '1') return { type: 'ACTIVO', nature: contra ? 'ACREEDORA' : 'DEUDORA' };
  if (root === '2') return { type: 'PASIVO', nature: 'ACREEDORA' };
  if (root === '3') return { type: 'PATRIMONIO', nature: loss ? 'DEUDORA' : 'ACREEDORA' };
  if (root === '4') {
    const contraIncome = contra || /DEVOLUC|DESCUENTO EN VENTAS/.test(name);
    return { type: 'INGRESO', nature: contraIncome ? 'DEUDORA' : 'ACREEDORA' };
  }
  return { type: code.startsWith('5.1') ? 'COSTO' : 'GASTO', nature: 'DEUDORA' };
}

function buildChart() {
  return applyCorrections(parseOrigin());
}

module.exports = { buildChart, classify };
