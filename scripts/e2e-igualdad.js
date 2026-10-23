'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const content = require('../content');

const PORT = 3471;
const BASE = 'http://127.0.0.1:' + PORT;
const DB = '/tmp/ig-e2e-' + Date.now() + '.db';
const PASSWORD = 'CambiarEsta2026!';
const results = [];

function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra: extra || '' });
  if (!cond) console.error('FAIL', name, extra || '');
  else console.log('OK  ', name);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function decodePdfText(buf) {
  const s = buf.toString('latin1');
  let out = '';
  const re = /<([0-9A-Fa-f]+)>/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1].length % 2) continue;
    for (let i = 0; i < m[1].length; i += 2) out += String.fromCharCode(parseInt(m[1].slice(i, i + 2), 16));
  }
  return out;
}

function client() {
  const jar = new Map();
  return async function req(url, opts = {}) {
    const headers = new Headers(opts.headers || {});
    if (jar.size) headers.set('cookie', [...jar.entries()].map(([k, v]) => k + '=' + v).join('; '));
    let body = opts.body;
    if (body && !(body instanceof FormData) && typeof body !== 'string' && !Buffer.isBuffer(body)) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(body);
    }
    const res = await fetch(BASE + url, { method: opts.method || (body ? 'POST' : 'GET'), headers, body });
    const set = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const c of set) {
      const pair = c.split(';')[0];
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const buf = Buffer.from(await res.arrayBuffer());
    let json = null;
    const type = res.headers.get('content-type') || '';
    if (type.includes('json') || type.includes('text/html')) {
      try { json = JSON.parse(buf.toString('utf8')); } catch { json = null; }
    }
    return { status: res.status, json, text: buf.toString('utf8'), buf, type, headers: res.headers };
  };
}

let log = '';
let child;
async function main() {
  for (const m of content.modules) {
    const words = m.reading.join(' ').split(/\s+/).filter(Boolean).length;
    check(m.id + ' palabras ' + words, words >= 1500 && words <= 2500);
    check(m.id + ' 10 preguntas', m.questions.length === 10);
  }
  check('total 40 h', content.TOTAL_HOURS === 40);
  check('prueba final 10', content.finalExam.questions.length === 10);

  child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, ADMIN_PASSWORD: PASSWORD, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 50 && !log.includes('Consultoría Sánchez'); i++) await sleep(100);
  check('servidor arranca', log.includes('Consultoría Sánchez'), log.slice(-400));
  if (child.exitCode != null) throw new Error('el servidor terminó al arrancar: ' + log.slice(-400));

  const admin = client();
  const badLogin = await admin('/api/login', { body: { username: 'admin', password: 'no' } });
  check('login inválido', badLogin.status === 401);
  const login = await admin('/api/login', { body: { username: 'admin', password: PASSWORD } });
  check('login admin', login.status === 200 && login.json.role === 'admin');

  const badCo = await admin('/api/admin/igualdad/companies', { body: { razon_social: 'X', ruc: '123', representante_legal: 'Ana' } });
  check('RUC corto rechazado', badCo.status === 400);

  const co = await admin('/api/admin/igualdad/companies', { body: { razon_social: 'Alimentos Andinos Cía. Ltda.', ruc: '1791234567001', representante_legal: 'María Elena Vásquez', direccion: 'Av. Amazonas N34-123 y República', ciudad: 'Quito', actividad: 'Elaboración de productos alimenticios', auto_approve: false } });
  check('crea empresa', co.status === 200 && co.json.id);
  const companyId = co.json.id;

  const badW = await admin('/api/admin/igualdad/companies/' + companyId + '/workers', { body: { nombre: 'Pedro Prueba', cedula: '1710034066', cargo: 'Bodega', directivo: true } });
  check('cédula inválida', badW.status === 400);

  const w = await admin('/api/admin/igualdad/companies/' + companyId + '/workers', { body: { nombre: 'Pedro Prueba', cedula: '1710034065', cargo: 'Supervisor de bodega', directivo: true } });
  check('crea trabajador directivo', w.status === 200);

  const csv = 'nombre,cedula,cargo,directivo\nLuis Pérez,0926687856,Auxiliar de cobranza,no\nMala Persona,1234567890,Auxiliar,no\n';
  const fd = new FormData();
  fd.append('archivo', new Blob([csv], { type: 'text/csv' }), 'trabajadores.csv');
  const imp = await admin('/api/admin/igualdad/companies/' + companyId + '/import', { body: fd });
  check('importa una fila y reporta la cédula mala', imp.status === 200 && imp.json.created === 1 && imp.json.errors.length === 1, JSON.stringify(imp.json));

  let dash = await admin('/api/admin/igualdad/companies/' + companyId);
  check('sede y actividad', dash.json.company.ciudad === 'Quito' && dash.json.company.direccion.includes('Amazonas') && dash.json.company.actividad.includes('alimenticios'));
  check('kpi trabajadores 2', dash.json.kpi.trabajadores === 2);
  check('kpi directivos 0/1', dash.json.kpi.directivos === '0/1', dash.json.kpi.directivos);
  const pedro = dash.json.workers.find(x => x.cedula === '1710034065');
  check('enlace personal', pedro && pedro.token.length > 20);

  const pub = client();
  let st = await pub('/api/igualdad/' + pedro.token);
  check('m1 abierto y m2 cerrado', st.json.modules[0].unlocked && !st.json.modules[1].unlocked);
  check('sin certificado al inicio', !st.json.certificate);
  const early = await pub('/api/igualdad/' + pedro.token + '/taller/m1', { body: { answer: 'x'.repeat(140) } });
  check('taller bloqueado antes de la lectura', early.status === 403);

  st = await pub('/api/igualdad/' + pedro.token + '/lectura/m1', { body: {} });
  check('lectura enviada acredita 3.5 h y abre el taller', st.json.modules[0].lectura.status === 'pending' && st.json.hours.lecturas === 3.5 && st.json.modules[0].taller.open && !st.json.modules[0].evaluacion.open, JSON.stringify({ h: st.json.hours, t: st.json.modules && st.json.modules[0].taller.open, e: st.json.modules && st.json.modules[0].evaluacion.open, err: st.text.slice(0, 240) }));
  const evalEarly = await pub('/api/igualdad/' + pedro.token + '/evaluacion/m1', { body: { answers: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } });
  check('evaluación cerrada hasta enviar el taller', evalEarly.status === 403);
  dash = await admin('/api/admin/igualdad/companies/' + companyId);
  check('cola de revisión', dash.json.queue.length === 1 && dash.json.kpi.porRevisar === 1);
  const subId = dash.json.queue[0].id;
  const rej = await admin('/api/admin/igualdad/submissions/' + subId + '/revisar', { body: { status: 'rejected' } });
  check('rechazo exige comentario', rej.status === 400);
  const okRe = await admin('/api/admin/igualdad/submissions/' + subId + '/revisar', { body: { status: 'rejected', comment: 'Constancia: se revisa después, no bloquea.' } });
  check('el rechazo queda en el registro', okRe.status === 200);
  st = await pub('/api/igualdad/' + pedro.token);
  check('el rechazo no cierra el taller ni quita las horas', st.json.modules[0].taller.open && st.json.hours.lecturas === 3.5 && st.json.modules[0].lectura.status === 'rejected');
  st = await pub('/api/igualdad/' + pedro.token + '/lectura/m1', { body: {} });
  check('puede reenviar la lectura', st.json.modules[0].lectura.status === 'pending');

  const taller = 'La oferta usa el cuidado como defecto y trata distinto a dos personas con familia. Hay que retirar la anotación, usar la misma banda y dejar una regla escrita de ofertas. ' + 'Aplico el caso a la bodega.';
  st = await pub('/api/igualdad/' + pedro.token + '/taller/m1', { body: { answer: taller } });
  check('taller enviado abre la evaluación sin revisión', st.status === 200 && st.json.modules[0].taller.status === 'pending' && st.json.modules[0].evaluacion.open && st.json.hours.tareas === 3, JSON.stringify(st.json.hours));

  const wrong = content.modules[0].questions.map(q => (q.answer + 1) % 4);
  st = await pub('/api/igualdad/' + pedro.token + '/evaluacion/m1', { body: { answers: wrong } });
  check('evaluación reprobada no suma horas', st.json.modules[0].evaluacion.passed === false && st.json.hours.evaluaciones === 0 && st.json.modules[0].evaluacion.attempts === 1);

  const right = content.modules[0].questions.map(q => q.answer);
  st = await pub('/api/igualdad/' + pedro.token + '/evaluacion/m1', { body: { answers: right } });
  check('evaluación aprobada 100 y abre m2', st.json.modules[0].evaluacion.passed && st.json.modules[0].evaluacion.score === 100 && st.json.modules[1].unlocked && st.json.hours.total === 8.5, JSON.stringify(st.json.hours));
  const noCert = await pub('/api/igualdad/' + pedro.token + '/certificado.pdf');
  check('sin certificado con un solo módulo', noCert.status === 403);

  await admin('/api/admin/igualdad/companies/' + companyId, { method: 'PATCH', body: { auto_approve: true } });
  const finalAnswers = content.finalExam.questions.map(q => q.answer);
  for (const m of content.modules.slice(1)) {
    st = await pub('/api/igualdad/' + pedro.token + '/lectura/' + m.id, { body: {} });
    check(m.id + ' lectura automática', st.status === 200 && st.json.modules.find(x => x.id === m.id).lectura.status === 'approved');
    st = await pub('/api/igualdad/' + pedro.token + '/taller/' + m.id, { body: { answer: taller } });
    check(m.id + ' taller automático', st.status === 200);
    if (m.id === 'm4') {
      const tooSoon = await pub('/api/igualdad/' + pedro.token + '/final', { body: { answers: finalAnswers } });
      check('final bloqueada antes de cerrar m4', tooSoon.status === 403, 'status ' + tooSoon.status);
    }
    const answers = m.questions.map(q => q.answer);
    st = await pub('/api/igualdad/' + pedro.token + '/evaluacion/' + m.id, { body: { answers } });
    check(m.id + ' evaluación', st.status === 200 && st.json.modules.find(x => x.id === m.id).evaluacion.passed, st.text.slice(0, 300));
  }
  st = await pub('/api/igualdad/' + pedro.token);
  check('final desbloqueada', st.json.final.unlocked === true, JSON.stringify({ hours: st.json.hours, mods: st.json.modules.map(m => ({ id: m.id, ev: m.evaluacion.estado, lec: m.lectura.status, tal: m.taller.status })) }));
  st = await pub('/api/igualdad/' + pedro.token + '/final', { body: { answers: finalAnswers } });
  check('prueba final aprobada y 40 h', st.json.final.passed && st.json.hours.total === 40 && st.json.eligible, JSON.stringify(st.json.hours));
  check('certificado con empresa y código', st.json.certificate && st.json.certificate.code.startsWith('CSLM-') , JSON.stringify(st.json.certificate));
  const code = st.json.certificate.code;

  const pdf = await pub('/api/igualdad/' + pedro.token + '/certificado.pdf');
  const pdfText = decodePdfText(pdf.buf);
  const pdfRaw = pdf.buf.toString('latin1');
  const pages = (pdfRaw.match(/\/Type\s*\/Page[^s]/g) || []).length;
  const copiado = ['Se otorga el presente reconocimiento', 'Programa Anual Obligatorio', 'Expediente electrónico', 'VERIFICACIÓN DIGITAL', '40 HORAS', 'AMU-', 'CSIG-'];
  check('PDF del certificado', pdf.status === 200 && pdf.buf.slice(0, 4).toString() === '%PDF' && pages === 1
    && /\/MediaBox\s*\[\s*0\s+0\s+595\.2[0-9]*\s+841\.8/.test(pdfRaw)
    && pdfText.includes('Alimentos Andinos') && pdfText.includes('Pedro Prueba') && pdfText.includes('1710034065')
    && pdfText.includes('Supervisor de bodega') && pdfText.includes('1791234567001')
    && pdfText.includes('Consultoría Sánchez certifica que')
    && pdfText.includes('Capacitación laboral y de género')
    && pdfText.includes('aprobó el curso de capacitación Igualdad Salarial y No Discriminación, con una duración de 40 horas académicas.')
    && pdfText.includes('Trabajador(a) de la empresa: Alimentos Andinos Cía. Ltda. · RUC 1791234567001')
    && pdfText.includes('Período 2025') && pdfText.includes('diciembre de 2025')
    && pdfText.includes('brecha salarial') && pdfText.includes('igual valor')
    && pdfText.includes('Nota final 100 %') && pdfText.includes('Aprobado el') && pdfText.includes('Emitido el')
    && pdfText.includes('Mgs. Glenda Sánchez Sigcha') && pdfText.includes('Capacitadora') && !pdfText.includes('Representante Legal') && !pdfText.includes('Sikcha')
    && pdfText.includes('Emitido por Consultoría Sánchez')
    && !pdfText.includes('La Maná')
    && pdfText.includes('MDT-2025-006') && pdfText.includes(code)
    && copiado.every(s => !pdfText.includes(s)),
    pdfText.slice(0, 500) + ' pages=' + pages);
  const ver = await pub('/api/verificar/' + code);
  check('verificación pública', ver.json.valid === true
    && ver.json.trabajador === 'Pedro Prueba'
    && ver.json.cedula === '1710034065'
    && ver.json.cargo === 'Supervisor de bodega'
    && ver.json.empresa.includes('Alimentos Andinos')
    && ver.json.ruc === '1791234567001'
    && ver.json.programa === 'Igualdad Salarial y No Discriminación'
    && ver.json.code.startsWith('CSLM-')
    && Array.isArray(ver.json.temas) && ver.json.temas.length === 4
    && ver.json.horas === 40
    && ver.json.estado === 'APROBADO'
    && ver.json.nota === 100
    && ver.json.periodo === 2025
    && ver.json.empresaLinea === 'Trabajador(a) de la empresa: Alimentos Andinos Cía. Ltda. · RUC 1791234567001'
    && ver.json.fechaAprobacion.includes('diciembre de 2025')
    && ver.json.fechaEmision.includes('diciembre de 2025')
    && ver.json.emisor === 'Consultoría Sánchez'
    && ver.json.code === code
    && ver.json.aprobadoPor === 'Mgs. Glenda Sánchez Sigcha\nCapacitadora\nConsultoría Sánchez',
    JSON.stringify(ver.json));
  const page = await pub('/verificar/' + code);
  check('página de verificación', page.status === 200 && page.text.includes('Fecha de aprobación') && page.text.includes('Consultoría Sánchez certifica que') && page.text.includes('Trabajador(a) de la empresa:') && page.text.includes('Mgs. Glenda Sánchez Sigcha') && page.text.includes('Capacitadora') && page.text.includes('Emitido por Consultoría Sánchez') && page.text.includes('CSLM-') && !page.text.includes('La Maná') && !page.text.includes('Representante Legal') && !page.text.includes('Sikcha') && !page.text.includes('Programa Anual Obligatorio') && !page.text.includes('Se otorga') && page.text.includes('d.cedula') && page.text.includes('d.fechaEmision'));
  const qr = await pub('/api/verificar/' + code + '/qr.png');
  check('QR del certificado', qr.status === 200 && qr.buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a');

  const fail = await admin('/api/admin/igualdad/workers/' + pedro.id + '/recalificar', { body: { eval_key: 'final', score: 40, passed: false, comment: 'Recálculo de prueba' } });
  check('recálculo reprobado', fail.status === 200 && fail.json.certificado === null);
  const verOff = await pub('/api/verificar/' + code.toLowerCase());
  check('el código deja de verificar', verOff.json.valid === false);
  const back = await admin('/api/admin/igualdad/workers/' + pedro.id + '/recalificar', { body: { eval_key: 'final', score: 90, passed: true, comment: 'Vuelve a aprobar' } });
  check('recálculo aprobado devuelve certificado', back.status === 200 && back.json.certificado && back.json.certificado !== code);
  const verBack = await pub('/api/verificar/' + back.json.certificado);
  check('nota del recálculo en la verificación', verBack.json.valid === true && verBack.json.nota === 90 && verBack.json.cedula === '1710034065' && verBack.json.estado === 'APROBADO' && verBack.json.fechaAprobacion, JSON.stringify(verBack.json));

  const xls = await admin('/api/admin/igualdad/companies/' + companyId + '/reporte.xlsx');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xls.buf);
  const names = wb.worksheets.map(s => s.name);
  check('Excel con 4 hojas', names.join('|') === 'Empresa|Trabajadores y horas|Evaluaciones|Acciones Art.4', names.join('|'));
  const empRows = [];
  wb.getWorksheet('Empresa').eachRow(r => empRows.push(r.getCell(2).text));
  check('Excel trae la razón social', empRows.some(t => String(t).includes('Alimentos Andinos')));
  const sol = await admin('/api/admin/igualdad/solucionario');
  check('solucionario HTML', sol.status === 200 && sol.text.includes('Pautas de corrección'));
  const solPdf = await admin('/api/admin/igualdad/solucionario.pdf');
  check('solucionario PDF', solPdf.status === 200 && solPdf.buf.slice(0, 4).toString() === '%PDF');

  const accion = await admin('/api/admin/igualdad/companies/' + companyId + '/acciones', { body: { fecha: '2026-03-12', tipo: 'Charla de socialización', descripcion: 'Charla de 45 minutos con lista de asistencia del personal de planta.', participantes: 'Todo el personal de planta' } });
  check('acción art. 4', accion.status === 200);
  dash = await admin('/api/admin/igualdad/companies/' + companyId);
  check('directivo cumple 1/1 y kpi acción', dash.json.kpi.directivos === '1/1' && dash.json.kpi.cumplen === 1 && dash.json.kpi.acciones === 1, JSON.stringify(dash.json.kpi));

  const banned = ['DAVID ABRAHAM YEPEZ CAYES', '1708200744001', 'CAMACHO MUNCHA', 'YEPEZ CHACHA', 'CHACHA ORDOÑEZ'];
  const kitSrc = fs.readFileSync(path.join(__dirname, '..', 'templates', 'igualdad', 'copy.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'lib', 'company-docs.js'), 'utf8');
  check('las plantillas no traen datos de la empresa de ejemplo', banned.every(s => !kitSrc.includes(s)));
  const anon = client();
  check('documentos exigen sesión', (await anon('/api/admin/igualdad/companies/' + companyId + '/documentos/politica')).status === 401);
  const poster = await admin('/api/admin/igualdad/companies/' + companyId + '/documentos/afiche-valor');
  const posterText = decodePdfText(poster.buf);
  check('afiche PDF con la empresa', poster.status === 200 && poster.buf.slice(0, 4).toString() === '%PDF' && posterText.includes('Alimentos Andinos') && posterText.includes('Quito') && posterText.includes('María Elena') && posterText.includes('IGUAL REMUNERACI') && banned.every(s => !posterText.includes(s)), posterText.slice(0, 240));
  const denuncia = decodePdfText((await admin('/api/admin/igualdad/companies/' + companyId + '/documentos/afiche-denuncia')).buf);
  const tolerancia = decodePdfText((await admin('/api/admin/igualdad/companies/' + companyId + '/documentos/afiche-tolerancia')).buf);
  check('los tres afiches conservan su texto', denuncia.includes('CANAL CONFIDENCIAL') && denuncia.includes('Alimentos Andinos') && tolerancia.includes('TOLERANCIA CERO') && tolerancia.includes('Amazonas'));
  async function docxText(url) {
    const res = await admin(url);
    const zip = await JSZip.loadAsync(res.buf);
    const xml = await zip.file('word/document.xml').async('string');
    return { status: res.status, xml: xml.replace(/<[^>]+>/g, '') };
  }
  const pol = await docxText('/api/admin/igualdad/companies/' + companyId + '/documentos/politica');
  check('política DOCX personalizada', pol.status === 200 && pol.xml.includes('Alimentos Andinos') && pol.xml.includes('María Elena Vásquez') && pol.xml.includes('1791234567001') && pol.xml.includes('Quito') && pol.xml.includes('Artículo 1. Objeto') && pol.xml.includes('Elaboración de productos alimenticios') && banned.every(s => !pol.xml.includes(s)));
  const acta = await docxText('/api/admin/igualdad/companies/' + companyId + '/documentos/acta');
  check('acta con el personal y fecha en blanco', acta.xml.includes('Pedro Prueba') && acta.xml.includes('1710034065') && acta.xml.includes('Luis Pérez') && acta.xml.includes('____/____/________') && acta.xml.includes('Amazonas') && !acta.xml.includes('CAMACHO'));
  const enc = await docxText('/api/admin/igualdad/companies/' + companyId + '/documentos/encuesta');
  check('encuesta anónima de la empresa', enc.xml.includes('En esta empresa, hombres y mujeres reciben igual remuneración') && enc.xml.includes('Alimentos Andinos') && enc.xml.includes('Quito') && !enc.xml.includes('Pedro Prueba'));
  const ins = await docxText('/api/admin/igualdad/companies/' + companyId + '/documentos/instructivo');
  check('instructivo Art. 4 identificado', ins.xml.includes('Imprimir y firmar la Política') && ins.xml.includes('1791234567001') && ins.xml.includes('Elaboración de productos alimenticios'));
  const rep = await admin('/api/admin/igualdad/companies/' + companyId + '/documentos/reporte');
  const kitWb = new ExcelJS.Workbook();
  await kitWb.xlsx.load(rep.buf);
  check('reporte con las 4 hojas del modelo', kitWb.worksheets.map(s => s.name).join('|') === 'Consolidado|Bitácora videos|Tareas y evaluaciones|Sensibilización (Art. 4)');
  const cons = kitWb.getWorksheet('Consolidado');
  check('encabezado del consolidado', cons.getRow(1).getCell(1).text.includes('MDT-2025-006') && cons.getRow(2).getCell(2).text.includes('Alimentos Andinos') && cons.getRow(2).getCell(4).text === '1791234567001' && cons.getRow(2).getCell(6).text === '2026' && cons.getRow(3).getCell(2).text === 'Quito' && cons.getRow(4).getCell(5).text === 'Horas video');
  const pedroRow = cons.getRow(6);
  check('Pedro acredita 40 h en el consolidado', pedroRow.getCell(1).text.includes('Pedro') && pedroRow.getCell(4).text === 'SÍ' && pedroRow.getCell(5).value === 14 && pedroRow.getCell(6).value === 12 && pedroRow.getCell(7).value === 40 && pedroRow.getCell(9).text === 'SÍ', JSON.stringify([pedroRow.getCell(5).value, pedroRow.getCell(6).value, pedroRow.getCell(7).value, pedroRow.getCell(9).text]));
  const luisRow = cons.getRow(5);
  check('Luis figura sin horas', luisRow.getCell(1).text.includes('Luis') && luisRow.getCell(7).value === 0 && luisRow.getCell(9).text === 'NO');
  const bitRows = [];
  kitWb.getWorksheet('Bitácora videos').eachRow(r => bitRows.push([r.getCell(1).text, r.getCell(3).text, r.getCell(5).value, r.getCell(6).text]));
  check('bitácora de la lectura de Pedro', bitRows.some(r => r[0].includes('Pedro') && r[1].includes('M1') && r[2] === 210 && r[3] === 'SÍ') && bitRows.some(r => r[0].includes('Luis') && r[2] === 0 && r[3] === 'NO'));
  const taskRows = [];
  kitWb.getWorksheet('Tareas y evaluaciones').eachRow(r => taskRows.push([r.getCell(1).text, r.getCell(4).text, r.getCell(8).value, r.getCell(3).text]));
  check('la prueba final queda en tareas y evaluaciones', taskRows.some(r => r[0].includes('Pedro') && r[1] === 'Prueba final' && r[2] === 90));
  const art = [];
  kitWb.getWorksheet('Sensibilización (Art. 4)').eachRow(r => art.push([r.getCell(1).text, r.getCell(2).text, r.getCell(3).text, r.getCell(4).text]));
  check('sensibilización del Art. 4', art.some(r => r[0] === '2026-03-12' && r[1] === 'Charla de socialización' && r[2].includes('45 minutos') && r[3].includes('planta')));
  const zipRes = await admin('/api/admin/igualdad/companies/' + companyId + '/documentos.zip');
  const zip = await JSZip.loadAsync(zipRes.buf);
  const zipNames = Object.keys(zip.files).sort();
  check('ZIP con los 8 documentos', zipRes.status === 200 && zipNames.length === 8 && zipNames.some(n => n.endsWith('.pdf')) && zipNames.some(n => n.includes('Politica')) && zipNames.some(n => n === 'Reporte_Igualdad_Salarial_1791234567001.xlsx'), zipNames.join(','));
  const ui = await fetch(BASE + '/admin-igualdad.js');
  const uiText = await ui.text();
  check('la ficha ofrece Documentos de la empresa', uiText.includes('Documentos de la empresa') && uiText.includes('Descargar todo (ZIP)') && uiText.includes('name="ciudad"') && uiText.includes('name="actividad"') && uiText.includes('Emitir certificados en lote') && uiText.includes('name="periodo"'));
  const evalRow = dash.json.evaluaciones.find(r => r.cedula === '1710034065' && r.eval_key === 'final');
  check('tabla de evaluación con recálculo', evalRow && evalRow.estado.includes('recálculo') && evalRow.nota === 90, JSON.stringify(evalRow));

  const mat = new FormData();
  mat.append('module_key', 'm2');
  mat.append('activity', 'lectura');
  mat.append('kind', 'pdf');
  mat.append('title', 'Guía de apoyo');
  mat.append('file', new Blob(['%PDF-1.4\n%guia\n'], { type: 'application/pdf' }), 'guia.pdf');
  const up = await admin('/api/admin/igualdad/materiales', { body: mat });
  check('sube PDF del módulo', up.status === 200 && up.json.id, JSON.stringify(up.json));
  const blocked = await pub('/api/igualdad/' + 'no-existe');
  check('token ajeno', blocked.status === 404);
  st = await pub('/api/igualdad/' + pedro.token);
  const file = st.json.modules[1].lectura.materials.find(f => f.kind === 'pdf');
  const got = await pub(file.href);
  check('el trabajador descarga el PDF', got.status === 200 && got.buf.slice(0, 5).toString().includes('%PDF'));

  const vid = new FormData();
  vid.append('module_key', 'm1');
  vid.append('activity', 'lectura');
  vid.append('kind', 'video');
  vid.append('title', 'Video de apoyo');
  vid.append('url', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ');
  const upv = await admin('/api/admin/igualdad/materiales', { body: vid });
  check('video https', upv.status === 200);
  st = await pub('/api/igualdad/' + pedro.token);
  check('el video aparece en la lectura', st.json.modules[0].lectura.materials.some(f => f.kind === 'video' && f.url.includes('youtube')));

  const courses = await admin('/api/admin/courses');
  const lessons = await admin('/api/admin/courses/' + courses.json[0].id + '/lessons');
  const lessonId = lessons.json[0].id;
  const lf = new FormData();
  lf.append('kind', 'pdf');
  lf.append('title', 'Lectura de clase');
  lf.append('file', new Blob(['%PDF-1.4\n%clase\n'], { type: 'application/pdf' }), 'clase.pdf');
  const lessonUp = await admin('/api/admin/lessons/' + lessonId + '/files', { body: lf });
  check('PDF en clase del aula', lessonUp.status === 200, JSON.stringify(lessonUp.json || lessonUp.text));
  const lv = new FormData();
  lv.append('kind', 'video');
  lv.append('title', 'Clase en video');
  lv.append('url', 'https://vimeo.com/76979871');
  check('video de clase', (await admin('/api/admin/lessons/' + lessonId + '/files', { body: lv })).status === 200);

  const student = client();
  const slogin = await student('/api/login', { body: { username: 'estudiante', password: 'Estudiante2026' } });
  check('login estudiante', slogin.status === 200);
  const course = await student('/api/my/courses/' + courses.json[0].id);
  const lesson = course.json.lessons.find(l => l.id === lessonId);
  check('la clase muestra PDF y video', lesson.files.some(f => f.kind === 'pdf') && lesson.files.some(f => f.kind === 'video' && String(f.url).includes('vimeo')));
  const fileId = lesson.files.find(f => f.kind === 'pdf').id;
  const down = await student('/api/my/archivos/' + fileId);
  check('estudiante inscrito descarga', down.status === 200 && down.buf.includes(Buffer.from('%PDF')));

  await admin('/api/admin/students', { body: { name: 'Sin curso', username: 'sincurso', password: 'ClaveSegura1' } });
  const outsider = client();
  await outsider('/api/login', { body: { username: 'sincurso', password: 'ClaveSegura1' } });
  const denied = await outsider('/api/my/archivos/' + fileId);
  check('quien no está inscrito no descarga', denied.status === 403);

  const home = await pub('/igualdad');
  check('portada del módulo', home.status === 200 && home.text.includes('40 horas'));
  const info = await fetch(BASE + '/');
  const homeHtml = await info.text();
  check('enlace en servicios', homeHtml.includes('/igualdad') && homeHtml.includes('Igualdad salarial'));

  const fuera = await admin('/api/admin/igualdad/certificados', { body: { razon_social: 'Alimentos Andinos Cía. Ltda.', ruc: '1791234567001', periodo: 2025, fecha: '2026-01-02', trabajadores: [{ nombre: 'Ana Lote', cedula: '1712345675', cargo: 'Cajera' }] } });
  check('fecha fuera del período', fuera.status === 400, fuera.text.slice(0, 200));
  const lote = await admin('/api/admin/igualdad/certificados', { body: { razon_social: 'Alimentos Andinos Cía. Ltda.', ruc: '1791234567001', periodo: 2025, fecha: '2025-12-15', trabajadores: [{ nombre: 'Ana Lote', cedula: '1712345675', cargo: 'Cajera' }, { nombre: 'Luis Lote', cedula: '0901234567', cargo: 'Chofer' }] } });
  const loteZip = await JSZip.loadAsync(lote.buf);
  const loteNames = Object.keys(loteZip.files);
  check('lote ZIP con dos PDF', lote.status === 200 && loteNames.filter(n => n.endsWith('.pdf')).length === 2 && loteNames.includes('indice.csv'), loteNames.join(','));
  const lotePdf = decodePdfText(await loteZip.file(loteNames.find(n => n.endsWith('.pdf'))).async('nodebuffer'));
  check('PDF del lote con período y empresa', lotePdf.includes('Período 2025') && lotePdf.includes('Trabajador(a) de la empresa: Alimentos Andinos') && lotePdf.includes('Emitido por Consultoría Sánchez') && !lotePdf.includes('La Maná') && !lotePdf.includes('Nota final'));
  dash = await admin('/api/admin/igualdad/companies/' + companyId);
  const ana = dash.json.workers.find(w => w.cedula === '1712345675');
  check('el lote deja un código verificable', ana && ana.certificado && ana.certificado.startsWith('CSLM-') && ana.fechaAprobacion === '2025-12-15');
  const anaView = await pub('/api/igualdad/' + ana.token);
  check('el certificado emitido en lote no depende del avance', anaView.json.certificate && anaView.json.certificate.code === ana.certificado && anaView.json.hours.total === 0 && anaView.json.certificate.periodo === 2025);
  const anaVer = await pub('/api/verificar/' + ana.certificado);
  check('verificar el lote', anaVer.json.valid === true && anaVer.json.trabajador === 'Ana Lote' && anaVer.json.cargo === 'Cajera' && anaVer.json.periodo === 2025 && anaVer.json.nota == null && anaVer.json.fechaEmision.includes('diciembre de 2025'));
  const fechas = await admin('/api/admin/igualdad/workers/' + pedro.id + '/certificado', { body: { fechaAprobacion: '2025-06-01', fechaEmision: '2025-06-01' } });
  const pedroVer = await pub('/api/verificar/' + fechas.json.code);
  check('admin cambia la fecha dentro de 2025', fechas.status === 200 && pedroVer.json.fechaAprobacion.includes('junio de 2025') && pedroVer.json.fechaEmision.includes('junio de 2025'), JSON.stringify(pedroVer.json));
  const malAnio = await admin('/api/admin/igualdad/workers/' + pedro.id + '/certificado', { body: { fechaAprobacion: '2026-06-01', fechaEmision: '2026-06-01' } });
  check('no acepta una fecha de otro año', malAnio.status === 400);

  const cliOut = '/tmp/ig-cli-out-' + Date.now();
  const cliDb = cliOut + '.db';
  const cliJson = cliOut + '.json';
  fs.mkdirSync(cliOut, { recursive: true });
  fs.writeFileSync(cliJson, JSON.stringify({ razon_social: 'Comercial del Valle', ruc: '0999999999001', periodo: 2025, trabajadores: [{ nombre: 'Rosa Valle', cedula: '1755555552', cargo: 'Auxiliar' }] }));
  const cli = spawnSync(process.execPath, ['scripts/generar-certificados.js', '--input', cliJson, '--out', cliOut, '--db', cliDb, '--periodo', '2025', '--base', BASE], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  const cliPdf = fs.readdirSync(cliOut).find(n => n.endsWith('.pdf'));
  const cliText = cliPdf ? decodePdfText(fs.readFileSync(path.join(cliOut, cliPdf))) : '';
  const cliIndex = fs.existsSync(path.join(cliOut, 'indice.csv')) ? fs.readFileSync(path.join(cliOut, 'indice.csv'), 'utf8') : '';
  check('CLI escribe el PDF y el índice', cli.status === 0 && cliPdf && cliText.includes('Rosa Valle') && cliText.includes('Período 2025') && cliText.includes('Trabajador(a) de la empresa: Comercial del Valle') && cliIndex.includes('CSLM-'), (cli.stderr || cli.stdout || '').slice(0, 300));
  const Database = require('better-sqlite3');
  const cliRow = new Database(cliDb).prepare('SELECT code FROM ig_certificates').get();
  check('CLI registra el código en la base', cliRow && cliIndex.includes(cliRow.code));

  const { certificatePdf } = require('../lib/pdf');
  const largoNombre = 'BERMELLO CEDEÑO WILLIANS LEOVIGILDO';
  const largoCargo = 'Supervisor general de bodega, logística, distribución nacional y control de inventarios';
  const largoBuf = await certificatePdf({
    nombre: largoNombre,
    cedula: '1710034065',
    cargo: largoCargo,
    empresa: 'Alimentos Andinos Cía. Ltda.',
    ruc: '1791234567001',
    empresaLinea: 'Trabajador(a) de la empresa: Alimentos Andinos Cía. Ltda. · RUC 1791234567001',
    periodo: 2025,
    fecha: '15 de diciembre de 2025',
    fechaAprobacion: '15 de diciembre de 2025',
    nota: 100,
    code: 'CSLM-DA93FCE9',
    verifyUrl: BASE + '/verificar/CSLM-DA93FCE9'
  });
  const largoText = decodePdfText(largoBuf);
  const largoRaw = largoBuf.toString('latin1');
  const largoPages = (largoRaw.match(/\/Type\s*\/Page[^s]/g) || []).length;
  check('nombre y cargo largos se ajustan sin recortar', largoPages === 1
    && /\/MediaBox\s*\[\s*0\s+0\s+595\.2[0-9]*\s+841\.8/.test(largoRaw)
    && largoText.includes(largoNombre)
    && largoText.includes(largoCargo)
    && !largoText.includes('…')
    && !largoText.includes('\u0085')
    && largoText.includes('Consultoría Sánchez certifica que')
    && largoText.includes('Período 2025')
    && largoText.includes('Mgs. Glenda Sánchez Sigcha')
    && largoText.includes('Capacitadora')
    && largoText.includes('Trabajador(a) de la empresa: Alimentos Andinos Cía. Ltda. · RUC 1791234567001')
    && largoText.includes('Erradicación de violencia, acoso y no discriminación'),
    largoText.slice(0, 400) + ' pages=' + largoPages);

  const failed = results.filter(r => !r.ok);
  console.log('\n' + results.filter(r => r.ok).length + '/' + results.length + ' checks');
  child.kill();
  fs.rmSync(DB, { force: true });
  fs.rmSync(DB + '-shm', { force: true });
  fs.rmSync(DB + '-wal', { force: true });
  if (failed.length) {
    console.error(failed);
    process.exit(1);
  }
}

main().catch(err => { console.error(err); console.error(log.slice(-2000)); if (child) child.kill(); process.exit(1); });
