const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT, name TEXT NOT NULL, email TEXT, role TEXT NOT NULL DEFAULT 'student', access_code TEXT UNIQUE, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS courses(id INTEGER PRIMARY KEY, title TEXT NOT NULL, area TEXT, description TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS lessons(id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, title TEXT NOT NULL, content TEXT, video_url TEXT, material_url TEXT, position INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS enrollments(user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE, PRIMARY KEY(user_id, course_id));
`);

// ---------- Seed ----------
if (!db.prepare("SELECT 1 FROM users WHERE role='admin'").get()) {
  const pw = process.env.ADMIN_PASSWORD || 'CambiarEsta2026!';
  db.prepare("INSERT INTO users(username,password_hash,name,role) VALUES(?,?,?,'admin')")
    .run(process.env.ADMIN_USER || 'admin', bcrypt.hashSync(pw, 10), 'Administrador');
  const c = db.prepare('INSERT INTO courses(title,area,description) VALUES(?,?,?)');
  const l = db.prepare('INSERT INTO lessons(course_id,title,content,video_url,material_url,position) VALUES(?,?,?,?,?,?)');
  const yt = ''; // Agregar enlaces de video reales desde /admin
  const c1 = c.run('Tributación para PYMES y RIMPE', 'Tributación', 'Obligaciones tributarias, declaraciones de IVA y Renta, régimen RIMPE y facturación electrónica.').lastInsertRowid;
  l.run(c1, 'Introducción al RUC y obligaciones', 'Qué es el RUC, cómo obtenerlo y las obligaciones básicas ante el SRI.', yt, 'https://www.sri.gob.ec', 1);
  l.run(c1, 'Declaración de IVA (Formulario 104)', 'Paso a paso de la declaración mensual o semestral de IVA.', yt, '', 2);
  l.run(c1, 'Régimen RIMPE: emprendedores y negocios populares', 'Diferencias, tarifas y plazos del régimen RIMPE.', yt, '', 3);
  const c2 = c.run('Contabilidad básica', 'Contabilidad', 'Fundamentos contables, plan de cuentas, libro diario y estados financieros.').lastInsertRowid;
  l.run(c2, 'La ecuación contable', 'Activo = Pasivo + Patrimonio. Ejemplos prácticos.', yt, '', 1);
  l.run(c2, 'Libro diario y mayor', 'Registro de transacciones y mayorización.', yt, '', 2);
  const c3 = c.run('Auditoría y control interno', 'Auditoría', 'Principios de auditoría, control interno y preparación ante revisiones.').lastInsertRowid;
  l.run(c3, 'Qué es el control interno', 'Componentes del control interno (COSO) aplicados a pequeñas empresas.', yt, '', 1);
  const s = db.prepare("INSERT INTO users(username,password_hash,name,role,access_code) VALUES(?,?,?, 'student', ?)")
    .run('estudiante', bcrypt.hashSync('Estudiante2026', 10), 'Estudiante de Ejemplo', 'DEMO-2026');
  db.prepare('INSERT INTO enrollments VALUES(?,?)').run(s.lastInsertRowid, c1);
  db.prepare('INSERT INTO enrollments VALUES(?,?)').run(s.lastInsertRowid, c2);
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' && process.env.HTTPS === '1', maxAge: 8 * 3600e3 }
}));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/aula', (q, r) => r.sendFile(path.join(__dirname, 'public/aula.html')));
app.get('/admin', (q, r) => r.sendFile(path.join(__dirname, 'public/admin.html')));

// ---------- SRI proxy ----------
const SRI = 'https://srienlinea.sri.gob.ec/sri-catastro-sujeto-servicio-internet/rest/ConsolidadoContribuyente';
const cache = new Map();
async function sriFetch(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}
app.get('/api/sri/:ruc', async (req, res) => {
  let ruc = String(req.params.ruc).replace(/\D/g, '');
  if (ruc.length === 10) ruc += '001'; // cédula -> RUC de persona natural
  if (ruc.length !== 13) return res.status(400).json({ ok: false, error: 'Ingrese una cédula (10 dígitos) o RUC (13 dígitos) válido.' });
  const hit = cache.get(ruc);
  if (hit && Date.now() - hit.t < 3600e3) return res.json(hit.d);
  try {
    const exists = await sriFetch(`${SRI}/existePorNumeroRuc?numeroRuc=${ruc}`);
    if (exists === false || exists === 'false') return res.status(404).json({ ok: false, error: 'El RUC no está registrado en el SRI.' });
    const data = await sriFetch(`${SRI}/obtenerPorNumerosRuc?&ruc=${ruc}`);
    const c = Array.isArray(data) ? data[0] : data;
    if (!c) return res.status(404).json({ ok: false, error: 'No se encontró información para ese RUC.' });
    const d = {
      ok: true, ruc: c.numeroRuc || ruc, razonSocial: c.razonSocial, estado: c.estadoContribuyenteRuc,
      actividad: c.actividadEconomicaPrincipal, tipo: c.tipoContribuyente, regimen: c.regimen, categoria: c.categoria,
      obligadoContabilidad: c.obligadoLlevarContabilidad, agenteRetencion: c.agenteRetencion,
      contribuyenteEspecial: c.contribuyenteEspecial, fechaInicio: c.informacionFechasContribuyente?.fechaInicioActividades
    };
    cache.set(ruc, { t: Date.now(), d });
    res.json(d);
  } catch (e) {
    console.error('SRI error', ruc, e.message);
    res.status(502).json({ ok: false, error: 'El servicio del SRI no responde en este momento. Intente más tarde o consulte directamente en srienlinea.sri.gob.ec.' });
  }
});

// ---------- Auth ----------
const pub = u => u && ({ id: u.id, name: u.name, username: u.username, role: u.role });
app.post('/api/login', (req, res) => {
  const { username, password, code } = req.body || {};
  let u;
  if (code) u = db.prepare("SELECT * FROM users WHERE access_code=? AND role='student'").get(String(code).trim().toUpperCase());
  else if (username && password) {
    u = db.prepare('SELECT * FROM users WHERE username=?').get(String(username).trim());
    if (u && !(u.password_hash && bcrypt.compareSync(String(password), u.password_hash))) u = null;
  }
  if (!u) return res.status(401).json({ error: 'Credenciales o código incorrectos.' });
  req.session.regenerate(() => { req.session.uid = u.id; res.json(pub(u)); });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
const auth = (req, res, next) => {
  const u = req.session.uid && db.prepare('SELECT * FROM users WHERE id=?').get(req.session.uid);
  if (!u) return res.status(401).json({ error: 'No autenticado' });
  req.user = u; next();
};
const admin = (req, res, next) => auth(req, res, () => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Prohibido' }));
app.get('/api/me', auth, (req, res) => res.json(pub(req.user)));

// ---------- Estudiante ----------
app.get('/api/my/courses', auth, (req, res) => {
  const rows = req.user.role === 'admin'
    ? db.prepare('SELECT * FROM courses ORDER BY id').all()
    : db.prepare('SELECT c.* FROM courses c JOIN enrollments e ON e.course_id=c.id WHERE e.user_id=? ORDER BY c.id').all(req.user.id);
  res.json(rows);
});
app.get('/api/my/courses/:id', auth, (req, res) => {
  const id = +req.params.id;
  if (req.user.role !== 'admin' && !db.prepare('SELECT 1 FROM enrollments WHERE user_id=? AND course_id=?').get(req.user.id, id))
    return res.status(403).json({ error: 'No está inscrito en este curso.' });
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(id);
  if (!course) return res.status(404).json({ error: 'No encontrado' });
  course.lessons = db.prepare('SELECT * FROM lessons WHERE course_id=? ORDER BY position,id').all(id);
  res.json(course);
});

// ---------- Admin ----------
const A = express.Router(); A.use(admin);
A.get('/courses', (q, r) => r.json(db.prepare('SELECT c.*,(SELECT COUNT(*) FROM lessons WHERE course_id=c.id) lessons,(SELECT COUNT(*) FROM enrollments WHERE course_id=c.id) students FROM courses c ORDER BY id').all()));
A.post('/courses', (q, r) => { const { title, area, description } = q.body; if (!title) return r.status(400).json({ error: 'Título requerido' });
  r.json({ id: db.prepare('INSERT INTO courses(title,area,description) VALUES(?,?,?)').run(title, area || '', description || '').lastInsertRowid }); });
A.delete('/courses/:id', (q, r) => { db.prepare('DELETE FROM courses WHERE id=?').run(+q.params.id); r.json({ ok: true }); });
A.get('/courses/:id/lessons', (q, r) => r.json(db.prepare('SELECT * FROM lessons WHERE course_id=? ORDER BY position,id').all(+q.params.id)));
A.post('/lessons', (q, r) => { const { course_id, title, content, video_url, material_url, position } = q.body; if (!course_id || !title) return r.status(400).json({ error: 'Curso y título requeridos' });
  r.json({ id: db.prepare('INSERT INTO lessons(course_id,title,content,video_url,material_url,position) VALUES(?,?,?,?,?,?)').run(+course_id, title, content || '', video_url || '', material_url || '', +position || 0).lastInsertRowid }); });
A.delete('/lessons/:id', (q, r) => { db.prepare('DELETE FROM lessons WHERE id=?').run(+q.params.id); r.json({ ok: true }); });
A.get('/students', (q, r) => r.json(db.prepare("SELECT u.id,u.username,u.name,u.email,u.access_code,(SELECT GROUP_CONCAT(course_id) FROM enrollments WHERE user_id=u.id) courses FROM users u WHERE role='student' ORDER BY id").all()));
A.post('/students', (q, r) => { const { name, username, password, email } = q.body; if (!name) return r.status(400).json({ error: 'Nombre requerido' });
  try { r.json({ id: db.prepare("INSERT INTO users(username,password_hash,name,email,role) VALUES(?,?,?,?,'student')").run(username || null, password ? bcrypt.hashSync(password, 10) : null, name, email || '').lastInsertRowid }); }
  catch { r.status(400).json({ error: 'El usuario ya existe' }); } });
A.post('/students/:id/password', (q, r) => { if (!q.body.password) return r.status(400).json({ error: 'Contraseña requerida' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=? AND role=\'student\'').run(bcrypt.hashSync(q.body.password, 10), +q.params.id); r.json({ ok: true }); });
A.post('/students/:id/code', (q, r) => { const code = 'CS-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  db.prepare("UPDATE users SET access_code=? WHERE id=? AND role='student'").run(code, +q.params.id); r.json({ code }); });
A.delete('/students/:id', (q, r) => { db.prepare("DELETE FROM users WHERE id=? AND role='student'").run(+q.params.id); r.json({ ok: true }); });
A.post('/enroll', (q, r) => { db.prepare('INSERT OR IGNORE INTO enrollments VALUES(?,?)').run(+q.body.user_id, +q.body.course_id); r.json({ ok: true }); });
A.post('/unenroll', (q, r) => { db.prepare('DELETE FROM enrollments WHERE user_id=? AND course_id=?').run(+q.body.user_id, +q.body.course_id); r.json({ ok: true }); });
A.post('/password', (q, r) => { if (!q.body.password || q.body.password.length < 8) return r.status(400).json({ error: 'Mínimo 8 caracteres' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(q.body.password, 10), q.user.id); r.json({ ok: true }); });
app.use('/api/admin', A);

app.listen(PORT, () => console.log(`Consultoría Sánchez en http://localhost:${PORT}`));
