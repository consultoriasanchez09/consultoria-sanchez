const TIPOS = ['Afiches en cartelera', 'Política firmada y difundida', 'Charla de socialización', 'Encuesta de clima', 'Boletín/correo interno', 'Otra'];
const MODS = [['m1', 'M1 Derechos laborales'], ['m2', 'M2 Igualdad y brecha'], ['m3', 'M3 Violencia y acoso'], ['m4', 'M4 Igual valor'], ['final', 'Prueba final']];

async function igualdadAdmin(root) {
  let companies = [];
  let data = null;
  let flash = '';
  let companyId = Number(sessionStorage.getItem('igCompany') || 0);

  async function reload(id, keepFlash) {
    if (!keepFlash) flash = '';
    companies = await api('/api/admin/igualdad/companies');
    if (id) companyId = id;
    if (companyId && !companies.some(c => c.id === companyId)) companyId = companies[0]?.id || 0;
    sessionStorage.setItem('igCompany', String(companyId || ''));
    data = companyId ? await api('/api/admin/igualdad/companies/' + companyId) : null;
    draw();
  }

  function draw() {
    const opts = companies.map(c => `<option value="${c.id}" ${c.id === companyId ? 'selected' : ''}>${esc(c.razon_social)}</option>`).join('');
    root.innerHTML = `<p class="banner-test">Versión de prueba · Igualdad Salarial · 40 horas. El Excel ordena el reporte; la presentación oficial de enero se hace en el sistema del Ministerio del Trabajo.</p>
    <h2 class="t">Igualdad Salarial</h2>
    ${flash ? `<p class="ok-pill">${esc(flash)}</p>` : ''}
    <form class="f" id="pick"><label>Empresa<select name="id"><option value="">— Nueva —</option>${opts}</select></label></form>
    ${companyForm()}
    ${loteForm()}
    ${data ? dashboard() : '<p>Cree la primera empresa para registrar trabajadores y horas.</p>'}`;
    bind();
  }

  function companyForm() {
    const c = data?.company;
    return `<h3>${c ? 'Datos de la empresa' : 'Nueva empresa'}</h3><form class="f" id="emp">
      <label>Razón social<input name="razon_social" required value="${esc(c?.razon_social || '')}"></label>
      <label>RUC (13 dígitos)<input name="ruc" required inputmode="numeric" maxlength="13" value="${esc(c?.ruc || '')}"></label>
      <label class="full">Representante legal<input name="representante_legal" required value="${esc(c?.representante_legal || '')}"></label>
      <label class="full">Dirección<input name="direccion" value="${esc(c?.direccion || '')}"></label>
      <label>Ciudad<input name="ciudad" value="${esc(c?.ciudad || '')}"></label>
      <label>Actividad económica<input name="actividad" value="${esc(c?.actividad || '')}"></label>
      <label>Período del certificado<input name="periodo" type="number" min="2000" max="2100" value="${esc(c?.periodo || 2025)}"></label>
      <label>Fecha de los certificados<input name="cert_fecha" type="date" value="${esc(c?.cert_fecha || ((c?.periodo || 2025) + '-12-15'))}"></label>
      <label class="full"><input type="checkbox" name="auto_approve" ${c?.auto_approve ? 'checked' : ''}> Aprobar lecturas y talleres automáticamente al entregarlos</label>
      <div><button class="btn btn-aula">${c ? 'Guardar datos' : 'Crear empresa'}</button> ${c ? '<button class="btn btn-sm danger" id="delEmp" type="button">Eliminar empresa</button>' : ''}</div>
    </form>`;
  }

  function loteForm() {
    const c = data?.company;
    const periodo = c?.periodo || 2025;
    const fecha = c?.cert_fecha || (periodo + '-12-15');
    return `<h3>Emitir certificados en lote</h3>
    <p class="small">Escriba una persona por línea: nombre, cédula, cargo. Se descarga un ZIP con un PDF por trabajador y un índice. Cada código CSLM- queda verificable en /verificar. La fecha tiene que caer en el período; con período ${periodo} la fecha sugerida es el 15 de diciembre.</p>
    <form class="f" id="lote">
      <label>Razón social<input name="razon_social" required value="${esc(c?.razon_social || '')}"></label>
      <label>RUC<input name="ruc" required maxlength="13" value="${esc(c?.ruc || '')}"></label>
      <label>Período<input name="periodo" type="number" min="2000" max="2100" value="${periodo}"></label>
      <label>Fecha de aprobación y emisión<input name="fecha" type="date" value="${esc(fecha)}"></label>
      <label class="full">Trabajadores<textarea name="lista" rows="6" placeholder="Ana Pérez, 1712345675, Cajera"></textarea></label>
      <label class="full">O un CSV<input name="archivo" type="file" accept=".csv,text/csv"></label>
      <div><button class="btn btn-aula">Descargar ZIP</button></div>
    </form>`;
  }

  function parseLista(text) {
    return String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).flatMap(line => {
      if (/^nombre\b/i.test(line)) return [];
      const sep = line.includes(';') ? ';' : ',';
      const parts = line.split(sep).map(s => s.trim().replace(/^"|"$/g, ''));
      if (parts.length < 3) return [];
      return [{ nombre: parts[0], cedula: parts[1], cargo: parts.slice(2).join(', ') }];
    });
  }

  function dashboard() {
    const k = data.kpi;
    return `<div class="kpis">
      <div class="kpi"><b>${k.trabajadores}</b><span>Trabajadores</span></div>
      <div class="kpi"><b>${k.cumplen}</b><span>Cumplen 40h</span></div>
      <div class="kpi"><b>${esc(k.directivos)}</b><span>Directivos cumplen x/y</span></div>
      <div class="kpi"><b>${k.porRevisar}</b><span>Tareas por revisar</span></div>
      <div class="kpi"><b>${k.acciones}</b><span>Acciones Art. 4</span></div>
    </div>
    <p><a class="btn btn-sm btn-aula" href="/api/admin/igualdad/companies/${companyId}/reporte.xlsx">Descargar Excel para el Ministerio</a>
    <a class="btn btn-sm btn-sec" href="/api/admin/igualdad/solucionario" target="_blank">Solucionario HTML</a>
    <a class="btn btn-sm btn-sec" href="/api/admin/igualdad/solucionario.pdf">Solucionario PDF</a></p>
    <h3>Documentos de la empresa</h3>
    <p class="small">Afiches, política, acta, encuesta, instructivo y reporte, con la razón social, el RUC, el representante legal, la dirección, la ciudad, la actividad y el personal de esta empresa.</p>
    <p>
      <a class="btn btn-sm btn-sec" href="/api/admin/igualdad/companies/${companyId}/documentos/afiche-valor">Afiche · Igual valor</a>
      <a class="btn btn-sm btn-sec" href="/api/admin/igualdad/companies/${companyId}/documentos/afiche-denuncia">Afiche · Canal de denuncia</a>
      <a class="btn btn-sm btn-sec" href="/api/admin/igualdad/companies/${companyId}/documentos/afiche-tolerancia">Afiche · Tolerancia cero</a>
      <a class="btn btn-sm btn-sec" href="/api/admin/igualdad/companies/${companyId}/documentos/politica">Política</a>
      <a class="btn btn-sm btn-sec" href="/api/admin/igualdad/companies/${companyId}/documentos/acta">Acta de socialización</a>
      <a class="btn btn-sm btn-sec" href="/api/admin/igualdad/companies/${companyId}/documentos/encuesta">Encuesta de clima</a>
      <a class="btn btn-sm btn-sec" href="/api/admin/igualdad/companies/${companyId}/documentos/instructivo">Instructivo Art. 4</a>
      <a class="btn btn-sm btn-sec" href="/api/admin/igualdad/companies/${companyId}/documentos/reporte">Reporte Excel</a>
      <a class="btn btn-sm btn-aula" href="/api/admin/igualdad/companies/${companyId}/documentos.zip">Descargar todo (ZIP)</a>
    </p>
    <h3>Trabajadores</h3><div class="table-wrap"><table class="t"><tr><th>Trabajador</th><th>Cargo</th><th>Lecturas (h)</th><th>Tareas (h)</th><th>Evaluaciones (h)</th><th>Total (h)</th><th>Avance</th><th></th></tr>
    ${data.workers.map(w => `<tr><td>${esc(w.nombre)}${w.directivo ? ' <span class="pill">Directivo</span>' : ''}<br><span class="small">${esc(w.cedula)}</span>${w.certificado ? `<br><span class="small">Cert. ${esc(w.certificado)} · Período ${esc(w.periodo || '')}</span><form data-cert="${w.id}"><input type="date" name="fechaAprobacion" value="${esc(w.fechaAprobacion || '')}" title="Fecha de aprobación"><input type="date" name="fechaEmision" value="${esc(w.fechaEmision || '')}" title="Fecha de emisión"><button class="btn btn-sm btn-sec">Fechas</button></form>` : ''}</td><td>${esc(w.cargo)}</td><td>${w.lecturas}</td><td>${w.tareas}</td><td>${w.evaluaciones}</td><td><b>${w.total}</b></td><td style="min-width:110px"><div class="bar"><i style="width:${w.avance}%"></i></div><span class="small">${w.avance} %</span></td><td><button class="btn btn-sm btn-sec" data-copy="${w.token}">Copiar link</button> <button class="btn btn-sm danger" data-delw="${w.id}">Eliminar</button></td></tr>`).join('') || '<tr><td colspan="8">Sin trabajadores</td></tr>'}
    </table></div>
    <h3>Agregar trabajador</h3><form class="f" id="nw"><label>Nombre<input name="nombre" required></label><label>Cédula<input name="cedula" required inputmode="numeric" maxlength="10"></label><label>Cargo<input name="cargo" required></label><label><input type="checkbox" name="directivo"> Directivo/Rep. legal</label><div><button class="btn btn-aula">Agregar</button></div></form>
    <h3>Importar Excel o CSV</h3><p class="small"><a href="/api/admin/igualdad/plantilla.xlsx">Descargar plantilla Excel</a> · <a href="/api/admin/igualdad/plantilla.csv">Descargar plantilla CSV</a>. Columnas: nombre, cedula, cargo, directivo. Borre la fila de ejemplo.</p>
    <form id="imp"><input type="file" name="archivo" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required> <button class="btn btn-sm btn-aula">Importar</button><p id="impMsg" class="small"></p></form>
    <h3>Entregas por revisar</h3>${data.queue.length ? data.queue.map(q => `<div class="lesson"><b>${esc(q.nombre)}</b> · ${esc(q.cedula)} · ${esc(q.modulo)} · ${esc(q.tipo)}<p class="small">${esc(q.submitted_at || '')}</p>${q.answer ? `<p style="white-space:pre-line">${esc(q.answer)}</p>` : '<p class="small">Lectura marcada como entregada.</p>'}<form data-rev="${q.id}" class="f"><label class="full">Comentario<input name="comment" placeholder="Obligatorio si rechaza"></label><div><button class="btn btn-sm btn-aula" name="status" value="approved">Aprobar</button> <button class="btn btn-sm danger" name="status" value="rejected">Rechazar</button></div></form></div>`).join('') : '<p>No hay entregas pendientes.</p>'}
    <h3>Evaluaciones</h3><div class="table-wrap"><table class="t"><tr><th>Trabajador</th><th>Evaluación</th><th>Nota %</th><th>Intentos</th><th>Estado</th><th>Recalificar</th></tr>
    ${data.evaluaciones.map(r => `<tr><td>${esc(r.nombre)}<br><span class="small">${esc(r.cedula)}</span></td><td>${esc(r.evaluacion)}</td><td>${r.nota == null ? '—' : r.nota}</td><td>${r.intentos}</td><td>${esc(r.estado)}</td><td><form data-re="${r.worker_id}" data-key="${esc(r.eval_key)}" class="f"><input name="score" type="number" min="0" max="100" placeholder="Nota" style="margin:0"><label><input type="checkbox" name="passed"> Aprobada</label><input name="comment" placeholder="Comentario"><button class="btn btn-sm btn-sec">Guardar</button></form></td></tr>`).join('')}
    </table></div>
    <h3>Acciones Art. 4</h3><form class="f" id="acc"><label>Fecha<input type="date" name="fecha" required></label><label>Tipo<select name="tipo">${TIPOS.map(t => `<option>${esc(t)}</option>`).join('')}</select></label><label class="full">Descripción / evidencia<textarea name="descripcion" required></textarea></label><label class="full">Participantes<input name="participantes" placeholder="Todo el personal, turno A…"></label><div><button class="btn btn-aula">Registrar acción</button></div></form>
    <ul>${data.acciones.map(a => `<li><b>${esc(a.fecha)}</b> · ${esc(a.tipo)} — ${esc(a.descripcion)} <span class="small">${esc(a.participantes || '')}</span> <button class="btn btn-sm danger" data-dela="${a.id}">Eliminar</button></li>`).join('') || '<li>Sin acciones registradas.</li>'}</ul>
    <h3>Materiales del módulo</h3><p class="small">PDF, MP4 o enlace de YouTube, Vimeo o Drive. La persona los ve en la actividad cuando esa actividad ya está desbloqueada.</p>
    <form class="f" id="mat"><label>Módulo<select name="module_key">${MODS.map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join('')}</select></label><label>Actividad<select name="activity"><option value="lectura">Lectura</option><option value="taller">Taller</option><option value="evaluacion">Evaluación</option><option value="prueba">Prueba final</option></select></label><label>Tipo<select name="kind"><option value="video">Video (enlace)</option><option value="pdf">PDF</option><option value="mp4">MP4</option></select></label><label>Título<input name="title"></label><label class="full">Enlace https<input name="url" placeholder="https://"></label><label class="full">Archivo<input name="file" type="file" accept=".pdf,.mp4,application/pdf,video/mp4"></label><div><button class="btn btn-aula">Adjuntar</button></div></form>
    <ul>${(data.materiales || []).map(f => `<li>${esc(f.module_key)} · ${esc(f.activity)} · ${esc(f.kind)} · ${esc(f.title || f.original_name || f.url)} <button class="btn btn-sm danger" data-delm="${f.id}">Eliminar</button></li>`).join('') || '<li>Sin materiales.</li>'}</ul>`;
  }

  function bind() {
    const pick = root.querySelector('#pick select');
    if (pick) pick.onchange = () => reload(Number(pick.value) || 0);
    root.querySelector('#emp').onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = { razon_social: fd.get('razon_social'), ruc: fd.get('ruc'), representante_legal: fd.get('representante_legal'), direccion: fd.get('direccion'), ciudad: fd.get('ciudad'), actividad: fd.get('actividad'), auto_approve: fd.get('auto_approve') === 'on', periodo: Number(fd.get('periodo')), cert_fecha: fd.get('cert_fecha') };
      try {
        if (data) { await api('/api/admin/igualdad/companies/' + companyId, { method: 'PATCH', body }); reload(companyId); }
        else { const r = await api('/api/admin/igualdad/companies', { body }); reload(r.id); }
      } catch (err) { alert(err.message); }
    };
    const delEmp = root.querySelector('#delEmp');
    if (delEmp) delEmp.onclick = async () => { if (!confirm('¿Eliminar la empresa y sus trabajadores?')) return; await api('/api/admin/igualdad/companies/' + companyId, { method: 'DELETE' }); companyId = 0; reload(0); };
    root.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
      const url = location.origin + '/igualdad/' + b.dataset.copy;
      try { await navigator.clipboard.writeText(url); } catch { prompt('Copie el enlace', url); return; }
      b.textContent = 'Enlace copiado';
    });
    root.querySelectorAll('[data-delw]').forEach(b => b.onclick = async () => { if (!confirm('¿Eliminar a esta persona?')) return; await api('/api/admin/igualdad/workers/' + b.dataset.delw, { method: 'DELETE' }); reload(companyId); });
    const nw = root.querySelector('#nw');
    if (nw) nw.onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(nw);
      try {
        await api('/api/admin/igualdad/companies/' + companyId + '/workers', { body: { nombre: fd.get('nombre'), cedula: fd.get('cedula'), cargo: fd.get('cargo'), directivo: fd.get('directivo') === 'on' } });
        reload(companyId);
      } catch (err) { alert(err.message); }
    };
    const imp = root.querySelector('#imp');
    if (imp) imp.onsubmit = async e => {
      e.preventDefault();
      const r = await fetch('/api/admin/igualdad/companies/' + companyId + '/import', { method: 'POST', body: new FormData(imp) });
      const d = await r.json().catch(() => ({}));
      const msg = root.querySelector('#impMsg');
      if (!r.ok) { flash = d.error || 'No se importó'; draw(); return; }
      flash = `Importados: ${d.created}. Errores: ${(d.errors || []).map(x => 'fila ' + x.fila + ' ' + x.error).join(' · ') || 'ninguno'}`;
      reload(companyId, true);
    };
    root.querySelectorAll('[data-rev]').forEach(f => f.onsubmit = async e => {
      e.preventDefault();
      const status = e.submitter?.value;
      try { await api('/api/admin/igualdad/submissions/' + f.dataset.rev + '/revisar', { body: { status, comment: new FormData(f).get('comment') } }); reload(companyId); }
      catch (err) { alert(err.message); }
    });
    root.querySelectorAll('[data-re]').forEach(f => f.onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(f);
      try {
        await api('/api/admin/igualdad/workers/' + f.dataset.re + '/recalificar', { body: { eval_key: f.dataset.key, score: Number(fd.get('score')), passed: fd.get('passed') === 'on', comment: fd.get('comment') } });
        reload(companyId);
      } catch (err) { alert(err.message); }
    });
    const acc = root.querySelector('#acc');
    if (acc) acc.onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(acc);
      try { await api('/api/admin/igualdad/companies/' + companyId + '/acciones', { body: Object.fromEntries(fd) }); reload(companyId); }
      catch (err) { alert(err.message); }
    };
    root.querySelectorAll('[data-dela]').forEach(b => b.onclick = async () => { await api('/api/admin/igualdad/acciones/' + b.dataset.dela, { method: 'DELETE' }); reload(companyId); });
    const mat = root.querySelector('#mat');
    if (mat) mat.onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(mat);
      if (fd.get('module_key') === 'final') fd.set('activity', 'prueba');
      const r = await fetch('/api/admin/igualdad/materiales', { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return alert(d.error || 'No se adjuntó');
      reload(companyId);
    };
    root.querySelectorAll('[data-delm]').forEach(b => b.onclick = async () => { await api('/api/admin/igualdad/materiales/' + b.dataset.delm, { method: 'DELETE' }); reload(companyId); });
    root.querySelectorAll('[data-cert]').forEach(f => f.onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(f);
      try {
        await api('/api/admin/igualdad/workers/' + f.dataset.cert + '/certificado', { body: { fechaAprobacion: fd.get('fechaAprobacion'), fechaEmision: fd.get('fechaEmision') } });
        flash = 'Fechas del certificado actualizadas.';
        reload(companyId, true);
      } catch (err) { alert(err.message); }
    });
    const lote = root.querySelector('#lote');
    if (lote) lote.onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(lote);
      let text = String(fd.get('lista') || '');
      const file = fd.get('archivo');
      if (file && file.size) text = await file.text();
      const trabajadores = parseLista(text);
      if (!trabajadores.length) return alert('Indique al menos un trabajador: nombre, cédula, cargo.');
      const r = await fetch('/api/admin/igualdad/certificados', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ razon_social: fd.get('razon_social'), ruc: fd.get('ruc'), periodo: Number(fd.get('periodo')), fecha: fd.get('fecha'), trabajadores }) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); return alert(d.error || 'No se emitieron los certificados.'); }
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'certificados-igualdad.zip';
      a.click();
      flash = `Se emitieron ${trabajadores.length} certificados.`;
      const list = await api('/api/admin/igualdad/companies');
      const match = list.find(c => c.ruc === String(fd.get('ruc') || '').replace(/\D/g, ''));
      reload(match ? match.id : companyId, true);
    };
  }

  try { await reload(companyId); }
  catch (e) { root.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
