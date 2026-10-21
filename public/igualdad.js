const root = document.getElementById('root');
const token = (location.pathname.split('/').filter(Boolean)[1] || '');
const fmt = n => Number(n).toLocaleString('es-EC', { maximumFractionDigits: 1 });

function infoPage() {
  root.innerHTML = `<section style="padding:28px 0 60px"><p class="banner-test">Versión de prueba · despliegue de ensayo. El reporte oficial de enero se presenta por el mecanismo del Ministerio del Trabajo.</p>
  <h1 class="t">Capacitación Igualdad Salarial · 40 horas</h1>
  <p class="sub">Módulo de Consultoría Sánchez, inspirado en el Acuerdo Ministerial MDT-2025-006. El texto, los casos y las evaluaciones son originales.</p>
  <div class="grid">
    <div class="card"><h3>Para la empresa</h3><p>Administración registra la razón social, el RUC y a cada trabajador. Desde ahí se copia el enlace personal, se revisan talleres y se descarga el Excel de apoyo.</p><a class="btn btn-sm btn-aula" href="/admin">Ir a administración</a></div>
    <div class="card"><h3>Para quien trabaja</h3><p>No hay contraseña. El ingreso es el enlace que entrega la empresa. Cuatro módulos y una prueba final. El certificado sale solo si las evaluaciones están aprobadas y se completan las 40 horas.</p></div>
    <div class="card"><h3>Qué incluye cada módulo</h3><ul><li>Lectura guiada · 3,5 h</li><li>Taller de caso · 3 h</li><li>Evaluación · 2 h, mínimo 70 %</li></ul><p class="small">La prueba final integradora acredita 6 h. En total, 40 h.</p></div>
  </div></section>`;
}

function mats(list) {
  if (!list || !list.length) return '';
  return list.map(f => {
    if (f.kind === 'video') return `<p class="small">${esc(f.title)}</p>${embed(f.url)}`;
    if (f.kind === 'mp4') return `<video class="clip" controls src="${esc(f.href)}"></video><p class="small">${esc(f.title)}</p>`;
    return `<p><a class="btn btn-sm btn-aula" href="${esc(f.href)}" target="_blank" rel="noopener">📎 ${esc(f.title)}</a></p>`;
  }).join('');
}

function statusLabel(s) {
  return { locked: 'Bloqueado', available: 'Disponible', pending: 'Por revisar', approved: 'Aprobado', rejected: 'Rechazado' }[s] || s;
}

let state, current = 'm1', tab = 'lectura';

function render() {
  const mods = state.modules.map(m => `<a data-mod="${m.id}" class="${current === m.id ? 'on' : ''} ${m.unlocked ? '' : 'lock'}">${m.unlocked ? '📘' : '🔒'} ${esc(m.title)}</a>`).join('');
  root.innerHTML = `<div class="layout"><aside class="side"><p class="sec">${esc(state.company.razon_social)}</p><h3 style="margin:4px 10px">${esc(state.worker.nombre)}</h3><p class="small" style="margin:0 10px">${fmt(state.hours.total)} / ${state.totalHoras} h</p><div class="bar" style="margin:8px 10px"><i style="width:${state.hours.avance}%"></i></div>${mods}<a data-mod="final" class="${current === 'final' ? 'on' : ''} ${state.final.unlocked ? '' : 'lock'}">${state.final.unlocked ? '📝' : '🔒'} Prueba final · 6 h</a><a data-mod="cert" class="${current === 'cert' ? 'on' : ''}">🏅 Certificado</a></aside><div class="main" id="main"></div></div>`;
  root.querySelectorAll('[data-mod]').forEach(a => a.onclick = () => { current = a.dataset.mod; tab = current === 'final' ? 'final' : 'lectura'; render(); });
  const main = document.getElementById('main');
  main.innerHTML = `<p class="banner-test">Versión de prueba. Las horas se acreditan cuando la lectura y el taller están aprobados y la evaluación está calificada con al menos ${state.pass} %.</p>` + body();
  bind(main);
}

function body() {
  if (current === 'cert') return certHtml();
  if (current === 'final') return finalHtml();
  const m = state.modules.find(x => x.id === current);
  if (!m.unlocked) return `<h2 class="t">${esc(m.title)}</h2><p>Este módulo se abre cuando el anterior tiene la lectura, el taller y la evaluación aprobados.</p>`;
  const tabs = ['lectura', 'taller', 'evaluacion'].map(t => `<button type="button" data-tab="${t}" class="${tab === t ? 'on' : ''}">${t === 'lectura' ? 'Lectura · ' + fmt(m.hours.lectura) + ' h' : t === 'taller' ? 'Taller · ' + fmt(m.hours.taller) + ' h' : 'Evaluación · ' + fmt(m.hours.evaluacion) + ' h'}</button>`).join('');
  return `<h2 class="t">${esc(m.title)}</h2><div class="tabs">${tabs}</div>` + (tab === 'lectura' ? lecturaHtml(m) : tab === 'taller' ? tallerHtml(m) : evalHtml(m));
}

function lecturaHtml(m) {
  const s = m.lectura;
  const done = s.status === 'approved' || s.status === 'pending';
  return `<p><span class="pill">${esc(statusLabel(s.status))}</span> ${s.status === 'approved' ? 'Acredita ' + fmt(m.hours.lectura) + ' h.' : 'Acredita ' + fmt(m.hours.lectura) + ' h cuando se apruebe.'}</p>
  ${s.comment ? `<p class="err">Comentario de revisión: ${esc(s.comment)}</p>` : ''}
  <div class="reading">${s.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}</div>${mats(s.materials)}
  ${s.status === 'approved' ? '' : `<p><button class="btn btn-aula" id="sendLec">${done && s.status === 'pending' ? 'Lectura entregada' : 'Entregar lectura'}</button></p>`}`;
}

function tallerHtml(m) {
  const s = m.taller;
  if (!s.open) return '<p>El taller se abre cuando la lectura está aprobada.</p>';
  return `<h3>${esc(s.title)}</h3><p><span class="pill">${esc(statusLabel(s.status))}</span></p>
  ${s.comment ? `<p class="err">Comentario: ${esc(s.comment)}</p>` : ''}
  <div class="lesson"><p style="white-space:pre-line">${esc(s.prompt)}</p></div>${mats(s.materials)}
  ${s.status === 'approved' ? `<p style="white-space:pre-line">${esc(s.answer)}</p>` : `<form id="taller"><textarea name="answer" rows="8" required minlength="120" placeholder="Escriba su análisis (mínimo 120 caracteres)">${esc(s.answer)}</textarea><p><button class="btn btn-aula">Entregar taller · ${fmt(m.hours.taller)} h</button></p></form>`}`;
}

function evalHtml(m) {
  const s = m.evaluacion;
  if (!s.open) return '<p>La evaluación se abre cuando el taller está aprobado.</p>';
  const head = `<p><span class="pill">${esc(s.estado)}</span> Intentos: ${s.attempts}/${state.maxAttempts}${s.score != null ? ' · Mejor nota visible: ' + s.score + ' %' : ''}</p>${s.comment ? `<p class="small">Recálculo: ${esc(s.comment)}</p>` : ''}${mats(s.materials)}`;
  if (!s.canRetry) return head + reviewHtml(s.review);
  return head + `<form id="quiz">${s.questions.map((q, i) => `<div class="q"><b>${i + 1}. ${esc(q.q)}</b>${q.options.map((op, k) => `<label><input type="radio" name="q${i}" value="${k}" required> ${esc(op)}</label>`).join('')}</div>`).join('')}<button class="btn btn-aula">Enviar evaluación · ${fmt(m.hours.evaluacion)} h</button></form>` + reviewHtml(s.review);
}

function finalHtml() {
  const f = state.final;
  if (!f.unlocked) return `<h2 class="t">Prueba final integradora</h2><p>Se abre cuando los cuatro módulos están completos: lectura, taller y evaluación aprobados.</p>`;
  const head = `<h2 class="t">${esc(f.title)} · ${fmt(f.hours)} h</h2><p>${esc(f.intro)}</p><p><span class="pill">${esc(f.estado)}</span> Intentos: ${f.attempts}/${state.maxAttempts}${f.score != null ? ' · Nota: ' + f.score + ' %' : ''}</p>${f.comment ? `<p class="small">Recálculo: ${esc(f.comment)}</p>` : ''}${mats(f.materials)}`;
  if (!f.canRetry) return head + reviewHtml(f.review);
  return head + `<form id="finalForm">${f.questions.map((q, i) => `<div class="q"><b>${i + 1}. ${esc(q.q)}</b>${q.options.map((op, k) => `<label><input type="radio" name="q${i}" value="${k}" required> ${esc(op)}</label>`).join('')}</div>`).join('')}<button class="btn btn-aula">Enviar prueba final</button></form>` + reviewHtml(f.review);
}

function reviewHtml(review) {
  if (!review) return '';
  return `<div class="lesson"><b>Último intento: ${review.score} %</b><ol>${review.items.map(it => `<li>${it.ok ? 'Correcta' : 'Incorrecta'}${it.why ? ' — ' + esc(it.why) : ''}</li>`).join('')}</ol></div>`;
}

function certHtml() {
  if (!state.certificate) return `<h2 class="t">Certificado</h2><p>Todavía no se emite. Hacen falta las 40 horas y que <b>todas</b> las evaluaciones de módulo y la prueba final estén calificadas y aprobadas.</p><p>Lleva ${fmt(state.hours.total)} de ${state.totalHoras} h.</p>`;
  const c = state.certificate;
  const w = state.worker;
  const e = state.company;
  return `<div class="cert"><img src="/img/logo.png" alt="" style="height:64px"><p style="margin:4px 0;font-weight:800;color:#0E2A47">Consultoría Sánchez</p><p class="small">La Maná · Cotopaxi · Ecuador</p><p class="pill">CAPACITACIÓN</p><h2 class="t">Igualdad Salarial · 40 horas</h2><p>La empresa</p><p class="emp">${esc(e.razon_social)}</p><p class="small">RUC ${esc(e.ruc)} · ${esc(e.representante_legal)}</p><p>certifica que</p><h3 style="font-size:1.6rem;color:#0B5C8A;margin:8px 0">${esc(w.nombre)}</h3><p>cédula ${esc(w.cedula)}</p><p>completó</p><p class="hrs">40 horas</p><p>Fecha: ${esc(c.fecha)}<br>Código: <b>${esc(c.code)}</b></p><p><a href="/verificar/${esc(c.code)}">Página pública de verificación</a></p><p><button class="btn btn-aula" onclick="print()">Imprimir / Guardar PDF</button> <a class="btn btn-sec" href="/api/igualdad/${token}/certificado.pdf">Descargar PDF</a></p><p class="banner-test">Versión de prueba. No reemplaza el reporte oficial ante el Ministerio del Trabajo.</p></div>`;
}

function answersFrom(form) {
  const data = [];
  const n = form.querySelectorAll('.q').length;
  for (let i = 0; i < n; i++) {
    const el = form.querySelector(`input[name="q${i}"]:checked`);
    data.push(el ? Number(el.value) : null);
  }
  return data;
}

function bind(main) {
  main.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
  const lec = main.querySelector('#sendLec');
  if (lec && lec.textContent !== 'Lectura entregada') lec.onclick = () => act('lectura/' + current, {});
  if (lec && lec.textContent === 'Lectura entregada') lec.disabled = true;
  const taller = main.querySelector('#taller');
  if (taller) taller.onsubmit = e => { e.preventDefault(); act('taller/' + current, { answer: new FormData(taller).get('answer') }); };
  const quiz = main.querySelector('#quiz');
  if (quiz) quiz.onsubmit = e => { e.preventDefault(); act('evaluacion/' + current, { answers: answersFrom(quiz) }); };
  const fin = main.querySelector('#finalForm');
  if (fin) fin.onsubmit = e => { e.preventDefault(); act('final', { answers: answersFrom(fin) }); };
}

async function act(path, body) {
  try { state = await api('/api/igualdad/' + token + '/' + path, { body }); render(); }
  catch (e) { alert(e.message); }
}

async function boot() {
  if (!token) return infoPage();
  try { state = await api('/api/igualdad/' + token); }
  catch (e) { root.innerHTML = `<div class="panel"><h2 class="t">Enlace no válido</h2><p class="err">${esc(e.message)}</p><p><a href="/igualdad">Volver a la información del módulo</a></p></div>`; return; }
  const open = state.modules.find(m => m.unlocked);
  current = open ? open.id : 'm1';
  render();
}
boot();
