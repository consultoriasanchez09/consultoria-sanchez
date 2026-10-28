const { AppError } = require('./errors');
const { db } = require('./ctx');
const { postDocument } = require('./posting');

function normHeader(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function mapHeader(value) {
  const h = normHeader(value);
  if (['fecha', 'date'].includes(h)) return 'fecha';
  if (['identificacion', 'ruc', 'cedula'].includes(h)) return 'identificacion';
  if (['codigo_producto', 'codigo', 'producto'].includes(h)) return 'codigo';
  if (['cantidad', 'qty'].includes(h)) return 'cantidad';
  if (['precio', 'precio_unitario'].includes(h)) return 'precio';
  if (['descuento'].includes(h)) return 'descuento';
  if (['iva', 'tarifa_iva'].includes(h)) return 'iva';
  if (['descripcion', 'detalle'].includes(h)) return 'descripcion';
  return null;
}

async function importPurchaseSheet(companyId, userId, buffer) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new AppError('El archivo no tiene hojas.');
  let headers = [];
  const data = [];
  ws.eachRow((row, idx) => {
    const values = row.values.slice(1);
    if (idx === 1) headers = values.map(mapHeader);
    else data.push(values);
  });
  if (!headers.includes('fecha') || !headers.includes('identificacion') || !headers.includes('codigo')) {
    throw new AppError('La primera fila debe incluir fecha, identificacion y codigo_producto.');
  }
  const groups = new Map();
  data.forEach((values, index) => {
    if (values.every((v) => v == null || v === '')) return;
    const rec = {};
    headers.forEach((key, i) => { if (key) rec[key] = values[i]; });
    const fecha = String(rec.fecha instanceof Date ? rec.fecha.toISOString().slice(0, 10) : rec.fecha || '').slice(0, 10);
    const ident = String(rec.identificacion || '').replace(/\D/g, '');
    if (!fecha || !ident) throw new AppError(`Fila ${index + 2}: faltan fecha o identificación.`);
    const key = `${fecha}|${ident}`;
    const list = groups.get(key) || [];
    list.push({ ...rec, fecha, ident, row: index + 2 });
    groups.set(key, list);
  });
  if (!groups.size) throw new AppError('El archivo no tiene facturas.');
  const created = [];
  await db().tx(async () => {
    for (const [key, lines] of groups) {
      const ident = lines[0].ident;
      const supplier = await db().get(
        `SELECT * FROM parties WHERE company_id = ? AND kind = 'PROVEEDOR' AND identification = ?`,
        [companyId, ident]
      );
      if (!supplier) throw new AppError(`No existe el proveedor ${ident} (fila ${lines[0].row}).`);
      const docLines = [];
      for (const line of lines) {
        const product = await db().get(
          'SELECT * FROM products WHERE company_id = ? AND code = ?',
          [companyId, String(line.codigo || '').trim().toUpperCase()]
        );
        if (!product) throw new AppError(`No existe el producto ${line.codigo} (fila ${line.row}).`);
        docLines.push({
          productId: product.id,
          description: line.descripcion || product.name,
          qty: Number(line.cantidad),
          price: line.precio,
          discount: line.descuento || 0,
          ivaRate: line.iva != null && line.iva !== '' ? Number(line.iva) : product.iva_rate,
        });
      }
      const doc = await postDocument({
        companyId, userId, docType: 'FC', date: lines[0].fecha, partyId: supplier.id,
        paymentMethod: 'CREDITO', termDays: supplier.credit_days || 30, lines: docLines,
      });
      created.push({ id: doc.id, number: doc.number, totalCents: doc.totals.totalCents });
    }
  });
  return { imported: created.length, documents: created };
}

module.exports = { importPurchaseSheet };
