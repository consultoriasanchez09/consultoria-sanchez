'use strict';

const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, WidthType, BorderStyle
} = require('docx');
const { PIE, posters, politica, acta, encuesta, instructivo, reporte } = require('../templates/igualdad/copy');

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const FONT = 'Calibri';
const edge = { style: BorderStyle.SINGLE, size: 4, color: 'B7C0C8' };
const borders = { top: edge, bottom: edge, left: edge, right: edge };

const CATALOG = [
  { id: 'afiche-valor', filename: '1_Afiche_Igual_Valor_Igual_Remuneracion.pdf', mime: 'application/pdf', label: 'Afiche · Igual valor, igual remuneración' },
  { id: 'afiche-denuncia', filename: '2_Afiche_Canal_Denuncia_Acoso.pdf', mime: 'application/pdf', label: 'Afiche · Canal de denuncia' },
  { id: 'afiche-tolerancia', filename: '3_Afiche_Tolerancia_Cero_Discriminacion.pdf', mime: 'application/pdf', label: 'Afiche · Tolerancia cero a la discriminación' },
  { id: 'politica', filename: '4_Politica_Igualdad_No_Discriminacion.docx', mime: DOCX, label: 'Política de igualdad y no discriminación' },
  { id: 'acta', filename: '5_Acta_Socializacion.docx', mime: DOCX, label: 'Acta de socialización' },
  { id: 'encuesta', filename: '6_Encuesta_Clima_Igualdad.docx', mime: DOCX, label: 'Encuesta de clima' },
  { id: 'instructivo', filename: '7_Instructivo_Art4.docx', mime: DOCX, label: 'Instructivo Art. 4' },
  { id: 'reporte', filename: ctx => `Reporte_Igualdad_Salarial_${ctx.ruc}.xlsx`, mime: XLSX, label: 'Reporte Igualdad Salarial (Excel)' }
];

function collect(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

function run(text, opt = {}) {
  return new TextRun({ text: String(text ?? ''), font: FONT, bold: !!opt.bold, size: opt.size || 22, color: opt.color });
}

function para(text, opt = {}) {
  return new Paragraph({
    alignment: opt.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before: opt.before ?? 0, after: opt.after ?? 120 },
    indent: opt.indent,
    children: opt.runs || [run(text, opt)]
  });
}

function cell(text, width, opt = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    margins: { top: 40, bottom: 40, left: 60, right: 60 },
    children: [new Paragraph({ children: [run(text, { bold: opt.bold, size: opt.size || 18 })] })]
  });
}

function signature(ctx) {
  return [
    para('', { after: 200 }),
    para('______________________________', { align: 'center', after: 0 }),
    para('REPRESENTANTE LEGAL', { align: 'center', bold: true, after: 0 }),
    para(`Representante Legal · ${ctx.representante_legal} · RUC ${ctx.ruc}`, { align: 'center', size: 18, after: 120 })
  ];
}

function pack(children) {
  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{
      properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
      children
    }]
  });
  return Packer.toBuffer(doc);
}

function posterPdf(spec, ctx) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, compress: false });
  const done = collect(doc);
  const W = doc.page.width;
  doc.rect(0, 0, W, 280).fill(spec.band);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(32);
  let y = 78;
  for (const line of spec.titles) {
    doc.text(line, 36, y, { width: W - 72, align: 'center' });
    y += 42;
  }
  doc.fillColor('#1F2937').font('Helvetica').fontSize(15);
  y = 330;
  for (const line of spec.lines) {
    if (line) doc.text(line, 40, y, { width: W - 80, align: 'center' });
    y += 26;
  }
  doc.moveTo(60, 688).lineTo(W - 60, 688).strokeColor(spec.band).lineWidth(4).stroke();
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(15).text(ctx.razon_social, 40, 704, { width: W - 80, align: 'center' });
  const sub = [ctx.representante_legal, ctx.ciudad, ctx.direccion].filter(Boolean).join(' · ');
  if (sub) doc.fillColor('#1F2937').font('Helvetica').fontSize(10).text(sub, 40, 728, { width: W - 80, align: 'center' });
  doc.fillColor('#6B7280').font('Helvetica').fontSize(9).text(PIE, 36, 758, { width: W - 72, align: 'center' });
  doc.end();
  return done;
}

function politicaDoc(ctx) {
  const lugar = [ctx.direccion, ctx.ciudad].filter(Boolean).join(' · ');
  const dado = ctx.ciudad ? `Dado y firmado en ${ctx.ciudad}, el ${ctx.fecha}.` : `Dado y firmado el ${ctx.fecha}.`;
  const children = [
    para(politica.titulo, { align: 'center', bold: true, size: 28, after: 200 }),
    para(ctx.razon_social, { align: 'center', bold: true, size: 24, after: ctx.actividad || lugar ? 40 : 200 }),
    ctx.actividad ? para(ctx.actividad, { align: 'center', size: 20, after: lugar ? 40 : 200 }) : null,
    lugar ? para(lugar, { align: 'center', size: 20, after: 200 }) : null,
    para('Considerando:', { bold: true, after: 40 }),
    ...politica.considerandos.map(text => para('', {
      after: 60,
      indent: { left: 560, hanging: 280 },
      runs: [run('• '), run(text)]
    })),
    para(`${ctx.razon_social}, a través de su Representante Legal ${ctx.representante_legal}, adopta la siguiente Política de obligatorio cumplimiento para todo su personal:`, { bold: true, after: 160 }),
    ...politica.articulos.map(([lead, body]) => para('', { runs: [run(lead + ' ', { bold: true }), run(body)] })),
    para(dado, { before: 80, after: 120 }),
    ...signature(ctx)
  ].filter(Boolean);
  return pack(children);
}

function actaDoc(ctx) {
  const widths = [700, 3200, 1600, 2800, 1338];
  const header = new TableRow({
    tableHeader: true,
    children: acta.columnas.map((name, i) => cell(name, widths[i], { bold: true }))
  });
  const filas = ctx.filasActa.map(f => new TableRow({
    children: [f.n, f.nombre, f.cedula, f.cargo, ''].map((value, i) => cell(value, widths[i]))
  }));
  const meta = `Empresa: ${ctx.razon_social}   |   RUC: ${ctx.ruc}   |   Ciudad: ${ctx.ciudad}   |   Dirección: ${ctx.direccion}   |   Actividad: ${ctx.actividad}   |   Fecha: ____/____/________   |   Modalidad: ☐ Presencial  ☐ Virtual`;
  return pack([
    para(acta.titulo, { align: 'center', bold: true, size: 26, after: 200 }),
    para(meta, { after: 120 }),
    para(acta.declaracion, { after: 160 }),
    new Table({ width: { size: 9638, type: WidthType.DXA }, columnWidths: widths, rows: [header, ...filas] }),
    para(acta.nota, { before: 160, size: 18, after: 80 }),
    ...signature(ctx)
  ]);
}

function encuestaDoc(ctx) {
  const widths = [600, 6438, 520, 520, 520, 520, 520];
  const head = ['N°', 'Afirmación', '1', '2', '3', '4', '5'];
  const rows = [
    new TableRow({ tableHeader: true, children: head.map((name, i) => cell(name, widths[i], { bold: true })) }),
    ...encuesta.afirmaciones.map((text, i) => new TableRow({
      children: [String(i + 1), text, '', '', '', '', ''].map((value, k) => cell(value, widths[k]))
    }))
  ];
  const quien = [ctx.razon_social, ctx.ciudad, ctx.actividad].filter(Boolean).join(' · ');
  return pack([
    para(encuesta.titulo, { align: 'center', bold: true, size: 26, after: 200 }),
    para(`${quien} · ${encuesta.intro}`, { after: 160 }),
    new Table({ width: { size: 9638, type: WidthType.DXA }, columnWidths: widths, rows }),
    para(encuesta.sugerencia, { before: 200, bold: true }),
    para('______________________________________________________________________________', { after: 60 }),
    para('______________________________________________________________________________', { after: 60 }),
    para('______________________________________________________________________________', { after: 60 }),
    para('______________________________________________________________________________', { after: 120 }),
    para(encuesta.tabulacion, { size: 18 })
  ]);
}

function instructivoDoc(ctx) {
  const id = `Empresa: ${ctx.razon_social} · RUC ${ctx.ruc} · Representante legal: ${ctx.representante_legal} · ${ctx.direccion} · ${ctx.ciudad} · Actividad: ${ctx.actividad}`;
  return pack([
    para(instructivo.titulo, { align: 'center', bold: true, size: 26, after: 160 }),
    para(id, { after: 200 }),
    ...instructivo.pasos.map((paso, i) => para(`${i + 1}. ${paso}`, { after: 140 }))
  ]);
}

async function reporteXlsx(ctx) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Consultoría Sánchez';
  const c = wb.addWorksheet(reporte.hojas.consolidado);
  c.addRow([reporte.titulo]);
  c.addRow(['Empresa', ctx.razon_social, 'RUC', ctx.ruc, 'Período', ctx.anio, 'Generado', ctx.generado]);
  c.addRow(['Ciudad', ctx.ciudad, 'Actividad', ctx.actividad, 'Dirección', ctx.direccion, 'Representante legal', ctx.representante_legal]);
  c.addRow(reporte.columnas.consolidado);
  ctx.consolidado.forEach(w => c.addRow([
    w.nombre, w.cedula, w.cargo, w.directivo ? 'SÍ' : 'NO',
    w.lecturas, w.tareas, w.total, Math.round(w.total / 40 * 100), w.total >= 40 ? 'SÍ' : 'NO'
  ]));
  c.getRow(1).font = { bold: true };
  c.getRow(4).font = { bold: true };
  [28, 18, 36, 22, 16, 16, 14, 12, 12].forEach((width, i) => { c.getColumn(i + 1).width = width; });

  const b = wb.addWorksheet(reporte.hojas.bitacora);
  b.addRow(reporte.columnas.bitacora);
  ctx.bitacora.forEach(r => b.addRow([r.trabajador, r.cedula, r.clase, r.eje, r.minutos, r.marcada, r.primer, r.ultimo]));
  b.getRow(1).font = { bold: true };
  [32, 16, 28, 42, 16, 26, 20, 20].forEach((width, i) => { b.getColumn(i + 1).width = width; });

  const t = wb.addWorksheet(reporte.hojas.tareas);
  t.addRow(reporte.columnas.tareas);
  ctx.tareas.forEach(r => t.addRow([
    r.trabajador, r.cedula, r.tarea, r.tipo, r.eje, r.horas, r.estado,
    r.nota == null || r.nota === '' ? '' : r.nota, r.entrega, r.revision, r.comentario, r.respuesta
  ]));
  t.getRow(1).font = { bold: true };
  [32, 16, 42, 16, 36, 10, 22, 10, 20, 20, 36, 50].forEach((width, i) => { t.getColumn(i + 1).width = width; });

  const a = wb.addWorksheet(reporte.hojas.art4);
  a.addRow(reporte.columnas.art4);
  ctx.acciones.forEach(r => a.addRow([r.fecha, r.tipo, r.descripcion, r.participantes || '']));
  a.getRow(1).font = { bold: true };
  [14, 32, 60, 28].forEach((width, i) => { a.getColumn(i + 1).width = width; });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function renderDocument(id, ctx) {
  const item = CATALOG.find(d => d.id === id);
  if (!item) return null;
  let buffer;
  if (id === 'afiche-valor') buffer = await posterPdf(posters.valor, ctx);
  else if (id === 'afiche-denuncia') buffer = await posterPdf(posters.denuncia, ctx);
  else if (id === 'afiche-tolerancia') buffer = await posterPdf(posters.tolerancia, ctx);
  else if (id === 'politica') buffer = await politicaDoc(ctx);
  else if (id === 'acta') buffer = await actaDoc(ctx);
  else if (id === 'encuesta') buffer = await encuestaDoc(ctx);
  else if (id === 'instructivo') buffer = await instructivoDoc(ctx);
  else if (id === 'reporte') buffer = await reporteXlsx(ctx);
  else return null;
  const filename = typeof item.filename === 'function' ? item.filename(ctx) : item.filename;
  return { id, filename, mime: item.mime, label: item.label, buffer };
}

async function renderZip(ctx) {
  const zip = new JSZip();
  for (const item of CATALOG) {
    const doc = await renderDocument(item.id, ctx);
    zip.file(doc.filename, doc.buffer);
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return { filename: `kit-igualdad-${ctx.ruc}.zip`, mime: 'application/zip', buffer };
}

module.exports = { CATALOG, renderDocument, renderZip };
