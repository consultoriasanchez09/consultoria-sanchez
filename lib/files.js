'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const ROOT = path.join(__dirname, '..', 'uploads');

function ensureUploads() {
  fs.mkdirSync(path.join(ROOT, 'lecciones'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'igualdad'), { recursive: true });
}

function safeHttps(value) {
  try {
    const u = new URL(String(value || '').trim());
    if (u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function storage(subdir) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      ensureUploads();
      cb(null, path.join(ROOT, subdir));
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
      cb(null, crypto.randomBytes(16).toString('hex') + (ext || ''));
    }
  });
}

function uploader(subdir, allowed) {
  return multer({
    storage: storage(subdir),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const ok = allowed.some(a => a.mime === file.mimetype || a.ext === ext);
      cb(ok ? null : new Error('Tipo de archivo no permitido. Use PDF, MP4, XLSX o CSV según el caso.'), ok);
    }
  });
}

const uploadMaterial = uploader('igualdad', [
  { mime: 'application/pdf', ext: '.pdf' },
  { mime: 'video/mp4', ext: '.mp4' }
]);
const uploadLesson = uploader('lecciones', [
  { mime: 'application/pdf', ext: '.pdf' },
  { mime: 'video/mp4', ext: '.mp4' }
]);
const uploadTable = uploader('igualdad', [
  { mime: 'application/pdf', ext: '.pdf' },
  { mime: 'text/csv', ext: '.csv' },
  { mime: 'application/vnd.ms-excel', ext: '.csv' },
  { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx' },
  { mime: 'application/octet-stream', ext: '.xlsx' },
  { mime: 'application/octet-stream', ext: '.csv' }
]);

function single(upload, field) {
  return (req, res, next) => upload.single(field)(req, res, err => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera 25 MB.' : (err.message || 'No se pudo subir el archivo');
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

function absStored(subdir, name) {
  const base = path.basename(String(name || ''));
  const root = path.resolve(ROOT, subdir);
  const full = path.resolve(root, base);
  if (full !== path.join(root, base)) return null;
  return full;
}

function removeStored(subdir, name) {
  const full = absStored(subdir, name);
  if (full && fs.existsSync(full)) fs.unlinkSync(full);
}

function sendStored(req, res, subdir, name, mime, downloadName) {
  const full = absStored(subdir, name);
  if (!full || !fs.existsSync(full)) return res.status(404).json({ error: 'Archivo no encontrado' });
  const stat = fs.statSync(full);
  const type = mime || 'application/octet-stream';
  const safe = String(downloadName || baseName(name)).replace(/["\r\n]/g, '');
  const inline = type === 'application/pdf' || type.startsWith('video/');
  res.setHeader('Content-Type', type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safe}"`);
  const range = req.headers.range;
  if (range && type.startsWith('video/')) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    if (!m) return res.status(416).end();
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : stat.size - 1;
    if (!Number.isFinite(start) || start < 0 || start >= stat.size || end < start || end >= stat.size) {
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      return res.status(416).end();
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', String(end - start + 1));
    fs.createReadStream(full, { start, end }).pipe(res);
    return;
  }
  res.setHeader('Content-Length', String(stat.size));
  if (type.startsWith('video/')) res.setHeader('Accept-Ranges', 'bytes');
  fs.createReadStream(full).pipe(res);
}

function baseName(name) {
  return path.basename(String(name || 'archivo'));
}

module.exports = {
  ensureUploads, safeHttps, single, uploadMaterial, uploadLesson, uploadTable,
  removeStored, sendStored, baseName
};
