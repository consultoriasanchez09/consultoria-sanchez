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
  nombre: 'Mgs. Glenda Sánchez Sigcha',
  cargo: 'Capacitadora',
  entidad: 'Consultoría Sánchez',
  linea: 'Mgs. Glenda Sánchez Sigcha\nCapacitadora\nConsultoría Sánchez'
};

const TEMAS = [
  'Derechos laborales de mujeres y hombres',
  'Igualdad de género y brecha salarial',
  'Erradicación de violencia, acoso y no discriminación',
  'Trabajo de igual valor e igualdad salarial'
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

function sine(doc, x0, y0, len, horizontal, amp, waves, color, phase) {
  doc.save();
  doc.strokeColor(color).lineWidth(0.45);
  const n = Math.max(48, Math.round(len / 3));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s = Math.sin(t * Math.PI * 2 * waves + phase);
    const x = horizontal ? x0 + len * t : x0 + s * amp;
    const y = horizontal ? y0 + s * amp : y0 + len * t;
    if (i === 0) doc.moveTo(x, y);
    else doc.lineTo(x, y);
  }
  doc.stroke();
  doc.restore();
}

function diamond(doc, x, y, r) {
  doc.save();
  doc.moveTo(x, y - r).lineTo(x + r * 0.72, y).lineTo(x, y + r).lineTo(x - r * 0.72, y).closePath().fill(GOLD);
  doc.restore();
}

async function certificatePdf(data) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, compress: false });
  const done = collect(doc);
  const W = doc.page.width;
  const H = doc.page.height;
  const qr = data.verifyUrl
    ? await QRCode.toBuffer(data.verifyUrl, { margin: 0, width: 240, errorCorrectionLevel: 'M', color: { dark: NAVY, light: '#FFFFFF' } })
    : null;

  doc.rect(0, 0, W, H).fill('#FFFFFF');
  doc.lineWidth(11).strokeColor(NAVY).rect(7, 7, W - 14, H - 14).stroke();
  doc.lineWidth(1.3).strokeColor(GOLD).rect(18, 18, W - 36, H - 36).stroke();
  doc.lineWidth(0.5).strokeColor(AZUL).rect(22, 22, W - 44, H - 44).stroke();
  sine(doc, 26, 27, W - 52, true, 1.7, 22, GOLD, 0);
  sine(doc, 26, 27, W - 52, true, 1.7, 22, AZUL, Math.PI);
  sine(doc, 26, H - 27, W - 52, true, 1.7, 22, GOLD, 0.6);
  sine(doc, 26, H - 27, W - 52, true, 1.7, 22, AZUL, Math.PI + 0.6);
  sine(doc, 27, 26, H - 52, false, 1.7, 28, GOLD, 0);
  sine(doc, 27, 26, H - 52, false, 1.7, 28, AZUL, Math.PI / 2);
  sine(doc, W - 27, 26, H - 52, false, 1.7, 28, GOLD, 0.3);
  sine(doc, W - 27, 26, H - 52, false, 1.7, 28, AZUL, Math.PI);
  doc.lineWidth(0.6).strokeColor(GOLD).rect(34, 34, W - 68, H - 68).stroke();
  [[34, 34], [W - 34, 34], [34, H - 34], [W - 34, H - 34]].forEach(([x, y]) => diamond(doc, x, y, 5));

  const bandX = 46;
  const bandW = 28;
  doc.rect(bandX, 46, bandW, H - 92).fill(NAVY);
  doc.rect(bandX + bandW, 46, 2.5, H - 92).fill(GOLD);
  doc.save();
  doc.fillColor('#E7D7A2');
  doc.font('Times-Bold').fontSize(8);
  doc.translate(bandX + 18, H / 2);
  doc.rotate(-90, { origin: [0, 0] });
  doc.text('CONSULTORÍA SÁNCHEZ  ·  LA MANÁ', -160, -5, { width: 320, height: 12, align: 'center', lineBreak: false });
  doc.restore();

  const left = 96;
  const cw = W - left - 40;

  doc.save();
  doc.opacity(0.055);
  logo(doc, left + cw / 2 - 78, 300, 156);
  doc.opacity(1);
  doc.restore();

  logo(doc, left + cw / 2 - 26, 50, 52);
  put(doc, 'Consultoría Sánchez La Maná', left, 108, { font: 'Times-Bold', size: 16, width: cw, height: 20, align: 'center' });
  put(doc, 'Capacitación laboral y de género · La Maná, Cotopaxi', left, 130, { font: 'Times-Italic', size: 9, color: BLUE, width: cw, height: 14, align: 'center' });
  doc.moveTo(left + 70, 152).lineTo(left + cw - 70, 152).strokeColor(GOLD).lineWidth(0.7).stroke();
  diamond(doc, left + cw / 2, 152, 3.2);

  put(doc, 'Consultoría Sánchez La Maná certifica que', left, 168, { font: 'Times-Italic', size: 12, color: BLUE, width: cw, height: 16, align: 'center' });
  put(doc, data.nombre, left, 190, { font: 'Times-Italic', size: 26, width: cw, height: 36, align: 'center' });
  doc.moveTo(left + cw / 2 - 78, 236).lineTo(left + cw / 2 + 78, 236).strokeColor(GOLD).lineWidth(0.8).stroke();
  put(doc, `C.I. ${data.cedula}   ·   ${data.cargo}`, left, 246, { font: 'Times-Roman', size: 10, color: INK, width: cw, height: 14, align: 'center' });
  put(doc, 'aprobó el curso de capacitación Igualdad Salarial y No Discriminación, con una duración de 40 horas académicas.', left + 18, 270, { font: 'Times-Roman', size: 12, color: INK, width: cw - 36, height: 40, align: 'center', lineGap: 2 });

  put(doc, 'Temas del curso', left, 322, { font: 'Times-Bold', size: 9, color: BLUE, width: cw, height: 12, align: 'center' });
  const colW = (cw - 18) / 2;
  TEMAS.forEach((tema, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = left + col * (colW + 18);
    const y = 344 + row * 30;
    diamond(doc, x + 6, y + 6, 2.2);
    put(doc, tema, x + 14, y, { font: 'Times-Roman', size: 9, color: INK, width: colW - 16, height: 24 });
  });

  const nota = data.nota == null || data.nota === '' ? 'Nota final no registrada' : `Nota final ${data.nota} %`;
  put(doc, `${data.empresa}   ·   RUC ${data.ruc}`, left, 418, { font: 'Times-Bold', size: 10, width: cw, height: 14, align: 'center' });
  put(doc, `${nota}   ·   Aprobado el ${data.fechaAprobacion || data.fecha}   ·   Emitido el ${data.fecha}`, left, 436, { font: 'Times-Roman', size: 9, color: MUTED, width: cw, height: 24, align: 'center' });

  sine(doc, left + 24, 500, cw - 48, true, 2, 7, GOLD, 0);
  sine(doc, left + 24, 504, cw - 48, true, 2, 7, AZUL, Math.PI);
  diamond(doc, left + cw / 2, 502, 3);

  const signY = 560;
  doc.moveTo(left, signY).lineTo(left + 210, signY).strokeColor(GOLD).lineWidth(0.7).stroke();
  put(doc, FIRMANTE.nombre, left, signY + 8, { font: 'Times-Italic', size: 13, width: 250, height: 16 });
  put(doc, FIRMANTE.cargo, left, signY + 26, { font: 'Times-Bold', size: 8, color: BLUE, width: 250, height: 12 });
  put(doc, FIRMANTE.entidad, left, signY + 38, { font: 'Times-Roman', size: 8, width: 250, height: 12 });

  const qrSize = 62;
  const qrX = left + cw - qrSize;
  const qrY = 548;
  if (qr) doc.image(qr, qrX, qrY, { width: qrSize, height: qrSize });
  put(doc, data.code, qrX - 10, qrY + qrSize + 4, { font: 'Times-Bold', size: 8, color: NAVY, width: qrSize + 20, height: 12, align: 'center' });

  put(doc, 'Emitido por Consultoría Sánchez La Maná', left, H - 72, { font: 'Times-Bold', size: 9, width: cw, height: 12, align: 'center' });
  put(doc, 'Referencia normativa: Acuerdo Ministerial MDT-2025-006.', left, H - 58, { font: 'Times-Italic', size: 8, color: MUTED, width: cw, height: 12, align: 'center' });

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

module.exports = { certificatePdf, solucionarioPdf, solucionarioHtml, FIRMANTE, TEMAS };
