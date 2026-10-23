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
  main.innerHTML = `<p class="banner-test">Versión de prueba. Las horas (lectura 3,5 h, taller 3 h, evaluación 2 h, prueba final 6 h, total 40 h) son la carga acreditada. No hay espera ni tiempo mínimo entre actividades.</p>` + body();
  bind(main);
}

function body() {
  if (current === 'cert') return certHtml();
  if (current === 'final') return finalHtml();
  const m = state.modules.find(x => x.id === current);
  if (!m.unlocked) return `<h2 class="t">${esc(m.title)}</h2><p>Este módulo se abre cuando aprueba la evaluación del módulo anterior.</p>`;
  const tabs = ['lectura', 'taller', 'evaluacion'].map(t => `<button type="button" data-tab="${t}" class="${tab === t ? 'on' : ''}">${t === 'lectura' ? 'Lectura · ' + fmt(m.hours.lectura) + ' h' : t === 'taller' ? 'Taller · ' + fmt(m.hours.taller) + ' h' : 'Evaluación · ' + fmt(m.hours.evaluacion) + ' h'}</button>`).join('');
  return `<h2 class="t">${esc(m.title)}</h2><div class="tabs">${tabs}</div>` + (tab === 'lectura' ? lecturaHtml(m) : tab === 'taller' ? tallerHtml(m) : evalHtml(m));
}

function lecturaHtml(m) {
  const s = m.lectura;
  const sent = s.status === 'approved' || s.status === 'pending';
  return `<p><span class="pill">${esc(statusLabel(s.status))}</span> Carga acreditada: ${fmt(m.hours.lectura)} h.</p>
  ${s.comment ? `<p class="err">Comentario de revisión: ${esc(s.comment)}</p>` : ''}
  <div class="reading">${s.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}</div>${mats(s.materials)}
  ${sent ? '<p class="small">Lectura completada. El taller de este módulo ya está disponible.</p>' : `<p><button class="btn btn-aula" id="sendLec">Lectura completada / Enviar lectura</button></p>`}`;
}

function tallerHtml(m) {
  const s = m.taller;
  if (!s.open) return '<p>El taller se abre al completar la lectura de este módulo.</p>';
  const sent = s.status === 'approved' || s.status === 'pending';
  return `<h3>${esc(s.title)}</h3><p><span class="pill">${esc(statusLabel(s.status))}</span> Carga acreditada: ${fmt(m.hours.taller)} h.</p>
  ${s.comment ? `<p class="err">Comentario: ${esc(s.comment)}</p>` : ''}
  <div class="lesson"><p style="white-space:pre-line">${esc(s.prompt)}</p></div>${mats(s.materials)}
  ${sent ? `<p style="white-space:pre-line">${esc(s.answer)}</p><p class="small">Taller enviado. La evaluación de este módulo ya está disponible. La revisión, si la hay, queda como constancia.</p>` : `<form id="taller"><textarea name="answer" rows="8" required minlength="120" placeholder="Escriba su análisis (mínimo 120 caracteres)">${esc(s.answer)}</textarea><p><button class="btn btn-aula">Enviar taller</button></p></form>`}`;
}

function evalHtml(m) {
  const s = m.evaluacion;
  if (!s.open) return '<p>La evaluación se abre al enviar el taller de este módulo.</p>';
  const head = `<p><span class="pill">${esc(s.estado)}</span> Intentos: ${s.attempts}/${state.maxAttempts}${s.score != null ? ' · Mejor nota visible: ' + s.score + ' %' : ''}</p>${s.comment ? `<p class="small">Recálculo: ${esc(s.comment)}</p>` : ''}${mats(s.materials)}`;
  if (!s.canRetry) return head + reviewHtml(s.review);
  return head + `<form id="quiz">${s.questions.map((q, i) => `<div class="q"><b>${i + 1}. ${esc(q.q)}</b>${q.options.map((op, k) => `<label><input type="radio" name="q${i}" value="${k}" required> ${esc(op)}</label>`).join('')}</div>`).join('')}<button class="btn btn-aula">Enviar evaluación · ${fmt(m.hours.evaluacion)} h</button></form>` + reviewHtml(s.review);
}

function finalHtml() {
  const f = state.final;
  if (!f.unlocked) return `<h2 class="t">Prueba final integradora</h2><p>Se abre cuando aprueba la evaluación de los cuatro módulos. Acredita ${fmt(f.hours)} h si la aprueba.</p>`;
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
  const anio = c.anio || (String(c.fecha || '').match(/(\d{4})\s*$/) || [])[1] || '';
  const mods = [
    ['#5B4B8A', 'MÓDULO 1 · 10 H', 'Derechos Laborales de Mujeres y Hombres', 'Art. 79 CT · Maternidad & IESS'],
    ['#0B5C8A', 'MÓDULO 2 · 10 H', 'Igualdad de Género y Brecha Salarial', 'Arts. 11.2, 331 CRE · Sesgos'],
    ['#C47B2B', 'MÓDULO 3 · 10 H', 'Erradicación de Violencia y No Discriminación', 'Convenio 190 OIT · Protocolos'],
    ['#1B7A4E', 'MÓDULO 4 · 10 H', 'Trabajo de Igual Valor e Igualdad Salarial', 'Convenio 100 OIT · Metodología']
  ].map(([color, k, title, ref]) => `<article class="cert-mod" style="--c:${color}"><b>${esc(k)}</b><strong>${esc(title)}</strong><span>${esc(ref)}</span></article>`).join('');
  return `<div class="cert-sheet">
    <div class="cert-top">
      <div class="cert-brand"><img src="/img/logo.png" alt=""><div><b>Consultoría Sánchez</b><span>La Maná · Capacitación laboral y de género</span></div></div>
      <div class="cert-badge">ART. 3 ACUERDO MINISTERIAL MDT-2025-006</div>
    </div>
    <p class="cert-eye">CERTIFICADO DE CAPACITACIÓN ANUAL</p>
    <h2>LEY ORGÁNICA PARA LA IGUALDAD SALARIAL</h2>
    <p class="lead">Programa Anual Obligatorio de 40 Horas Académicas · Acuerdo Ministerial MDT-2025-006</p>
    <p class="grant">SE OTORGA EL PRESENTE RECONOCIMIENTO A:</p>
    <p class="who">${esc(w.nombre)}</p>
    <p class="meta">C.I.: ${esc(w.cedula)} · Cargo: ${esc(w.cargo)} · Empresa: ${esc(e.razon_social)} · RUC: ${esc(e.ruc)}</p>
    <p class="lead">Por haber completado y aprobado satisfactoriamente los 4 ejes curriculares obligatorios (40 horas lectivas):</p>
    <div class="cert-mods">${mods}</div>
    <div class="cert-bottom">
      <div class="cert-sign"><p class="name">Glenda Sanchez</p><p class="role">Representante Legal</p><p class="firm">Consultoría Sánchez La Maná</p></div>
      <div class="cert-seal"><b>40 HORAS</b><em>APROBADO</em><span>PERÍODO ${esc(anio)}</span></div>
      <div class="cert-verify"><img src="/api/verificar/${esc(c.code)}/qr.png" alt="Código QR de verificación"><div><p><b>VERIFICACIÓN DIGITAL</b></p><p>ID Certificado<br><b>${esc(c.code)}</b></p><p>Emisión: ${esc(c.fecha)}</p><p><a href="/verificar/${esc(c.code)}">Registro electrónico verificable</a></p></div></div>
    </div>
    <p class="cert-issued">EMITIDO POR CONSULTORÍA SÁNCHEZ LA MANÁ</p>
    <p class="cert-issued-sub">Evidencia de la capacitación para inspecciones del Ministerio del Trabajo · La Maná, Cotopaxi</p>
  </div>
  <p style="margin-top:14px"><a class="btn btn-aula" href="/api/igualdad/${encodeURIComponent(token)}/certificado.pdf" target="_blank" rel="noopener">Ver / imprimir PDF</a></p>`;
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
  if (lec) lec.onclick = () => act('lectura/' + current, {});
  const taller = main.querySelector('#taller');
  if (taller) taller.onsubmit = e => { e.preventDefault(); act('taller/' + current, { answer: new FormData(taller).get('answer') }); };
  const quiz = main.querySelector('#quiz');
  if (quiz) quiz.onsubmit = e => { e.preventDefault(); act('evaluacion/' + current, { answers: answersFrom(quiz) }); };
  const fin = main.querySelector('#finalForm');
  if (fin) fin.onsubmit = e => { e.preventDefault(); act('final', { answers: answersFrom(fin) }); };
}

async function act(path, body) {
  try {
    state = await api('/api/igualdad/' + token + '/' + path, { body });
    if (path.startsWith('lectura/')) tab = 'taller';
    if (path.startsWith('taller/')) tab = 'evaluacion';
    render();
  } catch (e) { alert(e.message); }
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
