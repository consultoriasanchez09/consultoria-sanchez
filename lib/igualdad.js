'use strict';

const crypto = require('crypto');
const QRCode = require('qrcode');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const content = require('../content');
const { validarCedula, validarRuc, validarDirectivo } = require('./validate');
const { certificatePdf, solucionarioPdf, solucionarioHtml, FIRMANTE, TEMAS } = require('./pdf');
const { renderDocument, renderZip } = require('./company-docs');
const { ensureUploads, safeHttps, single, uploadMaterial, uploadTable, removeStored, sendStored } = require('./files');

const { modules, finalExam, TIPOS_ART4, HOURS, TOTAL_HOURS, PASS, MAX_ATTEMPTS, byId } = content;

function fechaLarga(iso) {
  const d = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', day: '2-digit', month: 'long', year: 'numeric' }).format(d);
}

function fechaCalendario(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return new Intl.DateTimeFormat('es-EC', { timeZone: 'UTC', day: '2-digit', month: 'long', year: 'numeric' }).format(d);
}

function leerPeriodo(value) {
  if (value == null || value === '') return 2025;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) return null;
  return n;
}

function fechaEnPeriodo(value, periodo) {
  const m = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (y !== Number(periodo)) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function fechaPorPeriodo(periodo, explicita) {
  return fechaEnPeriodo(explicita, periodo) || `${periodo}-12-15`;
}

function empresaLinea(razon, ruc) {
  return `Trabajador(a) de la empresa: ${razon} · RUC ${ruc}`;
}

function fechasDeCertificado(cert, company) {
  const periodo = Number(cert?.periodo) || Number(company?.periodo) || 2025;
  const fechaEmisionIso = cert?.fecha_emision || `${periodo}-12-15`;
  const fechaAprobacionIso = cert?.fecha_aprobacion || fechaEmisionIso;
  return {
    periodo,
    fechaAprobacionIso,
    fechaEmisionIso,
    fechaAprobacion: fechaCalendario(fechaAprobacionIso),
    fechaEmision: fechaCalendario(fechaEmisionIso)
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function fechaHora(iso) {
  if (!iso) return '';
  const raw = String(iso);
  const norm = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z';
  const d = new Date(norm);
  if (Number.isNaN(d.getTime())) return raw;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Guayaquil', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(d);
  const g = t => parts.find(p => p.type === t)?.value || '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
}

function anioDe(iso) {
  const d = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Guayaquil', year: 'numeric' }).format(d);
}

function anioActual() {
  return anioDe();
}

function origenPublico(req) {
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  return `${proto}://${req.get('host')}`;
}

function textoEmpresa(value, max) {
  return String(value || '').trim().slice(0, max);
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ig_companies(
      id INTEGER PRIMARY KEY,
      razon_social TEXT NOT NULL,
      ruc TEXT NOT NULL,
      representante_legal TEXT NOT NULL,
      direccion TEXT NOT NULL DEFAULT '',
      ciudad TEXT NOT NULL DEFAULT '',
      actividad TEXT NOT NULL DEFAULT '',
      auto_approve INTEGER NOT NULL DEFAULT 0,
      periodo INTEGER NOT NULL DEFAULT 2025,
      cert_fecha TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ig_workers(
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES ig_companies(id) ON DELETE CASCADE,
      nombre TEXT NOT NULL,
      cedula TEXT NOT NULL,
      cargo TEXT NOT NULL,
      directivo INTEGER NOT NULL DEFAULT 0,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(company_id, cedula)
    );
    CREATE TABLE IF NOT EXISTS ig_submissions(
      id INTEGER PRIMARY KEY,
      worker_id INTEGER NOT NULL REFERENCES ig_workers(id) ON DELETE CASCADE,
      module_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      answer TEXT,
      status TEXT NOT NULL,
      review_comment TEXT,
      submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      UNIQUE(worker_id, module_key, kind)
    );
    CREATE TABLE IF NOT EXISTS ig_attempts(
      id INTEGER PRIMARY KEY,
      worker_id INTEGER NOT NULL REFERENCES ig_workers(id) ON DELETE CASCADE,
      eval_key TEXT NOT NULL,
      answers TEXT NOT NULL,
      score REAL NOT NULL,
      passed INTEGER NOT NULL,
      submitted_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ig_overrides(
      worker_id INTEGER NOT NULL REFERENCES ig_workers(id) ON DELETE CASCADE,
      eval_key TEXT NOT NULL,
      score REAL NOT NULL,
      passed INTEGER NOT NULL,
      comment TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(worker_id, eval_key)
    );
    CREATE TABLE IF NOT EXISTS ig_actions(
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES ig_companies(id) ON DELETE CASCADE,
      fecha TEXT NOT NULL,
      tipo TEXT NOT NULL,
      descripcion TEXT NOT NULL,
      participantes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ig_certificates(
      worker_id INTEGER PRIMARY KEY REFERENCES ig_workers(id) ON DELETE CASCADE,
      code TEXT NOT NULL UNIQUE,
      issued_at TEXT NOT NULL,
      periodo INTEGER NOT NULL DEFAULT 2025,
      fecha_aprobacion TEXT NOT NULL DEFAULT '',
      fecha_emision TEXT NOT NULL DEFAULT '',
      manual INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS ig_files(
      id INTEGER PRIMARY KEY,
      module_key TEXT NOT NULL,
      activity TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT,
      url TEXT,
      stored_name TEXT,
      original_name TEXT,
      mime TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS lesson_files(
      id INTEGER PRIMARY KEY,
      lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT,
      url TEXT,
      stored_name TEXT,
      original_name TEXT,
      mime TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const have = new Set(db.prepare('PRAGMA table_info(ig_companies)').all().map(c => c.name));
  for (const [name, def] of [
    ['direccion', "TEXT NOT NULL DEFAULT ''"],
    ['ciudad', "TEXT NOT NULL DEFAULT ''"],
    ['actividad', "TEXT NOT NULL DEFAULT ''"],
    ['periodo', 'INTEGER NOT NULL DEFAULT 2025'],
    ['cert_fecha', "TEXT NOT NULL DEFAULT ''"]
  ]) {
    if (!have.has(name)) db.exec(`ALTER TABLE ig_companies ADD COLUMN ${name} ${def}`);
  }
  const certCols = new Set(db.prepare('PRAGMA table_info(ig_certificates)').all().map(c => c.name));
  for (const [name, def] of [
    ['periodo', 'INTEGER NOT NULL DEFAULT 2025'],
    ['fecha_aprobacion', "TEXT NOT NULL DEFAULT ''"],
    ['fecha_emision', "TEXT NOT NULL DEFAULT ''"],
    ['manual', 'INTEGER NOT NULL DEFAULT 0']
  ]) {
    if (!certCols.has(name)) db.exec(`ALTER TABLE ig_certificates ADD COLUMN ${name} ${def}`);
  }
}

function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim()));
}

function normHeader(h) {
  return String(h || '').trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, '');
}

function mountIgualdad(app, db, admin) {
  ensureUploads();
  const sub = db.prepare('SELECT * FROM ig_submissions WHERE worker_id=? AND module_key=? AND kind=?');
  const attemptsOf = db.prepare('SELECT * FROM ig_attempts WHERE worker_id=? AND eval_key=? ORDER BY id');
  const overrideOf = db.prepare('SELECT * FROM ig_overrides WHERE worker_id=? AND eval_key=?');

  function officialEval(workerId, key) {
    const override = overrideOf.get(workerId, key);
    const attempts = attemptsOf.all(workerId, key);
    const best = attempts.reduce((m, a) => m == null ? a.score : Math.max(m, a.score), null);
    const passedAuto = attempts.some(a => a.passed === 1);
    if (override) {
      return {
        score: override.score, passed: override.passed === 1, attempts: attempts.length,
        estado: override.passed ? 'Aprobado (recálculo)' : 'Reprobado (recálculo)',
        override: true, comment: override.comment || ''
      };
    }
    if (!attempts.length) return { score: null, passed: false, attempts: 0, estado: 'Pendiente', override: false, comment: '' };
    let estado = 'En intentos';
    if (passedAuto) estado = 'Aprobado';
    else if (attempts.length >= MAX_ATTEMPTS) estado = 'Reprobado';
    return { score: best, passed: passedAuto, attempts: attempts.length, estado, override: false, comment: '' };
  }

  function submitted(workerId, key, kind) {
    return !!sub.get(workerId, key, kind);
  }

  function moduleUnlocked(workerId, index) {
    if (index <= 0) return true;
    return officialEval(workerId, modules[index - 1].id).passed;
  }

  function hoursOf(workerId) {
    let lecturas = 0, tareas = 0, evaluaciones = 0;
    for (const m of modules) {
      if (submitted(workerId, m.id, 'lectura')) lecturas += HOURS.lectura;
      if (submitted(workerId, m.id, 'taller')) tareas += HOURS.taller;
      if (officialEval(workerId, m.id).passed) evaluaciones += HOURS.evaluacion;
    }
    if (officialEval(workerId, 'final').passed) evaluaciones += HOURS.final;
    const total = round1(lecturas + tareas + evaluaciones);
    return {
      lecturas: round1(lecturas), tareas: round1(tareas), evaluaciones: round1(evaluaciones),
      total, avance: Math.min(100, round1(total / TOTAL_HOURS * 100))
    };
  }

  function moduleReady(workerId, key) {
    return submitted(workerId, key, 'lectura') && submitted(workerId, key, 'taller') && officialEval(workerId, key).passed;
  }

  function eligible(workerId) {
    const h = hoursOf(workerId);
    const mods = modules.every(m => moduleReady(workerId, m.id));
    const fin = officialEval(workerId, 'final').passed;
    return mods && fin && h.total >= TOTAL_HOURS;
  }

  function syncCertificate(workerId) {
    const existing = db.prepare('SELECT * FROM ig_certificates WHERE worker_id=?').get(workerId);
    if (!eligible(workerId)) {
      if (existing && existing.manual) return existing;
      if (existing) db.prepare('DELETE FROM ig_certificates WHERE worker_id=?').run(workerId);
      return null;
    }
    if (existing) return existing;
    const worker = db.prepare('SELECT company_id FROM ig_workers WHERE id=?').get(workerId);
    const company = db.prepare('SELECT periodo, cert_fecha FROM ig_companies WHERE id=?').get(worker.company_id);
    const periodo = leerPeriodo(company?.periodo) || 2025;
    const fecha = fechaPorPeriodo(periodo, company?.cert_fecha);
    const code = 'CSLM-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    db.prepare('INSERT INTO ig_certificates(worker_id, code, issued_at, periodo, fecha_aprobacion, fecha_emision, manual) VALUES(?,?,?,?,?,?,0)')
      .run(workerId, code, new Date().toISOString(), periodo, fecha, fecha);
    return db.prepare('SELECT * FROM ig_certificates WHERE worker_id=?').get(workerId);
  }

  function activityOpen(workerId, moduleIndex, activity) {
    if (!moduleUnlocked(workerId, moduleIndex)) return false;
    const key = modules[moduleIndex].id;
    if (activity === 'lectura') return true;
    if (activity === 'taller') return submitted(workerId, key, 'lectura');
    if (activity === 'evaluacion') return submitted(workerId, key, 'taller');
    return false;
  }

  function filesFor(moduleKey, activity, hrefBase) {
    return db.prepare('SELECT * FROM ig_files WHERE module_key=? AND activity=? ORDER BY id').all(moduleKey, activity).map(f => ({
      id: f.id,
      kind: f.kind,
      title: f.title || f.original_name || 'Material',
      url: f.kind === 'video' ? f.url : null,
      href: f.kind === 'video' ? null : `${hrefBase}/archivos/${f.id}`
    }));
  }

  function aprobadoEl(workerId) {
    const passedAttempt = attemptsOf.all(workerId, 'final').find(a => a.passed === 1);
    const ov = overrideOf.get(workerId, 'final');
    return passedAttempt ? passedAttempt.submitted_at : (ov && ov.passed === 1 ? ov.updated_at : null);
  }

  function workerView(worker, company) {
    const hrefBase = '/api/igualdad/' + worker.token;
    const mods = modules.map((m, index) => {
      const unlocked = moduleUnlocked(worker.id, index);
      const lec = sub.get(worker.id, m.id, 'lectura');
      const tal = sub.get(worker.id, m.id, 'taller');
      const ev = officialEval(worker.id, m.id);
      const lecturaOpen = activityOpen(worker.id, index, 'lectura');
      const tallerOpen = activityOpen(worker.id, index, 'taller');
      const evalOpen = activityOpen(worker.id, index, 'evaluacion');
      const last = attemptsOf.all(worker.id, m.id).at(-1);
      return {
        id: m.id,
        title: m.title,
        unlocked,
        hours: { lectura: HOURS.lectura, taller: HOURS.taller, evaluacion: HOURS.evaluacion },
        lectura: {
          open: lecturaOpen,
          status: !lecturaOpen ? 'locked' : (lec?.status || 'available'),
          comment: lec?.review_comment || '',
          paragraphs: lecturaOpen ? m.reading : [],
          materials: lecturaOpen ? filesFor(m.id, 'lectura', hrefBase) : []
        },
        taller: {
          open: tallerOpen,
          status: !tallerOpen ? 'locked' : (tal?.status || 'available'),
          comment: tal?.review_comment || '',
          answer: tal?.answer || '',
          title: tallerOpen ? m.workshop.title : '',
          prompt: tallerOpen ? m.workshop.prompt : '',
          materials: tallerOpen ? filesFor(m.id, 'taller', hrefBase) : []
        },
        evaluacion: {
          open: evalOpen,
          ...ev,
          canRetry: evalOpen && !ev.passed && ev.attempts < MAX_ATTEMPTS,
          questions: evalOpen && !ev.passed && ev.attempts < MAX_ATTEMPTS ? m.questions.map(q => ({ q: q.q, options: q.options })) : [],
          review: reviewDetail(m.questions, last, ev),
          materials: evalOpen ? filesFor(m.id, 'evaluacion', hrefBase) : []
        }
      };
    });
    const finalOpen = modules.every(m => officialEval(worker.id, m.id).passed);
    const fin = officialEval(worker.id, 'final');
    const lastFinal = attemptsOf.all(worker.id, 'final').at(-1);
    const cert = syncCertificate(worker.id);
    return {
      testVersion: true,
      programa: 'Capacitación Igualdad Salarial · 40 horas',
      totalHoras: TOTAL_HOURS,
      pass: PASS,
      maxAttempts: MAX_ATTEMPTS,
      company: { razon_social: company.razon_social, ruc: company.ruc, representante_legal: company.representante_legal },
      worker: { nombre: worker.nombre, cedula: worker.cedula, cargo: worker.cargo, directivo: !!worker.directivo },
      hours: hoursOf(worker.id),
      eligible: eligible(worker.id),
      certificate: cert ? (() => {
        const fechas = fechasDeCertificado(cert, company);
        return { code: cert.code, issued_at: cert.issued_at, fecha: fechas.fechaEmision, anio: String(fechas.periodo), periodo: fechas.periodo, fechaAprobacion: fechas.fechaAprobacion, fechaEmision: fechas.fechaEmision, nota: officialEval(worker.id, 'final').score };
      })() : null,
      modules: mods,
      final: {
        unlocked: finalOpen,
        title: finalExam.title,
        hours: HOURS.final,
        intro: finalOpen ? finalExam.intro : '',
        ...fin,
        canRetry: finalOpen && !fin.passed && fin.attempts < MAX_ATTEMPTS,
        questions: finalOpen && !fin.passed && fin.attempts < MAX_ATTEMPTS ? finalExam.questions.map(q => ({ q: q.q, options: q.options })) : [],
        review: reviewDetail(finalExam.questions, lastFinal, fin),
        materials: finalOpen ? filesFor('final', 'prueba', hrefBase) : []
      }
    };
  }

  function reviewDetail(questions, last, ev) {
    if (!last) return null;
    let answers = [];
    try { answers = JSON.parse(last.answers); } catch { answers = []; }
    const reveal = ev.passed || ev.attempts >= MAX_ATTEMPTS;
    return {
      score: last.score,
      items: questions.map((q, i) => ({
        ok: answers[i] === q.answer,
        chosen: answers[i],
        correct: reveal ? q.answer : undefined,
        why: reveal ? q.why : undefined
      }))
    };
  }

  function grade(questions, answers) {
    if (!Array.isArray(answers) || answers.length !== questions.length) {
      return { error: 'Responda todas las preguntas.' };
    }
    let correct = 0;
    const clean = [];
    for (let i = 0; i < questions.length; i++) {
      const a = Number(answers[i]);
      if (!Number.isInteger(a) || a < 0 || a >= questions[i].options.length) return { error: 'Hay una respuesta inválida.' };
      clean.push(a);
      if (a === questions[i].answer) correct++;
    }
    const score = Math.round((correct / questions.length) * 100);
    return { clean, score, passed: score >= PASS };
  }

  function saveAttempt(workerId, key, graded) {
    db.prepare('INSERT INTO ig_attempts(worker_id, eval_key, answers, score, passed) VALUES(?,?,?,?,?)')
      .run(workerId, key, JSON.stringify(graded.clean), graded.score, graded.passed ? 1 : 0);
    return officialEval(workerId, key);
  }

  function workerByToken(token) {
    const worker = db.prepare('SELECT * FROM ig_workers WHERE token=?').get(String(token || ''));
    if (!worker) return null;
    const company = db.prepare('SELECT * FROM ig_companies WHERE id=?').get(worker.company_id);
    return { worker, company };
  }

  function summaryRow(w) {
    const h = hoursOf(w.id);
    const cert = syncCertificate(w.id);
    return {
      id: w.id, nombre: w.nombre, cedula: w.cedula, cargo: w.cargo, directivo: !!w.directivo,
      token: w.token, ...h,
      certificado: cert ? cert.code : null,
      periodo: cert ? (Number(cert.periodo) || 2025) : null,
      fechaAprobacion: cert ? (cert.fecha_aprobacion || '') : '',
      fechaEmision: cert ? (cert.fecha_emision || '') : ''
    };
  }

  function evalRows(companyId) {
    const workers = db.prepare('SELECT * FROM ig_workers WHERE company_id=? ORDER BY nombre').all(companyId);
    const keys = [...modules.map(m => ({ key: m.id, nombre: m.title })), { key: 'final', nombre: 'Prueba final' }];
    const rows = [];
    for (const w of workers) {
      for (const k of keys) {
        const ev = officialEval(w.id, k.key);
        rows.push({
          worker_id: w.id, nombre: w.nombre, cedula: w.cedula, eval_key: k.key, evaluacion: k.nombre,
          nota: ev.score, intentos: ev.attempts, estado: ev.estado, override: ev.override, comment: ev.comment
        });
      }
    }
    return rows;
  }

  function companyDetail(id) {
    const company = db.prepare('SELECT * FROM ig_companies WHERE id=?').get(id);
    if (!company) return null;
    const workers = db.prepare('SELECT * FROM ig_workers WHERE company_id=? ORDER BY nombre').all(id).map(summaryRow);
    const dirs = workers.filter(w => w.directivo);
    const queue = db.prepare(`SELECT s.id, s.kind, s.module_key, s.answer, s.submitted_at, s.status, w.nombre, w.cedula
      FROM ig_submissions s JOIN ig_workers w ON w.id=s.worker_id
      WHERE w.company_id=? AND s.status='pending' ORDER BY s.submitted_at`).all(id).map(s => ({
      ...s,
      modulo: byId(s.module_key)?.title || s.module_key,
      tipo: s.kind === 'lectura' ? 'Lectura' : 'Taller'
    }));
    const acciones = db.prepare('SELECT * FROM ig_actions WHERE company_id=? ORDER BY fecha DESC, id DESC').all(id);
    return {
      company: { ...company, auto_approve: !!company.auto_approve },
      kpi: {
        trabajadores: workers.length,
        cumplen: workers.filter(w => w.total >= TOTAL_HOURS).length,
        directivos: `${dirs.filter(w => w.total >= TOTAL_HOURS).length}/${dirs.length}`,
        porRevisar: queue.length,
        acciones: acciones.length
      },
      workers, queue, evaluaciones: evalRows(id), acciones,
      materiales: db.prepare('SELECT id, module_key, activity, kind, title, url, original_name, created_at FROM ig_files ORDER BY id DESC').all()
    };
  }

  function insertWorkers(companyId, people) {
    const errors = [];
    let created = 0;
    const insert = db.prepare('INSERT INTO ig_workers(company_id, nombre, cedula, cargo, directivo, token) VALUES(?,?,?,?,?,?)');
    people.forEach((p, idx) => {
      const fila = p.fila || idx + 1;
      const nombre = String(p.nombre || '').trim();
      const cargo = String(p.cargo || '').trim();
      const ced = validarCedula(p.cedula);
      const dir = validarDirectivo(p.directivo);
      if (nombre.length < 3) return errors.push({ fila, error: 'Nombre demasiado corto.' });
      if (!ced.ok) return errors.push({ fila, error: ced.error });
      if (cargo.length < 2) return errors.push({ fila, error: 'Indique el cargo.' });
      if (dir == null) return errors.push({ fila, error: 'Directivo debe ser sí o no.' });
      try {
        insert.run(companyId, nombre, ced.cedula, cargo, dir, crypto.randomBytes(24).toString('hex'));
        created++;
      } catch (e) {
        errors.push({ fila, error: /UNIQUE/.test(String(e.message)) ? 'Esa cédula ya está registrada en la empresa.' : 'No se pudo guardar.' });
      }
    });
    return { created, errors };
  }

  function estadoEntrega(status) {
    return { pending: 'Por revisar', approved: 'Aprobado', rejected: 'Rechazado' }[status] || status || '';
  }

  function kitContext(companyId) {
    const data = companyDetail(companyId);
    if (!data) return null;
    const company = data.company;
    const workers = db.prepare('SELECT * FROM ig_workers WHERE company_id=? ORDER BY nombre').all(companyId);
    const bitacora = [];
    const tareas = [];
    for (const w of workers) {
      for (const m of modules) {
        const lec = sub.get(w.id, m.id, 'lectura');
        bitacora.push({
          trabajador: w.nombre, cedula: w.cedula,
          clase: `${m.id.toUpperCase()} · Lectura guiada`, eje: m.title,
          minutos: lec ? Math.round(HOURS.lectura * 60) : 0,
          marcada: lec ? 'SÍ' : 'NO',
          primer: lec ? fechaHora(lec.submitted_at) : '',
          ultimo: lec ? fechaHora(lec.submitted_at) : ''
        });
        if (lec) tareas.push({
          trabajador: w.nombre, cedula: w.cedula, tarea: m.readingTitle || ('Lectura · ' + m.title),
          tipo: 'Lectura', eje: m.title, horas: HOURS.lectura, estado: estadoEntrega(lec.status), nota: '',
          entrega: fechaHora(lec.submitted_at), revision: lec.reviewed_at ? fechaHora(lec.reviewed_at) : '',
          comentario: lec.review_comment || '', respuesta: ''
        });
        const tal = sub.get(w.id, m.id, 'taller');
        if (tal) tareas.push({
          trabajador: w.nombre, cedula: w.cedula, tarea: m.workshop.title,
          tipo: 'Taller', eje: m.title, horas: HOURS.taller, estado: estadoEntrega(tal.status), nota: '',
          entrega: fechaHora(tal.submitted_at), revision: tal.reviewed_at ? fechaHora(tal.reviewed_at) : '',
          comentario: tal.review_comment || '', respuesta: tal.answer || ''
        });
        const ev = officialEval(w.id, m.id);
        if (ev.attempts) {
          const last = attemptsOf.all(w.id, m.id).at(-1);
          const ov = overrideOf.get(w.id, m.id);
          tareas.push({
            trabajador: w.nombre, cedula: w.cedula, tarea: 'Evaluación · ' + m.title,
            tipo: 'Evaluación', eje: m.title, horas: ev.passed ? HOURS.evaluacion : 0, estado: ev.estado,
            nota: ev.score, entrega: fechaHora(last && last.submitted_at), revision: ov ? fechaHora(ov.updated_at) : '',
            comentario: ev.comment || '', respuesta: ''
          });
        }
      }
      const fin = officialEval(w.id, 'final');
      if (fin.attempts) {
        const last = attemptsOf.all(w.id, 'final').at(-1);
        const ov = overrideOf.get(w.id, 'final');
        tareas.push({
          trabajador: w.nombre, cedula: w.cedula, tarea: finalExam.title,
          tipo: 'Prueba final', eje: 'Integración de los cuatro módulos',
          horas: fin.passed ? HOURS.final : 0, estado: fin.estado, nota: fin.score,
          entrega: fechaHora(last && last.submitted_at), revision: ov ? fechaHora(ov.updated_at) : '',
          comentario: fin.comment || '', respuesta: ''
        });
      }
    }
    const filasActa = workers.map(w => ({ nombre: w.nombre, cedula: w.cedula, cargo: w.cargo }));
    while (filasActa.length < 8) filasActa.push({ nombre: '', cedula: '', cargo: '' });
    filasActa.forEach((f, i) => { f.n = String(i + 1); });
    return {
      razon_social: company.razon_social,
      ruc: company.ruc,
      representante_legal: company.representante_legal,
      direccion: company.direccion || '',
      ciudad: company.ciudad || '',
      actividad: company.actividad || '',
      fecha: fechaLarga(),
      generado: fechaHora(new Date().toISOString()),
      anio: anioActual(),
      consolidado: data.workers,
      bitacora, tareas, acciones: data.acciones, filasActa
    };
  }

  function sendFile(res, doc) {
    res.setHeader('Content-Type', doc.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${doc.filename}"`);
    res.send(doc.buffer);
  }

  const router = require('express').Router();
  router.use(admin);

  router.get('/companies', (req, res) => {
    res.json(db.prepare('SELECT id, razon_social, ruc, representante_legal, direccion, ciudad, actividad, auto_approve, periodo, cert_fecha FROM ig_companies ORDER BY razon_social').all()
      .map(c => ({ ...c, auto_approve: !!c.auto_approve })));
  });

  router.post('/companies', (req, res) => {
    const razon = String(req.body.razon_social || '').trim();
    const rep = String(req.body.representante_legal || '').trim();
    const ruc = validarRuc(req.body.ruc);
    if (razon.length < 3) return res.status(400).json({ error: 'Indique la razón social.' });
    if (!ruc.ok) return res.status(400).json({ error: ruc.error });
    if (rep.length < 3) return res.status(400).json({ error: 'Indique el representante legal.' });
    const direccion = textoEmpresa(req.body.direccion, 240);
    const ciudad = textoEmpresa(req.body.ciudad, 120);
    const actividad = textoEmpresa(req.body.actividad, 180);
    const periodo = leerPeriodo(req.body.periodo);
    if (!periodo) return res.status(400).json({ error: 'El período debe ser un año entre 2000 y 2100.' });
    const certFecha = String(req.body.cert_fecha || '').trim();
    if (certFecha && !fechaEnPeriodo(certFecha, periodo)) return res.status(400).json({ error: `La fecha del certificado debe caer en ${periodo}.` });
    const id = db.prepare('INSERT INTO ig_companies(razon_social, ruc, representante_legal, direccion, ciudad, actividad, auto_approve, periodo, cert_fecha) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(razon, ruc.ruc, rep, direccion, ciudad, actividad, req.body.auto_approve ? 1 : 0, periodo, certFecha).lastInsertRowid;
    res.json({ id });
  });

  router.get('/companies/:id', (req, res) => {
    const data = companyDetail(+req.params.id);
    if (!data) return res.status(404).json({ error: 'Empresa no encontrada' });
    res.json(data);
  });

  router.patch('/companies/:id', (req, res) => {
    const company = db.prepare('SELECT * FROM ig_companies WHERE id=?').get(+req.params.id);
    if (!company) return res.status(404).json({ error: 'Empresa no encontrada' });
    const razon = String(req.body.razon_social ?? company.razon_social).trim();
    const rep = String(req.body.representante_legal ?? company.representante_legal).trim();
    const ruc = validarRuc(req.body.ruc ?? company.ruc);
    if (razon.length < 3) return res.status(400).json({ error: 'Indique la razón social.' });
    if (!ruc.ok) return res.status(400).json({ error: ruc.error });
    if (rep.length < 3) return res.status(400).json({ error: 'Indique el representante legal.' });
    const direccion = req.body.direccion == null ? (company.direccion || '') : textoEmpresa(req.body.direccion, 240);
    const ciudad = req.body.ciudad == null ? (company.ciudad || '') : textoEmpresa(req.body.ciudad, 120);
    const actividad = req.body.actividad == null ? (company.actividad || '') : textoEmpresa(req.body.actividad, 180);
    const auto = req.body.auto_approve == null ? company.auto_approve : (req.body.auto_approve ? 1 : 0);
    const periodo = req.body.periodo == null ? (leerPeriodo(company.periodo) || 2025) : leerPeriodo(req.body.periodo);
    if (!periodo) return res.status(400).json({ error: 'El período debe ser un año entre 2000 y 2100.' });
    const certFecha = req.body.cert_fecha == null ? (company.cert_fecha || '') : String(req.body.cert_fecha).trim();
    if (certFecha && !fechaEnPeriodo(certFecha, periodo)) return res.status(400).json({ error: `La fecha del certificado debe caer en ${periodo}.` });
    db.prepare('UPDATE ig_companies SET razon_social=?, ruc=?, representante_legal=?, direccion=?, ciudad=?, actividad=?, auto_approve=?, periodo=?, cert_fecha=? WHERE id=?')
      .run(razon, ruc.ruc, rep, direccion, ciudad, actividad, auto, periodo, certFecha, company.id);
    res.json({ ok: true });
  });

  router.delete('/companies/:id', (req, res) => {
    db.prepare('DELETE FROM ig_companies WHERE id=?').run(+req.params.id);
    res.json({ ok: true });
  });

  router.post('/companies/:id/workers', (req, res) => {
    const company = db.prepare('SELECT id FROM ig_companies WHERE id=?').get(+req.params.id);
    if (!company) return res.status(404).json({ error: 'Empresa no encontrada' });
    const result = insertWorkers(company.id, [{ ...req.body, fila: 1 }]);
    if (!result.created) return res.status(400).json({ error: result.errors[0]?.error || 'No se pudo crear.' });
    res.json({ ok: true });
  });

  router.post('/companies/:id/import', single(uploadTable, 'archivo'), async (req, res) => {
    const company = db.prepare('SELECT id FROM ig_companies WHERE id=?').get(+req.params.id);
    if (!req.file) return res.status(400).json({ error: 'Adjunte un archivo CSV o Excel.' });
    try {
      if (!company) return res.status(404).json({ error: 'Empresa no encontrada' });
      const people = await rowsFromUpload(req.file);
      res.json(insertWorkers(company.id, people));
    } catch (e) {
      res.status(400).json({ error: e.message || 'No se pudo leer el archivo.' });
    } finally {
      removeStored('igualdad', req.file.filename);
    }
  });

  router.delete('/workers/:id', (req, res) => {
    db.prepare('DELETE FROM ig_workers WHERE id=?').run(+req.params.id);
    res.json({ ok: true });
  });

  router.get('/plantilla.xlsx', async (req, res) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Trabajadores');
    ws.addRow(['nombre', 'cedula', 'cargo', 'directivo']);
    ws.addRow(['Ana Ejemplo', '1710034065', 'Analista contable', 'no']);
    ws.getRow(1).font = { bold: true };
    ws.columns = [{ width: 28 }, { width: 16 }, { width: 28 }, { width: 14 }];
    const info = wb.addWorksheet('Instrucciones');
    info.addRow(['Borre la fila de ejemplo antes de importar.']);
    info.addRow(['directivo acepta si / no. La cédula se valida con el dígito verificador ecuatoriano.']);
    info.getColumn(1).width = 90;
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla-igualdad-salarial.xlsx"');
    res.send(Buffer.from(buf));
  });

  router.get('/plantilla.csv', (req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla-igualdad-salarial.csv"');
    res.send('\uFEFFnombre,cedula,cargo,directivo\nAna Ejemplo,1710034065,Analista contable,no\n');
  });

  router.post('/submissions/:id/revisar', (req, res) => {
    const row = db.prepare('SELECT s.*, w.id AS wid FROM ig_submissions s JOIN ig_workers w ON w.id=s.worker_id WHERE s.id=?').get(+req.params.id);
    if (!row) return res.status(404).json({ error: 'Entrega no encontrada' });
    const status = req.body.status === 'approved' ? 'approved' : req.body.status === 'rejected' ? 'rejected' : '';
    const comment = String(req.body.comment || '').trim();
    if (!status) return res.status(400).json({ error: 'Indique si aprueba o rechaza.' });
    if (status === 'rejected' && comment.length < 3) return res.status(400).json({ error: 'Escriba un comentario para el rechazo.' });
    db.prepare('UPDATE ig_submissions SET status=?, review_comment=?, reviewed_at=? WHERE id=?').run(status, comment, new Date().toISOString(), row.id);
    syncCertificate(row.wid);
    res.json({ ok: true });
  });

  router.post('/certificados', async (req, res) => {
    try {
      const lote = await emitirLote(db, { ...req.body, verifyBase: origenPublico(req) });
      const zip = new JSZip();
      for (const item of lote.certificados) zip.file(item.filename, item.pdf);
      const indice = ['codigo,nombre,cedula,cargo,archivo'].concat(lote.certificados.map(item =>
        [item.code, item.nombre, item.cedula, item.cargo, item.filename].map(csvCampo).join(','))).join('\n');
      zip.file('indice.csv', indice);
      const buf = await zip.generateAsync({ type: 'nodebuffer' });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="certificados-igualdad.zip"');
      res.send(buf);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message, errors: e.errors });
    }
  });

  router.post('/workers/:id/certificado', (req, res) => {
    const worker = db.prepare('SELECT * FROM ig_workers WHERE id=?').get(+req.params.id);
    if (!worker) return res.status(404).json({ error: 'Trabajador no encontrado' });
    const cert = syncCertificate(worker.id) || db.prepare('SELECT * FROM ig_certificates WHERE worker_id=?').get(worker.id);
    if (!cert) return res.status(404).json({ error: 'Esta persona todavía no tiene certificado.' });
    const periodo = req.body.periodo == null ? (leerPeriodo(cert.periodo) || 2025) : leerPeriodo(req.body.periodo);
    if (!periodo) return res.status(400).json({ error: 'El período debe ser un año entre 2000 y 2100.' });
    const aprobacion = req.body.fechaAprobacion == null ? (cert.fecha_aprobacion || fechaPorPeriodo(periodo)) : fechaEnPeriodo(req.body.fechaAprobacion, periodo);
    const emision = req.body.fechaEmision == null ? (cert.fecha_emision || fechaPorPeriodo(periodo)) : fechaEnPeriodo(req.body.fechaEmision, periodo);
    if (!aprobacion || !emision) return res.status(400).json({ error: `La fecha de aprobación y la de emisión deben caer en ${periodo}.` });
    db.prepare('UPDATE ig_certificates SET periodo=?, fecha_aprobacion=?, fecha_emision=? WHERE worker_id=?')
      .run(periodo, aprobacion, emision, worker.id);
    res.json({ ok: true, code: cert.code, periodo, fechaAprobacion: aprobacion, fechaEmision: emision });
  });

  router.post('/workers/:id/recalificar', (req, res) => {
    const worker = db.prepare('SELECT * FROM ig_workers WHERE id=?').get(+req.params.id);
    if (!worker) return res.status(404).json({ error: 'Trabajador no encontrado' });
    const key = String(req.body.eval_key || '');
    const known = key === 'final' || modules.some(m => m.id === key);
    if (!known) return res.status(400).json({ error: 'Evaluación desconocida.' });
    const score = Number(req.body.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) return res.status(400).json({ error: 'La nota debe estar entre 0 y 100.' });
    const passed = req.body.passed ? 1 : 0;
    if (passed && score < PASS) return res.status(400).json({ error: `Para aprobar la nota debe ser de al menos ${PASS} %.` });
    const comment = String(req.body.comment || '').trim();
    db.prepare(`INSERT INTO ig_overrides(worker_id, eval_key, score, passed, comment, updated_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(worker_id, eval_key) DO UPDATE SET score=excluded.score, passed=excluded.passed, comment=excluded.comment, updated_at=excluded.updated_at`)
      .run(worker.id, key, Math.round(score), passed, comment, new Date().toISOString());
    const cert = syncCertificate(worker.id);
    res.json({ ok: true, certificado: cert ? cert.code : null });
  });

  router.post('/companies/:id/acciones', (req, res) => {
    const company = db.prepare('SELECT id FROM ig_companies WHERE id=?').get(+req.params.id);
    if (!company) return res.status(404).json({ error: 'Empresa no encontrada' });
    const fecha = String(req.body.fecha || '');
    const tipo = String(req.body.tipo || '');
    const descripcion = String(req.body.descripcion || '').trim();
    const participantes = String(req.body.participantes || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'Indique la fecha.' });
    if (!TIPOS_ART4.includes(tipo)) return res.status(400).json({ error: 'Elija un tipo de acción.' });
    if (descripcion.length < 5) return res.status(400).json({ error: 'Describa la evidencia.' });
    const id = db.prepare('INSERT INTO ig_actions(company_id, fecha, tipo, descripcion, participantes) VALUES(?,?,?,?,?)')
      .run(company.id, fecha, tipo, descripcion, participantes).lastInsertRowid;
    res.json({ id });
  });

  router.delete('/acciones/:id', (req, res) => {
    db.prepare('DELETE FROM ig_actions WHERE id=?').run(+req.params.id);
    res.json({ ok: true });
  });

  router.get('/companies/:id/documentos.zip', async (req, res) => {
    const ctx = kitContext(+req.params.id);
    if (!ctx) return res.status(404).json({ error: 'Empresa no encontrada' });
    sendFile(res, await renderZip(ctx));
  });

  router.get('/companies/:id/documentos/:doc', async (req, res) => {
    const ctx = kitContext(+req.params.id);
    if (!ctx) return res.status(404).json({ error: 'Empresa no encontrada' });
    const doc = await renderDocument(req.params.doc, ctx);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
    sendFile(res, doc);
  });

  router.get('/companies/:id/reporte.xlsx', async (req, res) => {
    const data = companyDetail(+req.params.id);
    if (!data) return res.status(404).json({ error: 'Empresa no encontrada' });
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Consultoría Sánchez';
    const emp = wb.addWorksheet('Empresa');
    const pairs = [
      ['Razón social', data.company.razon_social],
      ['RUC', data.company.ruc],
      ['Representante legal', data.company.representante_legal],
      ['Dirección', data.company.direccion || ''],
      ['Ciudad', data.company.ciudad || ''],
      ['Actividad', data.company.actividad || ''],
      ['Aprobación automática de lecturas y talleres', data.company.auto_approve ? 'Sí' : 'No'],
      ['Trabajadores', data.kpi.trabajadores],
      ['Cumplen 40h', data.kpi.cumplen],
      ['Directivos cumplen', data.kpi.directivos],
      ['Tareas por revisar', data.kpi.porRevisar],
      ['Acciones Art. 4', data.kpi.acciones],
      ['Fecha de generación', fechaLarga()],
      ['Nota', 'Versión de prueba. Apoyo para preparar el reporte de enero ante el Ministerio del Trabajo. La presentación oficial se hace por el mecanismo del MDT. La veracidad corresponde a quien representa a la empresa.']
    ];
    emp.addRow(['Campo', 'Valor']);
    pairs.forEach(p => emp.addRow(p));
    emp.getRow(1).font = { bold: true };
    emp.getColumn(1).width = 52;
    emp.getColumn(2).width = 80;

    const th = wb.addWorksheet('Trabajadores y horas');
    th.addRow(['Nombre', 'Cédula', 'Cargo', 'Directivo', 'Lecturas (h)', 'Tareas (h)', 'Evaluaciones (h)', 'Total (h)', 'Avance %', 'Estado']);
    data.workers.forEach(w => th.addRow([w.nombre, w.cedula, w.cargo, w.directivo ? 'Sí' : 'No', w.lecturas, w.tareas, w.evaluaciones, w.total, w.avance, w.total >= TOTAL_HOURS ? 'Cumple 40h' : 'En progreso']));
    th.getRow(1).font = { bold: true };
    th.columns.forEach(c => { c.width = 20; });

    const ev = wb.addWorksheet('Evaluaciones');
    ev.addRow(['Trabajador', 'Cédula', 'Evaluación', 'Nota %', 'Intentos', 'Estado', 'Comentario de recálculo']);
    data.evaluaciones.forEach(r => ev.addRow([r.nombre, r.cedula, r.evaluacion, r.nota == null ? '' : r.nota, r.intentos, r.estado, r.comment || '']));
    ev.getRow(1).font = { bold: true };
    ev.columns.forEach(c => { c.width = 24; });

    const ac = wb.addWorksheet('Acciones Art.4');
    ac.addRow(['Fecha', 'Tipo', 'Descripción / evidencia', 'Participantes']);
    data.acciones.forEach(a => ac.addRow([a.fecha, a.tipo, a.descripcion, a.participantes || '']));
    ac.getRow(1).font = { bold: true };
    ac.getColumn(1).width = 14;
    ac.getColumn(2).width = 32;
    ac.getColumn(3).width = 60;
    ac.getColumn(4).width = 40;

    const slug = data.company.razon_social.replace(/[^\w]+/g, '-').slice(0, 40);
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-igualdad-${slug || 'empresa'}.xlsx"`);
    res.send(Buffer.from(buf));
  });

  router.get('/solucionario', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(solucionarioHtml(modules, finalExam));
  });

  router.get('/solucionario.pdf', async (req, res) => {
    const buf = await solucionarioPdf(modules, finalExam);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="solucionario-igualdad-salarial.pdf"');
    res.send(buf);
  });

  router.get('/materiales', (req, res) => {
    res.json(db.prepare('SELECT id, module_key, activity, kind, title, url, original_name, created_at FROM ig_files ORDER BY id DESC').all());
  });

  router.post('/materiales', single(uploadMaterial, 'file'), (req, res) => {
    const moduleKey = String(req.body.module_key || '');
    const activity = String(req.body.activity || '');
    const kind = String(req.body.kind || '');
    const title = String(req.body.title || '').trim();
    const modOk = moduleKey === 'final' || modules.some(m => m.id === moduleKey);
    const actOk = (moduleKey === 'final' && activity === 'prueba') || ['lectura', 'taller', 'evaluacion'].includes(activity);
    if (!modOk || !actOk) return res.status(400).json({ error: 'Elija el módulo y la actividad.' });
    if (!['pdf', 'mp4', 'video'].includes(kind)) return res.status(400).json({ error: 'Indique si el material es pdf, mp4 o video.' });
    let url = null, stored = null, original = null, mime = null;
    if (kind === 'video') {
      url = safeHttps(req.body.url);
      if (!url) {
        if (req.file) removeStored('igualdad', req.file.filename);
        return res.status(400).json({ error: 'El video debe ser un enlace https (YouTube, Vimeo o Drive).' });
      }
      if (req.file) removeStored('igualdad', req.file.filename);
    } else {
      if (!req.file) return res.status(400).json({ error: 'Adjunte el archivo.' });
      stored = req.file.filename;
      original = req.file.originalname;
      mime = kind === 'pdf' ? 'application/pdf' : 'video/mp4';
    }
    const id = db.prepare('INSERT INTO ig_files(module_key, activity, kind, title, url, stored_name, original_name, mime) VALUES(?,?,?,?,?,?,?,?)')
      .run(moduleKey, activity, kind, title || original || 'Material', url, stored, original, mime).lastInsertRowid;
    res.json({ id });
  });

  router.delete('/materiales/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM ig_files WHERE id=?').get(+req.params.id);
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    if (row.stored_name) removeStored('igualdad', row.stored_name);
    db.prepare('DELETE FROM ig_files WHERE id=?').run(row.id);
    res.json({ ok: true });
  });

  app.use('/api/admin/igualdad', router);

  app.get('/api/igualdad/:token', (req, res) => {
    const found = workerByToken(req.params.token);
    if (!found) return res.status(404).json({ error: 'El enlace no es válido.' });
    res.json(workerView(found.worker, found.company));
  });

  app.post('/api/igualdad/:token/lectura/:module', (req, res) => {
    const found = workerByToken(req.params.token);
    if (!found) return res.status(404).json({ error: 'El enlace no es válido.' });
    const index = modules.findIndex(m => m.id === req.params.module);
    if (index < 0) return res.status(404).json({ error: 'Módulo no encontrado' });
    if (!activityOpen(found.worker.id, index, 'lectura')) return res.status(403).json({ error: 'Esta lectura todavía está bloqueada.' });
    upsertSubmission(found, modules[index].id, 'lectura', '');
    res.json(workerView(found.worker, found.company));
  });

  app.post('/api/igualdad/:token/taller/:module', (req, res) => {
    const found = workerByToken(req.params.token);
    if (!found) return res.status(404).json({ error: 'El enlace no es válido.' });
    const index = modules.findIndex(m => m.id === req.params.module);
    if (index < 0) return res.status(404).json({ error: 'Módulo no encontrado' });
    if (!activityOpen(found.worker.id, index, 'taller')) return res.status(403).json({ error: 'El taller se abre al completar la lectura de este módulo.' });
    const answer = String(req.body.answer || '').trim();
    if (answer.length < 120) return res.status(400).json({ error: 'Escriba un análisis de al menos 120 caracteres.' });
    upsertSubmission(found, modules[index].id, 'taller', answer);
    res.json(workerView(found.worker, found.company));
  });

  app.post('/api/igualdad/:token/evaluacion/:module', (req, res) => {
    const found = workerByToken(req.params.token);
    if (!found) return res.status(404).json({ error: 'El enlace no es válido.' });
    const mod = byId(req.params.module);
    const index = modules.findIndex(m => m.id === req.params.module);
    if (!mod) return res.status(404).json({ error: 'Módulo no encontrado' });
    if (!activityOpen(found.worker.id, index, 'evaluacion')) return res.status(403).json({ error: 'La evaluación se abre al enviar el taller de este módulo.' });
    const ev = officialEval(found.worker.id, mod.id);
    if (ev.passed) return res.status(400).json({ error: 'Esta evaluación ya está aprobada.' });
    if (ev.attempts >= MAX_ATTEMPTS) return res.status(400).json({ error: 'Ya usó los 3 intentos. Administración puede recalificar.' });
    const graded = grade(mod.questions, req.body.answers);
    if (graded.error) return res.status(400).json({ error: graded.error });
    saveAttempt(found.worker.id, mod.id, graded);
    res.json(workerView(found.worker, found.company));
  });

  app.post('/api/igualdad/:token/final', (req, res) => {
    const found = workerByToken(req.params.token);
    if (!found) return res.status(404).json({ error: 'El enlace no es válido.' });
    if (!modules.every(m => officialEval(found.worker.id, m.id).passed)) return res.status(403).json({ error: 'La prueba final se abre cuando aprueba las cuatro evaluaciones.' });
    const ev = officialEval(found.worker.id, 'final');
    if (ev.passed) return res.status(400).json({ error: 'La prueba final ya está aprobada.' });
    if (ev.attempts >= MAX_ATTEMPTS) return res.status(400).json({ error: 'Ya usó los 3 intentos. Administración puede recalificar.' });
    const graded = grade(finalExam.questions, req.body.answers);
    if (graded.error) return res.status(400).json({ error: graded.error });
    saveAttempt(found.worker.id, 'final', graded);
    res.json(workerView(found.worker, found.company));
  });

  app.get('/api/igualdad/:token/certificado.pdf', async (req, res) => {
    const found = workerByToken(req.params.token);
    if (!found) return res.status(404).json({ error: 'El enlace no es válido.' });
    const cert = syncCertificate(found.worker.id);
    if (!cert) return res.status(403).json({ error: 'El certificado se emite cuando todas las evaluaciones están aprobadas y se completan las 40 horas.' });
    const ev = officialEval(found.worker.id, 'final');
    const fechas = fechasDeCertificado(cert, found.company);
    const buf = await certificatePdf({
      empresa: found.company.razon_social,
      ruc: found.company.ruc,
      empresaLinea: empresaLinea(found.company.razon_social, found.company.ruc),
      nombre: found.worker.nombre,
      cedula: found.worker.cedula,
      cargo: found.worker.cargo,
      fecha: fechas.fechaEmision,
      fechaAprobacion: fechas.fechaAprobacion,
      periodo: fechas.periodo,
      nota: ev.score,
      code: cert.code,
      verifyUrl: `${origenPublico(req)}/verificar/${cert.code}`
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="certificado-${cert.code}.pdf"`);
    res.send(buf);
  });

  app.get('/api/igualdad/:token/archivos/:id', (req, res) => {
    const found = workerByToken(req.params.token);
    if (!found) return res.status(404).json({ error: 'El enlace no es válido.' });
    const file = db.prepare('SELECT * FROM ig_files WHERE id=?').get(+req.params.id);
    if (!file || file.kind === 'video' || !file.stored_name) return res.status(404).json({ error: 'Archivo no encontrado' });
    if (!materialOpen(found.worker.id, file.module_key, file.activity)) return res.status(403).json({ error: 'Ese material todavía está bloqueado.' });
    sendStored(req, res, 'igualdad', file.stored_name, file.mime, file.original_name);
  });

  function fichaCertificado(code) {
    const cert = db.prepare(`SELECT c.*, w.nombre, w.cedula, w.cargo, e.razon_social, e.ruc, e.periodo AS periodo_empresa
      FROM ig_certificates c JOIN ig_workers w ON w.id=c.worker_id JOIN ig_companies e ON e.id=w.company_id
      WHERE c.code=?`).get(String(code || '').toUpperCase());
    if (!cert) return null;
    const ev = officialEval(cert.worker_id, 'final');
    const fechas = fechasDeCertificado(cert, { periodo: cert.periodo_empresa });
    return {
      ok: true,
      valid: true,
      code: cert.code,
      trabajador: cert.nombre,
      cedula: cert.cedula,
      cargo: cert.cargo,
      empresa: cert.razon_social,
      ruc: cert.ruc,
      empresaLinea: empresaLinea(cert.razon_social, cert.ruc),
      programa: 'Igualdad Salarial y No Discriminación',
      programaDetalle: 'Curso de capacitación de 40 horas académicas',
      temas: TEMAS,
      horas: TOTAL_HOURS,
      estado: 'APROBADO',
      nota: ev.score,
      periodo: fechas.periodo,
      fechaAprobacion: fechas.fechaAprobacion,
      fechaEmision: fechas.fechaEmision,
      fecha: fechas.fechaEmision,
      aprobadoPor: FIRMANTE.linea,
      emisor: 'Consultoría Sánchez',
      referencia: 'Acuerdo Ministerial MDT-2025-006'
    };
  }

  app.get('/api/verificar/:code/qr.png', async (req, res) => {
    const code = String(req.params.code || '').toUpperCase();
    const png = await QRCode.toBuffer(`${origenPublico(req)}/verificar/${code}`, {
      margin: 1, width: 280, errorCorrectionLevel: 'M', color: { dark: '#0E2A47', light: '#FFFFFF' }
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(png);
  });

  app.get('/api/verificar/:code', (req, res) => {
    const ficha = fichaCertificado(req.params.code);
    if (!ficha) return res.json({ ok: true, valid: false });
    res.json(ficha);
  });

  app.get('/igualdad/:token', (req, res) => {
    res.sendFile(require('path').join(__dirname, '..', 'public', 'igualdad.html'));
  });
  app.get('/verificar/:code', (req, res) => {
    res.sendFile(require('path').join(__dirname, '..', 'public', 'verificar.html'));
  });

  function materialOpen(workerId, moduleKey, activity) {
    if (moduleKey === 'final') return modules.every(m => officialEval(workerId, m.id).passed);
    const index = modules.findIndex(m => m.id === moduleKey);
    if (index < 0) return false;
    if (activity === 'lectura') return activityOpen(workerId, index, 'lectura');
    if (activity === 'taller') return activityOpen(workerId, index, 'taller');
    if (activity === 'evaluacion') return activityOpen(workerId, index, 'evaluacion');
    return false;
  }

  function upsertSubmission(found, moduleKey, kind, answer) {
    const status = found.company.auto_approve ? 'approved' : 'pending';
    const existing = sub.get(found.worker.id, moduleKey, kind);
    if (existing) {
      db.prepare('UPDATE ig_submissions SET answer=?, status=?, review_comment=NULL, submitted_at=?, reviewed_at=? WHERE id=?')
        .run(answer, status, new Date().toISOString(), status === 'approved' ? new Date().toISOString() : null, existing.id);
    } else {
      db.prepare('INSERT INTO ig_submissions(worker_id, module_key, kind, answer, status, reviewed_at) VALUES(?,?,?,?,?,?)')
        .run(found.worker.id, moduleKey, kind, answer, status, status === 'approved' ? new Date().toISOString() : null);
    }
    syncCertificate(found.worker.id);
  }

  async function rowsFromUpload(file) {
    const fs = require('fs');
    const path = require('path');
    const full = path.join(__dirname, '..', 'uploads', 'igualdad', path.basename(file.filename));
    const ext = path.extname(file.originalname || file.filename).toLowerCase();
    let matrix;
    if (ext === '.csv' || file.mimetype === 'text/csv') {
      matrix = parseCsv(fs.readFileSync(full, 'utf8'));
    } else {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(full);
      const ws = wb.worksheets[0];
      matrix = [];
      ws.eachRow(row => {
        const vals = [];
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          vals[col - 1] = cell.text != null ? String(cell.text) : '';
        });
        matrix.push(vals);
      });
    }
    if (!matrix.length) throw new Error('El archivo está vacío.');
    const headers = matrix[0].map(normHeader);
    const col = name => headers.indexOf(name);
    const iNombre = col('nombre');
    const iCed = col('cedula');
    const iCargo = col('cargo');
    const iDir = col('directivo');
    if (iNombre < 0 || iCed < 0 || iCargo < 0 || iDir < 0) {
      throw new Error('La primera fila debe incluir las columnas nombre, cedula, cargo y directivo.');
    }
    return matrix.slice(1).map((r, n) => ({
      fila: n + 2,
      nombre: r[iNombre],
      cedula: r[iCed],
      cargo: r[iCargo],
      directivo: r[iDir]
    })).filter(p => String(p.nombre || '').trim() || String(p.cedula || '').trim());
  }
}

function csvCampo(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function fallo(message, status = 400, errors) {
  const err = new Error(message);
  err.status = status;
  if (errors) err.errors = errors;
  return err;
}

async function emitirLote(db, input) {
  const periodo = leerPeriodo(input.periodo);
  if (!periodo) throw fallo('El período debe ser un año entre 2000 y 2100.');
  const fecha = input.fecha == null || input.fecha === '' ? `${periodo}-12-15` : fechaEnPeriodo(input.fecha, periodo);
  const fechaAprobacion = input.fechaAprobacion == null || input.fechaAprobacion === '' ? fecha : fechaEnPeriodo(input.fechaAprobacion, periodo);
  const fechaEmision = input.fechaEmision == null || input.fechaEmision === '' ? fecha : fechaEnPeriodo(input.fechaEmision, periodo);
  if (!fecha || !fechaAprobacion || !fechaEmision) throw fallo(`La fecha debe caer dentro de ${periodo}. Si el período es ${periodo}, use por ejemplo ${periodo}-12-15.`);
  const razon = String(input.razon_social || '').trim();
  const ruc = validarRuc(input.ruc);
  if (razon.length < 3) throw fallo('Indique la razón social.');
  if (!ruc.ok) throw fallo(ruc.error);
  const people = Array.isArray(input.trabajadores) ? input.trabajadores : [];
  if (!people.length) throw fallo('Indique al menos un trabajador, con nombre, cédula y cargo.');
  const vistos = new Set();
  const limpios = [];
  const errors = [];
  people.forEach((p, idx) => {
    const fila = p.fila || idx + 1;
    const nombre = String(p.nombre || '').trim();
    const cargo = String(p.cargo || '').trim();
    const ced = validarCedula(p.cedula);
    if (nombre.length < 3) return errors.push({ fila, error: 'Nombre demasiado corto.' });
    if (!ced.ok) return errors.push({ fila, error: ced.error });
    if (cargo.length < 2) return errors.push({ fila, error: 'Indique el cargo.' });
    if (vistos.has(ced.cedula)) return errors.push({ fila, error: 'La cédula está repetida en el lote.' });
    vistos.add(ced.cedula);
    limpios.push({ fila, nombre, cedula: ced.cedula, cargo });
  });
  if (errors.length) throw fallo('Hay filas que no se pueden certificar.', 400, errors);

  const base = String(input.verifyBase || '').replace(/\/$/, '');
  const guardar = db.transaction(() => {
    let company = db.prepare('SELECT * FROM ig_companies WHERE ruc=? ORDER BY id').get(ruc.ruc);
    if (!company) {
      const id = db.prepare('INSERT INTO ig_companies(razon_social, ruc, representante_legal, periodo, cert_fecha) VALUES(?,?,?,?,?)')
        .run(razon, ruc.ruc, 'Por registrar', periodo, fecha).lastInsertRowid;
      company = db.prepare('SELECT * FROM ig_companies WHERE id=?').get(id);
    } else if (company.razon_social !== razon) {
      db.prepare('UPDATE ig_companies SET razon_social=? WHERE id=?').run(razon, company.id);
      company.razon_social = razon;
    }
    const find = db.prepare('SELECT * FROM ig_workers WHERE company_id=? AND cedula=?');
    const insert = db.prepare('INSERT INTO ig_workers(company_id, nombre, cedula, cargo, directivo, token) VALUES(?,?,?,?,0,?)');
    const update = db.prepare('UPDATE ig_workers SET nombre=?, cargo=? WHERE id=?');
    const upsertCert = db.prepare(`INSERT INTO ig_certificates(worker_id, code, issued_at, periodo, fecha_aprobacion, fecha_emision, manual)
      VALUES(?,?,?,?,?,?,1)
      ON CONFLICT(worker_id) DO UPDATE SET periodo=excluded.periodo, fecha_aprobacion=excluded.fecha_aprobacion, fecha_emision=excluded.fecha_emision, manual=1`);
    const readCert = db.prepare('SELECT * FROM ig_certificates WHERE worker_id=?');
    return limpios.map(p => {
      let worker = find.get(company.id, p.cedula);
      if (!worker) {
        insert.run(company.id, p.nombre, p.cedula, p.cargo, crypto.randomBytes(24).toString('hex'));
        worker = find.get(company.id, p.cedula);
      } else {
        update.run(p.nombre, p.cargo, worker.id);
        worker = find.get(company.id, p.cedula);
      }
      const previo = readCert.get(worker.id);
      const code = previo?.code || ('CSLM-' + crypto.randomBytes(4).toString('hex').toUpperCase());
      upsertCert.run(worker.id, code, previo?.issued_at || new Date().toISOString(), periodo, fechaAprobacion, fechaEmision);
      return { code, nombre: worker.nombre, cedula: worker.cedula, cargo: worker.cargo, razon: company.razon_social, ruc: company.ruc };
    });
  });
  const filas = guardar();
  const certificados = [];
  for (const fila of filas) {
    const pdf = await certificatePdf({
      empresa: fila.razon,
      ruc: fila.ruc,
      empresaLinea: empresaLinea(fila.razon, fila.ruc),
      nombre: fila.nombre,
      cedula: fila.cedula,
      cargo: fila.cargo,
      fecha: fechaCalendario(fechaEmision),
      fechaAprobacion: fechaCalendario(fechaAprobacion),
      periodo,
      nota: null,
      code: fila.code,
      verifyUrl: base ? `${base}/verificar/${fila.code}` : ''
    });
    certificados.push({ ...fila, filename: `certificado-${fila.code}.pdf`, pdf });
  }
  return { periodo, fechaAprobacion, fechaEmision, certificados };
}

module.exports = { initSchema, mountIgualdad, TOTAL_HOURS, emitirLote, leerPeriodo, fechaPorPeriodo };
