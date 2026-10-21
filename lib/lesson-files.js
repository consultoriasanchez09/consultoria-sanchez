'use strict';

const { single, uploadLesson, removeStored, sendStored, safeHttps } = require('./files');

function listLessonFiles(db, lessonId) {
  return db.prepare('SELECT id, lesson_id, kind, title, url, original_name, mime, created_at FROM lesson_files WHERE lesson_id=? ORDER BY id').all(lessonId)
    .map(f => ({
      id: f.id,
      kind: f.kind,
      title: f.title || f.original_name || 'Material',
      url: f.kind === 'video' ? f.url : null,
      href: f.kind === 'video' ? null : '/api/my/archivos/' + f.id
    }));
}

function attachLessonFiles(db, lessons) {
  return lessons.map(l => ({ ...l, files: listLessonFiles(db, l.id) }));
}

function removeLessonDisk(db, lessonId) {
  const rows = db.prepare('SELECT stored_name FROM lesson_files WHERE lesson_id=? AND stored_name IS NOT NULL').all(lessonId);
  for (const row of rows) removeStored('lecciones', row.stored_name);
}

function mountLessonFiles(adminRouter, app, db, auth) {
  adminRouter.post('/lessons/:id/files', single(uploadLesson, 'file'), (req, res) => {
    const lesson = db.prepare('SELECT id FROM lessons WHERE id=?').get(+req.params.id);
    if (!lesson) return res.status(404).json({ error: 'Clase no encontrada' });
    const kind = String(req.body.kind || '').toLowerCase();
    const title = String(req.body.title || '').trim();
    if (!['pdf', 'mp4', 'video'].includes(kind)) return res.status(400).json({ error: 'Indique si el material es pdf, mp4 o video.' });
    let url = null;
    let stored = null;
    let original = null;
    let mime = null;
    if (kind === 'video') {
      url = safeHttps(req.body.url);
      if (!url) return res.status(400).json({ error: 'El video debe ser un enlace https (YouTube, Vimeo o Drive).' });
      if (req.file) removeStored('lecciones', req.file.filename);
    } else {
      if (!req.file) return res.status(400).json({ error: 'Adjunte el archivo.' });
      const ext = (req.file.originalname || '').toLowerCase();
      if (kind === 'pdf' && req.file.mimetype !== 'application/pdf' && !ext.endsWith('.pdf')) {
        removeStored('lecciones', req.file.filename);
        return res.status(400).json({ error: 'El archivo debe ser PDF.' });
      }
      if (kind === 'mp4' && req.file.mimetype !== 'video/mp4' && !ext.endsWith('.mp4')) {
        removeStored('lecciones', req.file.filename);
        return res.status(400).json({ error: 'El archivo debe ser MP4.' });
      }
      stored = req.file.filename;
      original = req.file.originalname;
      mime = kind === 'pdf' ? 'application/pdf' : 'video/mp4';
    }
    const id = db.prepare('INSERT INTO lesson_files(lesson_id,kind,title,url,stored_name,original_name,mime) VALUES(?,?,?,?,?,?,?)')
      .run(lesson.id, kind, title || original || url, url, stored, original, mime).lastInsertRowid;
    res.json({ id });
  });

  adminRouter.delete('/lesson-files/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM lesson_files WHERE id=?').get(+req.params.id);
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    if (row.stored_name) removeStored('lecciones', row.stored_name);
    db.prepare('DELETE FROM lesson_files WHERE id=?').run(row.id);
    res.json({ ok: true });
  });

  app.get('/api/my/archivos/:id', auth, (req, res) => {
    const row = db.prepare('SELECT f.*, l.course_id FROM lesson_files f JOIN lessons l ON l.id=f.lesson_id WHERE f.id=?').get(+req.params.id);
    if (!row || row.kind === 'video') return res.status(404).json({ error: 'Archivo no encontrado' });
    if (req.user.role !== 'admin') {
      const ok = db.prepare('SELECT 1 FROM enrollments WHERE user_id=? AND course_id=?').get(req.user.id, row.course_id);
      if (!ok) return res.status(403).json({ error: 'No está inscrito en este curso.' });
    }
    sendStored(req, res, 'lecciones', row.stored_name, row.mime, row.original_name);
  });
}

module.exports = { listLessonFiles, attachLessonFiles, removeLessonDisk, mountLessonFiles };
