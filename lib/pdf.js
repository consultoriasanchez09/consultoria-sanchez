'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const NAVY = '#0E2A47';
const BLUE = '#0B5C8A';
const AZUL = '#29A9E1';
const GOLD = '#C4A35A';
const INK = '#1F2D3D';
const MUTED = '#5b6b7b';

const FIRMANTE = {
  nombre: 'Glenda Sanchez',
  cargo: 'Representante Legal',
  entidad: 'Consultoría Sánchez La Maná',
  linea: 'Aprobado por: Glenda Sanchez – Representante Legal, Consultoría Sánchez La Maná'
};

const EJES = [
  { k: 'MÓDULO 1 · 10 H', title: 'Derechos Laborales\nde Mujeres y Hombres', ref: 'Art. 79 CT · Maternidad & IESS', color: '#5B4B8A' },
  { k: 'MÓDULO 2 · 10 H', title: 'Igualdad de Género\ny Brecha Salarial', ref: 'Arts. 11.2, 331 CRE · Sesgos', color: '#0B5C8A' },
  { k: 'MÓDULO 3 · 10 H', title: 'Erradicación de Violencia\ny No Discriminación', ref: 'Convenio 190 OIT · Protocolos', color: '#C47B2B' },
  { k: 'MÓDULO 4 · 10 H', title: 'Trabajo de Igual Valor\ne Igualdad Salarial', ref: 'Convenio 100 OIT · Metodología', color: '#1B7A4E' }
];

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

function put(doc, text, x, y, opt) {
  doc.font(opt.font || 'Helvetica').fontSize(opt.size || 9).fillColor(opt.color || NAVY);
  doc.text(String(text ?? ''), x, y, {
    width: opt.width,
    height: opt.height || (opt.size || 9) + 6,
    align: opt.align || 'left',
    lineGap: opt.lineGap || 0,
    ellipsis: true
  });
}

async function certificatePdf(data) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, compress: false });
  const done = collect(doc);
  const W = doc.page.width;
  const H = doc.page.height;
  const qr = data.verifyUrl
    ? await QRCode.toBuffer(data.verifyUrl, { margin: 0, width: 280, errorCorrectionLevel: 'M', color: { dark: NAVY, light: '#FFFFFF' } })
    : null;

  doc.rect(0, 0, W, H).fill('#FFFFFF');
  doc.lineWidth(7).strokeColor(NAVY).rect(12, 12, W - 24, H - 24).stroke();
  doc.lineWidth(1).strokeColor(GOLD).rect(18, 18, W - 36, H - 36).stroke();
  doc.lineWidth(0.4).strokeColor(AZUL).rect(22, 22, W - 44, H - 44).stroke();
  doc.rect(22, 22, W - 44, 3.5).fill(GOLD);

  logo(doc, 36, 32, 40);
  put(doc, 'Consultoría Sánchez', 84, 36, { font: 'Times-Bold', size: 15, width: 280, height: 18 });
  put(doc, 'La Maná · Capacitación laboral y de género', 84, 54, { font: 'Helvetica', size: 8, color: BLUE, width: 280, height: 12 });

  const badge = 'ART. 3 ACUERDO MINISTERIAL MDT-2025-006';
  const badgeW = 268;
  const badgeX = W - 36 - badgeW;
  doc.roundedRect(badgeX, 38, badgeW, 22, 11).fillAndStroke('#E7F6EC', '#1B7A4E');
  put(doc, badge, badgeX, 44, { font: 'Helvetica-Bold', size: 7.5, color: '#1B7A4E', width: badgeW, height: 12, align: 'center' });

  const pillW = 250;
  doc.roundedRect((W - pillW) / 2, 78, pillW, 16, 8).fill('#E6F5FC');
  put(doc, 'CERTIFICADO DE CAPACITACIÓN ANUAL', (W - pillW) / 2, 82, { font: 'Helvetica-Bold', size: 7.5, color: BLUE, width: pillW, height: 11, align: 'center' });

  put(doc, 'LEY ORGÁNICA PARA LA IGUALDAD SALARIAL', 40, 102, { font: 'Times-Bold', size: 22, width: W - 80, height: 28, align: 'center' });
  put(doc, 'Programa Anual Obligatorio de 40 Horas Académicas · Acuerdo Ministerial MDT-2025-006', 40, 132, { font: 'Helvetica', size: 9, color: MUTED, width: W - 80, height: 14, align: 'center' });
  put(doc, 'SE OTORGA EL PRESENTE RECONOCIMIENTO A:', 40, 152, { font: 'Helvetica', size: 8, color: BLUE, width: W - 80, height: 12, align: 'center' });
  put(doc, data.nombre, 40, 166, { font: 'Times-Bold', size: 22, color: NAVY, width: W - 80, height: 28, align: 'center' });
  put(doc, `C.I.: ${data.cedula}    ·    Cargo: ${data.cargo}    ·    Empresa: ${data.empresa}    ·    RUC: ${data.ruc}`, 36, 198, { font: 'Helvetica', size: 8.5, color: INK, width: W - 72, height: 24, align: 'center' });
  put(doc, 'Por haber completado y aprobado satisfactoriamente los 4 ejes curriculares obligatorios (40 horas lectivas):', 36, 222, { font: 'Helvetica', size: 8.5, color: MUTED, width: W - 72, height: 14, align: 'center' });

  const gap = 10;
  const cardsX = 36;
  const cardsW = W - 72;
  const cardW = (cardsW - gap * 3) / 4;
  const cardY = 242;
  const cardH = 92;
  EJES.forEach((eje, i) => {
    const x = cardsX + i * (cardW + gap);
    doc.roundedRect(x, cardY, cardW, cardH, 6).fillAndStroke('#F8FBFE', '#E3EAF1');
    doc.rect(x + 6, cardY, cardW - 12, 3.5).fill(eje.color);
    put(doc, eje.k, x + 8, cardY + 12, { font: 'Helvetica-Bold', size: 8, color: eje.color, width: cardW - 16, height: 12 });
    put(doc, eje.title, x + 8, cardY + 28, { font: 'Times-Bold', size: 10, color: NAVY, width: cardW - 16, height: 36, lineGap: 1 });
    put(doc, eje.ref, x + 8, cardY + 68, { font: 'Helvetica', size: 7.5, color: MUTED, width: cardW - 16, height: 18 });
  });

  const baseY = 352;
  doc.moveTo(40, baseY).lineTo(210, baseY).strokeColor(GOLD).lineWidth(0.8).stroke();
  put(doc, FIRMANTE.nombre, 40, baseY + 8, { font: 'Times-Italic', size: 14, width: 220, height: 18 });
  put(doc, FIRMANTE.cargo, 40, baseY + 28, { font: 'Helvetica-Bold', size: 8, color: BLUE, width: 220, height: 12 });
  put(doc, FIRMANTE.entidad, 40, baseY + 40, { font: 'Helvetica', size: 8, width: 230, height: 12 });

  const cx = W / 2;
  const cy = baseY + 36;
  doc.circle(cx, cy, 40).lineWidth(2).strokeColor(GOLD).stroke();
  doc.circle(cx, cy, 34).lineWidth(0.6).strokeColor(NAVY).stroke();
  put(doc, '40 HORAS', cx - 36, cy - 20, { font: 'Times-Bold', size: 11, width: 72, height: 14, align: 'center' });
  put(doc, 'APROBADO', cx - 36, cy - 4, { font: 'Helvetica-Bold', size: 8, color: GOLD, width: 72, height: 12, align: 'center' });
  put(doc, `PERÍODO ${data.anio || ''}`, cx - 40, cy + 10, { font: 'Helvetica', size: 7, color: BLUE, width: 80, height: 11, align: 'center' });

  const boxX = W - 250;
  const boxY = baseY - 8;
  doc.roundedRect(boxX, boxY, 210, 108, 6).lineWidth(0.8).strokeColor('#D5DEE8').stroke();
  put(doc, 'VERIFICACIÓN DIGITAL', boxX + 78, boxY + 10, { font: 'Helvetica-Bold', size: 8, color: NAVY, width: 122, height: 12 });
  if (qr) doc.image(qr, boxX + 10, boxY + 14, { width: 64, height: 64 });
  put(doc, 'ID Certificado', boxX + 78, boxY + 26, { font: 'Helvetica', size: 7, color: MUTED, width: 122, height: 10 });
  put(doc, data.code, boxX + 78, boxY + 38, { font: 'Helvetica-Bold', size: 9, color: NAVY, width: 122, height: 14 });
  put(doc, `Emisión: ${data.fecha}`, boxX + 78, boxY + 54, { font: 'Helvetica', size: 7.5, color: INK, width: 122, height: 20 });
  put(doc, 'Registro electrónico verificable', boxX + 10, boxY + 86, { font: 'Helvetica', size: 7.5, color: BLUE, width: 190, height: 12 });

  doc.moveTo(40, H - 52).lineTo(W - 40, H - 52).strokeColor(GOLD).lineWidth(0.6).stroke();
  put(doc, 'EMITIDO POR CONSULTORÍA SÁNCHEZ LA MANÁ', 40, H - 46, { font: 'Times-Bold', size: 8, width: W - 80, height: 12, align: 'center' });
  put(doc, 'Evidencia de la capacitación para inspecciones del Ministerio del Trabajo · La Maná, Cotopaxi', 40, H - 34, { font: 'Helvetica', size: 7, color: MUTED, width: W - 80, height: 11, align: 'center' });

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

module.exports = { certificatePdf, solucionarioPdf, solucionarioHtml, FIRMANTE };
