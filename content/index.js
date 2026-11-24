'use strict';

const fs = require('fs');
const path = require('path');
const m1 = require('./m1');
const m2 = require('./m2');
const m3 = require('./m3');
const m4 = require('./m4');
const finalTest = require('./final');

/** PDFs del curso, servidos desde public/ para que sobrevivan al disco efímero. */
const STATIC_PDFS = [
  {
    activity: 'lectura',
    kind: 'pdf',
    title: 'Manual completo del curso de 40 horas · Consultoría Sánchez',
    file: 'Manual_Curso_40h_Igualdad_Salarial_Consultoria_Sanchez.pdf'
  },
  {
    activity: 'lectura',
    kind: 'pdf',
    title: 'Kit SUT de sensibilización, asistencia y certificado · Consultoría Sánchez',
    file: 'Kit_SUT_Sensibilizacion_Certificado_Consultoria_Sanchez.pdf'
  }
];
const MATERIAL_DIR = '/materiales/igualdad/';

/** Rota las opciones para que la respuesta correcta no caiga siempre en el mismo lugar. */
function spread(questions) {
  return questions.map((q, i) => {
    const n = i % 4;
    if (!n) return { ...q, options: q.options.slice() };
    const options = q.options.slice();
    for (let k = 0; k < n; k++) options.push(options.shift());
    return { ...q, options, answer: (q.answer - n + options.length) % options.length };
  });
}

const modules = [m1, m2, m3, m4].map(m => ({
  ...m,
  materials: [...STATIC_PDFS, ...(m.materials || [])],
  questions: spread(m.questions)
}));
const finalExam = { ...finalTest, questions: spread(finalTest.questions) };

const TIPOS_ART4 = [
  'Afiches en cartelera',
  'Política firmada y difundida',
  'Charla de socialización',
  'Encuesta de clima',
  'Boletín/correo interno',
  'Otra'
];

const HOURS = { lectura: 3.5, taller: 3, evaluacion: 2, final: 6 };
const MODULE_HOURS = HOURS.lectura + HOURS.taller + HOURS.evaluacion;
const TOTAL_HOURS = MODULE_HOURS * modules.length + HOURS.final;
const PASS = 70;
const MAX_ATTEMPTS = 3;

function byId(id) {
  return modules.find(m => m.id === id) || null;
}

function safePdfName(name) {
  const base = String(name || '').split(/[/\\]/).pop();
  return /^[A-Za-z0-9._-]+\.pdf$/.test(base) ? base : '';
}

function canonMedia(url) {
  const s = String(url || '').trim();
  const youtube = s.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  if (youtube) return 'youtube:' + youtube[1];
  const vimeo = s.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return 'vimeo:' + vimeo[1];
  const drive = s.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  if (drive) return 'drive:' + drive[1];
  return s.replace(/\/+$/, '').toLowerCase();
}

function materialKey(file) {
  if (file.kind === 'video' && file.url) return 'video:' + canonMedia(file.url);
  if (file.href && String(file.href).startsWith(MATERIAL_DIR)) return 'href:' + file.href.split('?')[0];
  if (file.href) return 'href:' + String(file.href).split('?')[0];
  return 'id:' + file.kind + ':' + (file.id ?? '') + ':' + (file.url || '');
}

/** Materiales declarados en código: PDFs estáticos y video opcional (env o url del módulo). */
function staticMaterials(moduleKey, activity) {
  const mod = byId(moduleKey);
  if (!mod || !Array.isArray(mod.materials)) return [];
  return mod.materials.filter(item => (item.activity || 'lectura') === activity).flatMap(item => {
    if (item.kind === 'pdf') {
      const file = safePdfName(item.file);
      if (!file) return [];
      const abs = path.join(__dirname, '..', 'public', 'materiales', 'igualdad', file);
      if (!fs.existsSync(abs)) return [];
      return [{
        id: 'static-' + file,
        kind: 'pdf',
        title: item.title || file,
        url: null,
        href: MATERIAL_DIR + encodeURIComponent(file)
      }];
    }
    if (item.kind === 'video') {
      const fromEnv = item.env ? process.env[item.env] : '';
      const url = String(fromEnv || item.url || '').trim();
      if (!/^https:\/\//i.test(url)) return [];
      return [{
        id: 'static-' + (item.env || moduleKey + '-video'),
        kind: 'video',
        title: item.title || 'Video magistral',
        url,
        href: null
      }];
    }
    return [];
  });
}

function mergeMaterials(staticFiles, dbFiles) {
  const seen = new Set();
  const out = [];
  for (const file of [...staticFiles, ...(dbFiles || [])]) {
    const key = materialKey(file);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(file);
  }
  return out;
}

module.exports = {
  modules, finalExam, TIPOS_ART4, HOURS, MODULE_HOURS, TOTAL_HOURS, PASS, MAX_ATTEMPTS, byId,
  STATIC_PDFS, staticMaterials, mergeMaterials, canonMedia
};
