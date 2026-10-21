'use strict';

const m1 = require('./m1');
const m2 = require('./m2');
const m3 = require('./m3');
const m4 = require('./m4');
const finalTest = require('./final');

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

const modules = [m1, m2, m3, m4].map(m => ({ ...m, questions: spread(m.questions) }));
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

module.exports = {
  modules, finalExam, TIPOS_ART4, HOURS, MODULE_HOURS, TOTAL_HOURS, PASS, MAX_ATTEMPTS, byId
};
