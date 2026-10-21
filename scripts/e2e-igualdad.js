'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const content = require('../content');

const PORT = 3456;
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

async function main() {
  for (const m of content.modules) {
    const words = m.reading.join(' ').split(/\s+/).filter(Boolean).length;
    check(m.id + ' palabras ' + words, words >= 1500 && words <= 2500);
    check(m.id + ' 10 preguntas', m.questions.length === 10);
  }
  check('total 40 h', content.TOTAL_HOURS === 40);
  check('prueba final 10', content.finalExam.questions.length === 10);

  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, ADMIN_PASSWORD: PASSWORD, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 50 && !log.includes('Consultoría Sánchez'); i++) await sleep(100);
  check('servidor arranca', log.includes('Consultoría Sánchez'), log.slice(-400));

  const admin = client();
  const badLogin = await admin('/api/login', { body: { username: 'admin', password: 'no' } });
  check('login inválido', badLogin.status === 401);
  const login = await admin('/api/login', { body: { username: 'admin', password: PASSWORD } });
  check('login admin', login.status === 200 && login.json.role === 'admin');

  const badCo = await admin('/api/admin/igualdad/companies', { body: { razon_social: 'X', ruc: '123', representante_legal: 'Ana' } });
  check('RUC corto rechazado', badCo.status === 400);

  const co = await admin('/api/admin/igualdad/companies', { body: { razon_social: 'Alimentos Andinos Cía. Ltda.', ruc: '1791234567001', representante_legal: 'María Elena Vásquez', auto_approve: false } });
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
  check('lectura queda por revisar', st.json.modules[0].lectura.status === 'pending' && st.json.hours.lecturas === 0);
  dash = await admin('/api/admin/igualdad/companies/' + companyId);
  check('cola de revisión', dash.json.queue.length === 1 && dash.json.kpi.porRevisar === 1);
  const subId = dash.json.queue[0].id;
  const rej = await admin('/api/admin/igualdad/submissions/' + subId + '/revisar', { body: { status: 'rejected' } });
  check('rechazo exige comentario', rej.status === 400);
  const okRe = await admin('/api/admin/igualdad/submissions/' + subId + '/revisar', { body: { status: 'approved', comment: 'Lectura conforme' } });
  check('aprueba lectura', okRe.status === 200);
  st = await pub('/api/igualdad/' + pedro.token);
  check('acredita 3.5 h de lectura', st.json.hours.lecturas === 3.5 && st.json.modules[0].taller.open);

  const taller = 'La oferta usa el cuidado como defecto y trata distinto a dos personas con familia. Hay que retirar la anotación, usar la misma banda y dejar una regla escrita de ofertas. ' + 'Aplico el caso a la bodega.';
  st = await pub('/api/igualdad/' + pedro.token + '/taller/m1', { body: { answer: taller } });
  check('taller pendiente', st.json.modules[0].taller.status === 'pending');
  dash = await admin('/api/admin/igualdad/companies/' + companyId);
  const talId = dash.json.queue[0].id;
  await admin('/api/admin/igualdad/submissions/' + talId + '/revisar', { body: { status: 'approved', comment: 'Bien' } });

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
  check('certificado con empresa y código', st.json.certificate && st.json.certificate.code.startsWith('CSIG-') , JSON.stringify(st.json.certificate));
  const code = st.json.certificate.code;

  const pdf = await pub('/api/igualdad/' + pedro.token + '/certificado.pdf');
  const pdfText = decodePdfText(pdf.buf);
  check('PDF del certificado', pdf.status === 200 && pdf.buf.slice(0, 4).toString() === '%PDF' && pdfText.includes('Alimentos Andinos') && pdfText.includes('Pedro Prueba') && pdfText.includes('40 horas') && pdfText.includes('Consultoría'), pdfText.slice(0, 180));
  const ver = await pub('/api/verificar/' + code);
  check('verificación pública', ver.json.valid === true && ver.json.empresa.includes('Alimentos') && ver.json.horas === 40 && ver.json.cedula.includes('•'));

  const fail = await admin('/api/admin/igualdad/workers/' + pedro.id + '/recalificar', { body: { eval_key: 'final', score: 40, passed: false, comment: 'Recálculo de prueba' } });
  check('recálculo reprobado', fail.status === 200 && fail.json.certificado === null);
  const verOff = await pub('/api/verificar/' + code.toLowerCase());
  check('el código deja de verificar', verOff.json.valid === false);
  const back = await admin('/api/admin/igualdad/workers/' + pedro.id + '/recalificar', { body: { eval_key: 'final', score: 90, passed: true, comment: 'Vuelve a aprobar' } });
  check('recálculo aprobado devuelve certificado', back.status === 200 && back.json.certificado);

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

main().catch(err => { console.error(err); process.exit(1); });
