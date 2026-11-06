const { formatMoney } = require('./money');

function sendTable(res, { filename, title, subtitle, columns, rows, format }) {
  if (format === 'xlsx') return sendXlsx(res, { filename, title, subtitle, columns, rows });
  return sendPdf(res, { filename, title, subtitle, columns, rows });
}

function sendPdf(res, { filename, title, subtitle, columns, rows }) {
  const PDFDocument = require('pdfkit');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  const doc = new PDFDocument({ margin: 36, size: 'A4', layout: columns.length > 6 ? 'landscape' : 'portrait' });
  doc.pipe(res);
  doc.fillColor('#0E2A47').fontSize(16).text('Consultoría Sánchez', { continued: false });
  doc.fillColor('#0B5C8A').fontSize(13).text(title);
  if (subtitle) doc.fillColor('#5b6b7b').fontSize(9).text(subtitle);
  doc.moveDown(0.4);
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colW = width / columns.length;
  const drawRow = (values, header) => {
    const y = doc.y;
    values.forEach((value, i) => {
      doc.fontSize(header ? 8 : 8).fillColor(header ? '#0E2A47' : '#1F2D3D')
        .text(String(value ?? ''), doc.page.margins.left + i * colW, y, { width: colW - 4, height: 24 });
    });
    doc.y = y + 16;
  };
  drawRow(columns.map((c) => c.header), true);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor('#C4A35A').stroke();
  for (const row of rows) {
    if (doc.y > doc.page.height - 50) doc.addPage();
    drawRow(columns.map((c) => (c.money ? formatMoney(row[c.key]) : row[c.key])));
  }
  doc.end();
}

async function sendXlsx(res, { filename, title, subtitle, columns, rows }) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Consultoría Sánchez';
  const ws = wb.addWorksheet('Reporte');
  ws.addRow([title]);
  if (subtitle) ws.addRow([subtitle]);
  ws.addRow([]);
  const header = ws.addRow(columns.map((c) => c.header));
  header.font = { bold: true, color: { argb: 'FF0E2A47' } };
  for (const row of rows) {
    ws.addRow(columns.map((c) => (c.money ? Number(row[c.key] || 0) / 100 : row[c.key])));
  }
  ws.columns.forEach((col) => { col.width = 22; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

async function purchaseTemplateBuffer() {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Compras');
  ws.addRow(['fecha', 'identificacion', 'codigo_producto', 'cantidad', 'precio', 'descuento', 'iva', 'descripcion']);
  ws.addRow(['2026-10-15', '1790000000001', 'ARZ', 10, 8.5, 0, 15, 'Arroz']);
  ws.getRow(1).font = { bold: true };
  return wb.xlsx.writeBuffer();
}

module.exports = { sendTable, purchaseTemplateBuffer };
