'use strict';

const crypto = require('crypto');
const ExcelJS = require('exceljs');
const content = require('../content');
const { validarCedula, validarRuc, validarDirectivo } = require('./validate');
const { certificatePdf, solucionarioPdf, solucionarioHtml } = require('./pdf');
const { ensureUploads, safeHttps, single, uploadMaterial, uploadTable, removeStored, sendStored } = require('./files');

const { modules, finalExam, TIPOS_ART4, HOURS, TOTAL_HOURS, PASS, MAX_ATTEMPTS, byId } = content;

function fechaLarga(iso) {
  const d = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', day: '2-digit', month: 'long', year: 'numeric' }).format(d);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ig_companies(
      id INTEGER PRIMARY KEY,
      razon_social TEXT NOT NULL,
      ruc TEXT NOT NULL,
      representante_legal TEXT NOT NULL,
      auto_approve INTEGER NOT NULL DEFAULT 0,
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
      issued_at TEXT NOT NULL
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

  function moduleComplete(workerId, key) {
    const lec = sub.get(workerId, key, 'lectura');
    const tal = sub.get(workerId, key, 'taller');
    return lec?.status === 'approved' && tal?.status === 'approved' && officialEval(workerId, key).passed;
  }

  function moduleUnlocked(workerId, index) {
    if (index <= 0) return true;
    return moduleComplete(workerId, modules[index - 1].id);
  }

  function hoursOf(workerId) {
    let lecturas = 0, tareas = 0, evaluaciones = 0;
    for (const m of modules) {
      if (sub.get(workerId, m.id, 'lectura')?.status === 'approved') lecturas += HOURS.lectura;
      if (sub.get(workerId, m.id, 'taller')?.status === 'approved') tareas += HOURS.taller;
      if (officialEval(workerId, m.id).passed) evaluaciones += HOURS.evaluacion;
    }
    if (officialEval(workerId, 'final').passed) evaluaciones += HOURS.final;
    const total = round1(lecturas + tareas + evaluaciones);
    return {
      lecturas: round1(lecturas), tareas: round1(tareas), evaluaciones: round1(evaluaciones),
      total, avance: Math.min(100, round1(total / TOTAL_HOURS * 100))
    };
  }

  function eligible(workerId) {
    const h = hoursOf(workerId);
    const mods = modules.every(m => moduleComplete(workerId, m.id));
    const fin = officialEval(workerId, 'final').passed;
    return mods && fin && h.total >= TOTAL_HOURS;
  }

  function syncCertificate(workerId) {
    const existing = db.prepare('SELECT * FROM ig_certificates WHERE worker_id=?').get(workerId);
    if (!eligible(workerId)) {
      if (existing) db.prepare('DELETE FROM ig_certificates WHERE worker_id=?').run(workerId);
      return null;
    }
    if (existing) return existing;
    const code = 'CSIG-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    db.prepare('INSERT INTO ig_certificates(worker_id, code, issued_at) VALUES(?,?,?)').run(workerId, code, new Date().toISOString());
    return db.prepare('SELECT * FROM ig_certificates WHERE worker_id=?').get(workerId);
  }

  function activityOpen(workerId, moduleIndex, activity) {
    if (!moduleUnlocked(workerId, moduleIndex)) return false;
    const key = modules[moduleIndex].id;
    if (activity === 'lectura') return true;
    if (activity === 'taller') return sub.get(workerId, key, 'lectura')?.status === 'approved';
    if (activity === 'evaluacion') return sub.get(workerId, key, 'taller')?.status === 'approved';
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
    const finalOpen = modules.every(m => moduleComplete(worker.id, m.id));
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
      certificate: cert ? { code: cert.code, issued_at: cert.issued_at, fecha: fechaLarga(cert.issued_at) } : null,
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
      certificado: cert ? cert.code : null
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

  const router = require('express').Router();
  router.use(admin);

  router.get('/companies', (req, res) => {
    res.json(db.prepare('SELECT id, razon_social, ruc, representante_legal, auto_approve FROM ig_companies ORDER BY razon_social').all()
      .map(c => ({ ...c, auto_approve: !!c.auto_approve })));
  });

  router.post('/companies', (req, res) => {
    const razon = String(req.body.razon_social || '').trim();
    const rep = String(req.body.representante_legal || '').trim();
    const ruc = validarRuc(req.body.ruc);
    if (razon.length < 3) return res.status(400).json({ error: 'Indique la razón social.' });
    if (!ruc.ok) return res.status(400).json({ error: ruc.error });
    if (rep.length < 3) return res.status(400).json({ error: 'Indique el representante legal.' });
    const id = db.prepare('INSERT INTO ig_companies(razon_social, ruc, representante_legal, auto_approve) VALUES(?,?,?,?)')
      .run(razon, ruc.ruc, rep, req.body.auto_approve ? 1 : 0).lastInsertRowid;
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
    const auto = req.body.auto_approve == null ? company.auto_approve : (req.body.auto_approve ? 1 : 0);
    db.prepare('UPDATE ig_companies SET razon_social=?, ruc=?, representante_legal=?, auto_approve=? WHERE id=?')
      .run(razon, ruc.ruc, rep, auto, company.id);
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
    if (!activityOpen(found.worker.id, index, 'taller')) return res.status(403).json({ error: 'El taller se abre cuando la lectura está aprobada.' });
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
    if (!activityOpen(found.worker.id, index, 'evaluacion')) return res.status(403).json({ error: 'La evaluación se abre cuando el taller está aprobado.' });
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
    if (!modules.every(m => moduleComplete(found.worker.id, m.id))) return res.status(403).json({ error: 'La prueba final se abre al completar los cuatro módulos.' });
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
    const buf = await certificatePdf({
      empresa: found.company.razon_social,
      ruc: found.company.ruc,
      representante: found.company.representante_legal,
      nombre: found.worker.nombre,
      cedula: found.worker.cedula,
      fecha: fechaLarga(cert.issued_at),
      code: cert.code
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

  app.get('/api/verificar/:code', (req, res) => {
    const cert = db.prepare(`SELECT c.code, c.issued_at, w.nombre, w.cedula, e.razon_social
      FROM ig_certificates c JOIN ig_workers w ON w.id=c.worker_id JOIN ig_companies e ON e.id=w.company_id
      WHERE c.code=?`).get(String(req.params.code || '').toUpperCase());
    if (!cert) return res.json({ ok: true, valid: false });
    const ced = cert.cedula;
    res.json({
      ok: true, valid: true, code: cert.code, empresa: cert.razon_social, trabajador: cert.nombre,
      cedula: ced.slice(0, 2) + '•••••' + ced.slice(-3), horas: TOTAL_HOURS, fecha: fechaLarga(cert.issued_at),
      programa: 'Capacitación Igualdad Salarial · 40 horas', emisor: 'Consultoría Sánchez'
    });
  });

  app.get('/igualdad/:token', (req, res) => {
    res.sendFile(require('path').join(__dirname, '..', 'public', 'igualdad.html'));
  });
  app.get('/verificar/:code', (req, res) => {
    res.sendFile(require('path').join(__dirname, '..', 'public', 'verificar.html'));
  });

  function materialOpen(workerId, moduleKey, activity) {
    if (moduleKey === 'final') return modules.every(m => moduleComplete(workerId, m.id));
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

module.exports = { initSchema, mountIgualdad, TOTAL_HOURS };
