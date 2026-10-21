'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const NAVY = '#0E2A47';
const BLUE = '#0B5C8A';
const AZUL = '#29A9E1';

function collect(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

function logo(doc, x, y, w) {
  const file = path.join(__dirname, '..', 'public', 'img', 'logo.png');
  if (fs.existsSync(file)) doc.image(file, x, y, { width: w });
}

function certificatePdf(data) {
  const doc = new PDFDocument({ size: 'A4', margin: 54, compress: false });
  const done = collect(doc);
  const W = doc.page.width;
  const H = doc.page.height;
  doc.save();
  doc.lineWidth(8).strokeColor(NAVY).rect(18, 18, W - 36, H - 36).stroke();
  doc.lineWidth(2).strokeColor(AZUL).rect(28, 28, W - 56, H - 56).stroke();
  doc.restore();
  logo(doc, 70, 58, 64);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(20).text('Consultoría Sánchez', 146, 68, { width: 360 });
  doc.fillColor(BLUE).font('Helvetica').fontSize(11).text('La Maná · Cotopaxi · Ecuador', 146, 94, { width: 360 });
  doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(12).text('CAPACITACIÓN', 70, 150, { align: 'center', width: W - 140 });
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(22).text('Igualdad Salarial · 40 horas', 70, 168, { align: 'center', width: W - 140 });
  doc.moveTo(160, 210).lineTo(W - 160, 210).strokeColor(AZUL).lineWidth(1).stroke();
  doc.fillColor('#5b6b7b').font('Helvetica').fontSize(12).text('Se deja constancia de que la empresa', 70, 230, { align: 'center', width: W - 140 });
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(20).text(data.empresa, 70, 252, { align: 'center', width: W - 140 });
  doc.fillColor('#5b6b7b').font('Helvetica').fontSize(11).text(`RUC ${data.ruc} · Representante legal: ${data.representante}`, 70, 300, { align: 'center', width: W - 140 });
  doc.fillColor(NAVY).font('Helvetica').fontSize(12).text('certifica que', 70, 336, { align: 'center', width: W - 140 });
  doc.font('Helvetica-Bold').fontSize(22).fillColor(BLUE).text(data.nombre, 70, 358, { align: 'center', width: W - 140 });
  doc.fillColor(NAVY).font('Helvetica').fontSize(13).text(`cédula ${data.cedula}`, 70, 396, { align: 'center', width: W - 140 });
  doc.fontSize(12).text('completó la capacitación de', 70, 430, { align: 'center', width: W - 140 });
  doc.font('Helvetica-Bold').fontSize(28).fillColor(AZUL).text('40 horas', 70, 452, { align: 'center', width: W - 140 });
  doc.fillColor(NAVY).font('Helvetica').fontSize(11).text('Lecturas, talleres y evaluaciones aprobadas, incluida la prueba final.\nTemas: derechos laborales, igualdad de género y brecha salarial,\nerradicación de violencia y acoso, y trabajo de igual valor.', 80, 500, { align: 'center', width: W - 160 });
  doc.fontSize(12).text(`Fecha: ${data.fecha}`, 70, 570, { align: 'center', width: W - 140 });
  doc.font('Helvetica-Bold').fontSize(12).text(`Código de verificación: ${data.code}`, 70, 592, { align: 'center', width: W - 140 });
  doc.font('Helvetica').fontSize(9).fillColor('#5b6b7b').text('Verifique este certificado en la página pública /verificar/' + data.code, 70, 614, { align: 'center', width: W - 140 });
  doc.fontSize(8).fillColor('#7a5b00').text('Versión de prueba. Acredita la capacitación en la plataforma de Consultoría Sánchez. No reemplaza el reporte oficial de enero ante el Ministerio del Trabajo.', 70, 700, { align: 'center', width: W - 140 });
  doc.end();
  return done;
}

function solucionarioPdf(modules, finalExam) {
  const doc = new PDFDocument({ size: 'A4', margin: 54, compress: false });
  const done = collect(doc);
  const width = doc.page.width - 108;
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(18).text('Solucionario · Igualdad Salarial', { width });
  doc.moveDown(0.3);
  doc.fillColor(BLUE).font('Helvetica').fontSize(10).text('Consultoría Sánchez · Versión de prueba · Uso exclusivo de administración. No entregar al personal antes de la evaluación.', { width });
  const blocks = [...modules.map(m => ({ title: m.title, workshop: m.workshop, questions: m.questions })), { title: 'Prueba final integradora (6 h)', workshop: null, questions: finalExam.questions }];
  for (const b of blocks) {
    doc.moveDown(1);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(14).text(b.title, { width });
    if (b.workshop) {
      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(BLUE).text(b.workshop.title, { width });
      doc.moveDown(0.2);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text('Pautas de corrección', { width });
      doc.font('Helvetica').fontSize(10).fillColor('#1F2D3D').text(b.workshop.guide, { width, align: 'justify' });
    }
    b.questions.forEach((q, i) => {
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(`${i + 1}. ${q.q}`, { width });
      q.options.forEach((op, k) => {
        const mark = k === q.answer ? '✓ ' : '   ';
        doc.font(k === q.answer ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(k === q.answer ? '#137333' : '#1F2D3D').text(`${mark}${op}`, { width });
      });
      doc.font('Helvetica-Oblique').fontSize(9).fillColor('#5b6b7b').text('Por qué: ' + q.why, { width });
    });
  }
  doc.end();
  return done;
}

function solucionarioHtml(modules, finalExam) {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const blocks = [...modules.map(m => ({ title: m.title, workshop: m.workshop, questions: m.questions })), { title: 'Prueba final integradora (6 h)', workshop: null, questions: finalExam.questions }];
  const body = blocks.map(b => `
    <section>
      <h2>${esc(b.title)}</h2>
      ${b.workshop ? `<h3>${esc(b.workshop.title)}</h3><p><strong>Pautas de corrección.</strong> ${esc(b.workshop.guide)}</p>` : ''}
      <ol>${b.questions.map(q => `<li><p>${esc(q.q)}</p><ul>${q.options.map((op, k) => `<li class="${k === q.answer ? 'ok' : ''}">${esc(op)}</li>`).join('')}</ul><p class="why">${esc(q.why)}</p></li>`).join('')}</ol>
    </section>`).join('');
  return `<!doctype html><html lang="es-EC"><head><meta charset="utf-8"><title>Solucionario | Consultoría Sánchez</title>
  <style>
    body{font-family:system-ui,sans-serif;color:#1F2D3D;margin:32px auto;max-width:860px;line-height:1.5}
    h1{color:#0E2A47} h2{color:#0B5C8A;border-top:4px solid #29A9E1;padding-top:12px}
    .ok{color:#137333;font-weight:700} .why{color:#5b6b7b;font-size:.92rem}
    .note{background:#FFF4CC;color:#7a5b00;padding:10px 12px;border-radius:8px}
    @media print {.note{border:1px solid #ccc}}
  </style></head><body>
  <h1>Consultoría Sánchez · Solucionario</h1>
  <p class="note">Versión de prueba. Uso de administración: talleres y clave de evaluaciones y de la prueba final. Imprima esta página si necesita PDF.</p>
  ${body}
  </body></html>`;
}

module.exports = { certificatePdf, solucionarioPdf, solucionarioHtml };
