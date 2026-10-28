const state = { user: null, companies: [], company: null, catalogs: null, today: '', draft: null };

const NAV = [
  { href: '#/inicio', label: 'Inicio' },
  { href: '#/empresas', label: 'Empresas' },
  { href: '#/empresa', label: 'Ficha de la empresa' },
  { group: 'Maestros', items: [['#/productos', 'Productos y servicios'], ['#/clientes', 'Clientes'], ['#/proveedores', 'Proveedores'], ['#/beneficiarios', 'Beneficiarios'], ['#/empleados', 'Empleados']] },
  { group: 'Ventas', items: [['#/doc/FV', 'Facturas de venta'], ['#/doc/NV', 'Notas de venta'], ['#/doc/COT', 'Cotizaciones'], ['#/doc/NCV', 'Notas de crédito'], ['#/doc/NDV', 'Notas de débito']] },
  { group: 'Compras', items: [['#/doc/FC', 'Facturas de compra'], ['#/doc/RET', 'Retenciones'], ['#/doc/LIQ', 'Liquidaciones de compra'], ['#/doc/NCC', 'Notas de crédito'], ['#/doc/NDC', 'Notas de débito']] },
  { group: 'Cuentas por cobrar', items: [['#/cobro/COBRO/AR', 'Cobros'], ['#/cobro/ANTICIPO/AR', 'Anticipos'], ['#/cobro/CRUCE/AR', 'Cruce de anticipos'], ['#/cobro/VARIOS/AR', 'Cobro a varios'], ['#/estado/AR', 'Estado de cuenta'], ['#/cartera/AR', 'Cartera por vencimiento'], ['#/deudas/AR', 'Deudas al corte']] },
  { group: 'Cuentas por pagar', items: [['#/cobro/PAGO/AP', 'Pagos'], ['#/cobro/ANTICIPO/AP', 'Anticipos'], ['#/cobro/CRUCE/AP', 'Cruce de anticipos'], ['#/cobro/VARIOS/AP', 'Pago a varios'], ['#/estado/AP', 'Estado de cuenta'], ['#/cartera/AP', 'Cartera por vencimiento'], ['#/deudas/AP', 'Deudas al corte']] },
  { group: 'Bancos', items: [['#/bancos', 'Cuentas y movimientos'], ['#/posfechados', 'Cheques posfechados']] },
  { group: 'Inventario', items: [['#/stock', 'Existencias y kardex'], ['#/bodega', 'Documentos de bodega'], ['#/importar', 'Importar compras'], ['#/inv-informe/ventas', 'Informe de ventas'], ['#/inv-informe/compras', 'Informe de compras']] },
  { group: 'Contabilidad', items: [['#/cuentas', 'Plan de cuentas'], ['#/enlace', 'Cuentas de enlace'], ['#/diario', 'Diario general'], ['#/asiento', 'Asiento manual'], ['#/mayor', 'Mayorización'], ['#/descuadrados', 'Asientos descuadrados'], ['#/cierre', 'Cierre del ejercicio'], ['#/comprobacion', 'Balance de comprobación'], ['#/balance', 'Situación financiera'], ['#/resultados', 'Estado de resultados'], ['#/cruces', 'Cruces de saldos']] },
  { group: 'SRI', items: [['#/sri104', 'Resumen formulario 104'], ['#/sri103', 'Resumen formulario 103'], ['#/ats', 'Anexo ATS']] },
  { group: 'Nómina', items: [['#/nomina', 'Rol de pagos']] },
  { href: '#/electronica', label: 'Facturación electrónica' },
  { href: '#/respaldo', label: 'Respaldo' },
  { href: '#/usuarios', label: 'Usuarios', admin: true },
];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function money(cents) {
  const neg = Number(cents) < 0;
  const abs = Math.abs(Math.round(Number(cents) || 0));
  const dec = String(abs % 100).padStart(2, '0');
  const int = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '−' : ''}$${int},${dec}`;
}
function cents(input) {
  let s = String(input ?? '').trim().replace(/\s/g, '');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error('Monto inválido.');
  return Math.round(n * 100);
}
function dateES(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}
function qtyText(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '';
  return Number.isInteger(x) ? String(x) : x.toLocaleString('es-EC', { maximumFractionDigits: 4 });
}
function toast(message) {
  const el = document.getElementById('toast');
  el.hidden = false;
  el.textContent = message;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 4200);
}
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 180) }; }
  if (!res.ok) throw new Error(data.error || 'No se pudo completar la operación.');
  return data;
}
function canWrite() { return state.user && state.user.role !== 'consulta'; }
function canAccount() { return state.user && (state.user.role === 'admin' || state.user.role === 'contador'); }
function docLabel(type) { return state.catalogs?.docTypes?.[type]?.label || type; }
function opt(list, value, labeler = (x) => x.label || x.name) {
  return list.map((item) => `<option value="${esc(item.id ?? item.code ?? item)}" ${String(item.id ?? item.code ?? item) === String(value) ? 'selected' : ''}>${esc(labeler(item))}</option>`).join('');
}

function paintChrome() {
  const here = location.hash || '#/inicio';
  const links = NAV.flatMap((item) => item.items ? item.items.map(([href]) => href) : [item.href]);
  const current = links.filter((href) => here === href || here.startsWith(href + '/')).sort((a, b) => b.length - a.length)[0];
  document.getElementById('sidebar').innerHTML = `
    <div class="brand-lock"><img src="logo.png" alt=""><div><strong>Consultoría Sánchez</strong><span>Sistema contable</span></div></div>
    <div class="company-switch"><select id="company-switch">${state.companies.map((c) => `<option value="${c.id}" ${c.id === state.company?.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    ${NAV.filter((item) => !item.admin || state.user.role === 'admin').map((item) => item.group ? `<div class="group">${esc(item.group)}</div>${item.items.map(([href, label]) => `<a class="nav ${href === current ? 'on' : ''}" href="${href}">${esc(label)}</a>`).join('')}` : `<a class="nav ${item.href === current ? 'on' : ''}" href="${item.href}">${esc(item.label)}</a>`).join('')}
    <a class="nav" href="#/clave">Cambiar mi clave</a>`;
  const title = document.querySelector('#sidebar a.nav.on')?.textContent || 'Contabilidad';
  document.getElementById('topbar').innerHTML = `
    <div style="display:flex;gap:10px;align-items:center"><button class="menu-btn" data-act="menu" type="button">☰</button><h1>${esc(title)}</h1></div>
    <div class="who"><div><strong>${esc(state.user.name)}</strong><div class="muted">${esc(state.user.role)}</div></div><div class="avatar">${esc(state.user.name.slice(0, 1))}</div><button class="btn-sec" data-act="logout" type="button">Salir</button></div>`;
}

function banner() {
  if (!state.company?.is_demo) return '';
  return `<div class="demo-banner">Empresa de demostración. Los saldos, RUC y nombres son ficticios y están separados de las demás empresas.</div>`;
}
function page(inner) { return banner() + inner; }
function rangeFields(from, to) {
  const year = state.today.slice(0, 4);
  return `<label>Desde<input type="date" id="f-from" value="${esc(from || year + '-01-01')}"></label><label>Hasta<input type="date" id="f-to" value="${esc(to || state.today)}"></label>`;
}
function exportLinks(path) {
  return `<a class="btn-sec" href="${path}${path.includes('?') ? '&' : '?'}format=pdf">PDF</a><a class="btn-sec" href="${path}${path.includes('?') ? '&' : '?'}format=xlsx">Excel</a>`;
}

async function renderDashboard(view) {
  const data = await api('/api/dashboard');
  state.today = data.today || state.today;
  const max = Math.max(1, ...data.salesComparison.series.flatMap((s) => s.values));
  const colors = ['#0E2A47', '#29A9E1', '#C4A35A'];
  const agingMax = Math.max(1, ...data.aging.buckets.map((b) => b.cents));
  const beMax = Math.max(1, data.breakeven.pointCents, ...data.breakeven.monthlySales);
  view.innerHTML = page(`
    <section class="kpis">
      <article class="kpi"><span>Ventas del mes</span><b>${money(data.kpis.salesMonthCents)}</b></article>
      <article class="kpi"><span>Por cobrar</span><b>${money(data.kpis.arOpenCents)}</b></article>
      <article class="kpi"><span>Por pagar</span><b>${money(data.kpis.apOpenCents)}</b></article>
      <article class="kpi"><span>Resultado del mes</span><b>${money(data.kpis.resultMonthCents)}</b></article>
    </section>
    <div class="grid-2">
      <article class="card">
        <h3>Ventas comparativas</h3>
        <div class="legend">${data.salesComparison.series.map((s, i) => `<span><i class="swatch" style="background:${colors[i]}"></i>${s.year}</span>`).join('')}</div>
        <div class="bars">${data.salesComparison.months.map((m, idx) => `<div class="bar-col"><div class="bar-stack">${data.salesComparison.series.map((s, i) => `<i title="${s.year}: ${money(s.values[idx])}" style="height:${Math.max(2, s.values[idx] / max * 150)}px;background:${colors[i]}"></i>`).join('')}</div><small>${esc(m.label)}</small></div>`).join('')}</div>
      </article>
      <article class="card">
        <h3>Cartera vencida</h3>
        ${data.aging.buckets.filter((b) => b.id !== 'por_vencer').map((b) => `<div class="age-row"><span>${esc(b.label)}</span><b><i style="width:${b.cents / agingMax * 100}%"></i></b><span class="num">${money(b.cents)}</span></div>`).join('')}
        <p class="muted">Por vencer: ${money(data.aging.buckets.find((b) => b.id === 'por_vencer')?.cents || 0)} · Vencido: ${money(data.aging.overdueCents)}</p>
      </article>
    </div>
    <article class="card" style="margin-top:14px">
      <h3>Punto de equilibrio mensual</h3>
      <p class="muted">Con el margen del año (${(data.breakeven.margin * 100).toFixed(1)}%), el equilibrio mensual estimado es ${money(data.breakeven.pointCents)}. Costos fijos promedio ${money(data.breakeven.monthlyFixedCents)}.</p>
      <svg viewBox="0 0 640 160" width="100%" height="160" role="img">
        ${data.breakeven.monthlySales.map((v, i) => {
          const x = 30 + i * (580 / Math.max(1, data.breakeven.monthlySales.length));
          const h = v / beMax * 120;
          return `<rect x="${x}" y="${140 - h}" width="28" height="${h}" rx="4" fill="#0B5C8A"></rect>`;
        }).join('')}
        <line x1="20" x2="620" y1="${140 - data.breakeven.pointCents / beMax * 120}" y2="${140 - data.breakeven.pointCents / beMax * 120}" stroke="#C4A35A" stroke-dasharray="5 4" stroke-width="2"></line>
      </svg>
    </article>
    <article class="card" style="margin-top:14px">
      <h3>Movimientos recientes</h3>
      <div class="table-wrap"><table class="data"><thead><tr><th>Fecha</th><th>Documento</th><th>Persona</th><th class="num">Total</th><th></th></tr></thead>
      <tbody>${data.recent.map((d) => `<tr class="click" data-href="#/doc/${d.doc_type}/${d.id}"><td>${dateES(d.doc_date)}</td><td>${esc(docLabel(d.doc_type))} ${esc(d.doc_number)}</td><td>${esc(d.party_name)}</td><td class="num">${money(d.total_cents)}</td><td><span class="pill ${d.status === 'ANULADO' ? 'bad' : ''}">${esc(d.status)}</span></td></tr>`).join('')}</tbody></table></div>
    </article>`);
}

async function renderCompanies(view) {
  view.innerHTML = page(`<div class="toolbar">${state.user.role === 'admin' ? '<button class="btn" data-act="new-company" type="button">Nueva empresa</button>' : ''}</div>
    <article class="card"><table class="data"><thead><tr><th>Razón social</th><th>RUC</th><th>Ciudad</th><th>Régimen</th><th></th></tr></thead>
    <tbody>${state.companies.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.ruc)}</td><td>${esc(c.city || '')}</td><td>${esc(c.regimen)}</td><td>${c.is_demo ? '<span class="pill warn">DEMO</span>' : ''}</td></tr>`).join('')}</tbody></table></article>`);
}

function companyFields(c = {}) {
  const regimes = state.catalogs.regimenes.map((r) => `<option value="${r.id}" ${c.regimen === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('');
  return `<div class="form-grid">
    <label class="wide">Razón social<input name="name" required value="${esc(c.name || '')}"></label>
    <label class="wide">Nombre comercial<input name="commercialName" value="${esc(c.commercial_name || '')}"></label>
    <label>RUC<input name="ruc" required value="${esc(c.ruc || '')}"></label>
    <label>Régimen<select name="regimen">${regimes}</select></label>
    <label class="wide">Dirección<input name="address" value="${esc(c.address || '')}"></label>
    <label>Ciudad<input name="city" value="${esc(c.city || '')}"></label>
    <label>Provincia<input name="province" value="${esc(c.province || '')}"></label>
    <label>Teléfono<input name="phone" value="${esc(c.phone || '')}"></label>
    <label>Correo<input name="email" value="${esc(c.email || '')}"></label>
    <label>Establecimiento<input name="establecimiento" value="${esc(c.establecimiento || '001')}"></label>
    <label>Punto de emisión<input name="puntoEmision" value="${esc(c.punto_emision || '001')}"></label>
    <label>Resolución de agente de retención<input name="resolucionAgente" value="${esc(c.resolucion_agente || '')}"></label>
    <label class="check"><input type="checkbox" name="obligado" ${c.obligado ? 'checked' : ''}> Obligado a llevar contabilidad</label>
    <label class="check"><input type="checkbox" name="agenteRetencion" ${c.agente_retencion ? 'checked' : ''}> Agente de retención</label>
  </div>`;
}

async function renderCompany(view) {
  const c = await api('/api/company');
  view.innerHTML = page(`<form id="company-form" class="sheet"><h3>Datos de la empresa</h3>${companyFields(c)}
    <div class="toolbar" style="margin-top:12px">${canAccount() ? '<button class="btn" type="submit">Grabar ficha</button>' : ''}</div></form>`);
  document.getElementById('company-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const saved = await api('/api/company', { method: 'PUT', body: readForm(e.target) });
      state.company = state.companies.find((x) => x.id === saved.id) || saved;
      Object.assign(state.companies.find((x) => x.id === saved.id) || {}, saved);
      toast('Ficha actualizada.');
      paintChrome();
    } catch (err) { toast(err.message); }
  };
}

const PARTY = { clientes: 'CLIENTE', proveedores: 'PROVEEDOR', beneficiarios: 'BENEFICIARIO', empleados: 'EMPLEADO' };

async function renderParties(view, key) {
  const kind = PARTY[key];
  const data = await api('/api/parties?kind=' + kind);
  view.innerHTML = page(`<div class="toolbar">${canWrite() ? `<button class="btn" data-act="party" data-kind="${kind}" type="button">Nuevo</button>` : ''}</div>
    <article class="card"><table class="data"><thead><tr><th>Identificación</th><th>Nombre</th><th>${kind === 'EMPLEADO' ? 'Cargo / sueldo' : 'Contacto'}</th><th></th></tr></thead>
    <tbody>${data.items.map((p) => `<tr><td>${esc(p.identification)}</td><td>${esc(p.name)}</td><td>${kind === 'EMPLEADO' ? esc(p.position || '') + ' · ' + money(p.salary_cents) : esc(p.email || p.city || p.phone || '')}</td><td>${canWrite() ? `<button class="btn-sec" data-act="party" data-id="${p.id}" type="button">Editar</button>` : ''} ${p.blocked ? '<span class="pill bad">Bloqueado</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="4">No hay registros.</td></tr>'}</tbody></table></article>`);
  state.partyCache = data.items;
}

function partyForm(kind, p = {}) {
  const ids = state.catalogs.idTypes.filter((t) => kind === 'CLIENTE' || t.id !== 'CONSUMIDOR_FINAL');
  return `<form id="modal-form"><h3>${p.id ? 'Editar' : 'Nuevo'} ${esc(kind.toLowerCase())}</h3><div class="form-grid">
    <label>Tipo<select name="idType">${opt(ids, p.id_type || 'RUC')}</select></label>
    <label>Identificación<input name="identification" value="${esc(p.identification || '')}" required></label>
    <label class="wide">Nombre / razón social<input name="name" value="${esc(p.name || '')}" required></label>
    <label class="wide">Nombre comercial<input name="commercialName" value="${esc(p.commercial_name || '')}"></label>
    <label>Correo<input name="email" value="${esc(p.email || '')}"></label>
    <label>Teléfono<input name="phone" value="${esc(p.phone || '')}"></label>
    <label class="wide">Dirección<input name="address" value="${esc(p.address || '')}"></label>
    ${kind !== 'EMPLEADO' ? `<label>Días de crédito<input name="creditDays" type="number" value="${esc(p.credit_days || 0)}"></label><label>Cupo<input name="creditLimit" value="${p.credit_limit_cents ? (p.credit_limit_cents / 100).toFixed(2) : ''}"></label>` : ''}
    ${kind === 'EMPLEADO' ? `<label>Cargo<input name="position" value="${esc(p.position || '')}"></label><label>Departamento<input name="department" value="${esc(p.department || '')}"></label><label>Ingreso<input type="date" name="hireDate" value="${esc(p.hire_date || '')}"></label><label>Sueldo<input name="salary" value="${p.salary_cents ? (p.salary_cents / 100).toFixed(2) : ''}" required></label><label class="check"><input type="checkbox" name="reserveFund" ${p.reserve_fund ? 'checked' : ''}> Fondos de reserva</label><label class="check"><input type="checkbox" name="thirteenthMonthly" ${p.thirteenth_monthly !== 0 ? 'checked' : ''}> Décimo tercero mensual</label><label class="check"><input type="checkbox" name="fourteenthMonthly" ${p.fourteenth_monthly !== 0 ? 'checked' : ''}> Décimo cuarto mensual</label>` : ''}
    ${kind === 'BENEFICIARIO' ? '<label class="check"><input type="checkbox" name="alsoClient"> Incluir también como cliente</label>' : ''}
    <label class="check"><input type="checkbox" name="relatedParty" ${p.related_party ? 'checked' : ''}> Parte relacionada</label>
    <label class="check"><input type="checkbox" name="blocked" ${p.blocked ? 'checked' : ''}> Bloqueado</label>
    <label class="check"><input type="checkbox" name="active" ${p.active !== 0 ? 'checked' : ''}> Activo</label>
    <input type="hidden" name="kind" value="${kind}"><input type="hidden" name="id" value="${p.id || ''}">
  </div><div class="toolbar"><button class="btn" type="submit">Grabar</button><button class="btn-sec" type="button" data-act="close-modal">Cerrar</button></div></form>`;
}

async function renderProducts(view) {
  const data = await api('/api/products');
  state.productCache = data.items;
  view.innerHTML = page(`<div class="toolbar">${canWrite() ? '<button class="btn" data-act="product" type="button">Nuevo producto</button>' : ''}</div>
    <article class="card"><table class="data"><thead><tr><th>Código</th><th>Nombre</th><th>IVA</th><th>ICE</th><th>Stock</th><th class="num">Precio</th><th></th></tr></thead>
    <tbody>${data.items.map((p) => `<tr><td>${esc(p.code)}</td><td>${esc(p.name)}</td><td>${p.iva_rate}%</td><td>${p.ice_rate || 0}%</td><td>${p.inventoriable ? qtyText(p.stock_qty) + ' ' + esc(p.unit) : '—'}</td><td class="num">${money(p.price_cents)}</td><td>${canWrite() ? `<button class="btn-sec" data-act="product" data-id="${p.id}" type="button">Editar</button>` : ''}</td></tr>`).join('')}</tbody></table></article>`);
}

function productForm(p = {}) {
  return `<form id="modal-form"><h3>${p.id ? 'Editar' : 'Nuevo'} producto o servicio</h3><div class="form-grid">
    <label>Código<input name="code" value="${esc(p.code || '')}" required></label>
    <label class="wide">Nombre<input name="name" value="${esc(p.name || '')}" required></label>
    <label>Tipo<select name="kind"><option value="BIEN" ${p.kind !== 'SERVICIO' ? 'selected' : ''}>Bien</option><option value="SERVICIO" ${p.kind === 'SERVICIO' ? 'selected' : ''}>Servicio</option></select></label>
    <label>Unidad<input name="unit" value="${esc(p.unit || 'UND')}"></label>
    <label>IVA<select name="ivaRate"><option ${p.iva_rate === 0 ? 'selected' : ''}>0</option><option ${p.iva_rate !== 0 ? 'selected' : ''}>15</option></select></label>
    <label>ICE %<input name="iceRate" value="${esc(p.ice_rate || 0)}"></label>
    <label>Precio<input name="price" value="${p.price_cents ? (p.price_cents / 100).toFixed(2) : ''}" required></label>
    <label class="check"><input type="checkbox" name="inventoriable" ${p.inventoriable ? 'checked' : ''}> Inventariable</label>
    <label class="check"><input type="checkbox" name="active" ${p.active !== 0 ? 'checked' : ''}> Activo</label>
    <input type="hidden" name="id" value="${p.id || ''}">
  </div><div class="toolbar"><button class="btn" type="submit">Grabar</button><button class="btn-sec" type="button" data-act="close-modal">Cerrar</button></div></form>`;
}

async function renderDocList(view, type) {
  const { from, to } = { from: state.today.slice(0, 4) + '-01-01', to: state.today };
  const data = await api(`/api/documents?type=${type}&from=${from}&to=${to}`);
  view.innerHTML = page(`<div class="toolbar">${canWrite() ? `<a class="btn" href="#/doc/${type}/nueva">Nuevo</a>` : ''}<span class="muted">${esc(docLabel(type))}</span></div>
    <article class="card"><table class="data"><thead><tr><th>Número</th><th>Fecha</th><th>Persona</th><th class="num">Total</th><th class="num">Saldo</th><th></th></tr></thead>
    <tbody>${data.items.map((d) => `<tr class="click" data-href="#/doc/${type}/${d.id}"><td>${esc(d.doc_number)}</td><td>${dateES(d.doc_date)}</td><td>${esc(d.party_name)}</td><td class="num">${money(d.total_cents)}</td><td class="num">${d.balance_cents == null ? '—' : money(d.balance_cents)}</td><td><span class="pill ${d.status === 'ANULADO' ? 'bad' : d.status === 'CONVERTIDA' ? 'warn' : ''}">${esc(d.status)}</span></td></tr>`).join('') || '<tr><td colspan="6">No hay documentos en el año.</td></tr>'}</tbody></table></article>`);
}

function liveTotals(lines) {
  let subtotal = 0, discount = 0, base15 = 0, base0 = 0, ice = 0, iva = 0;
  for (const line of lines) {
    const q = Number(String(line.qty || 0).replace(',', '.')) || 0;
    const price = cents(line.price || 0);
    const disc = cents(line.discount || 0);
    const gross = Math.round(q * price);
    const base = Math.max(0, gross - disc);
    const iceL = Math.round(base * (Number(line.iceRate) || 0) / 100);
    const rate = Number(line.ivaRate) || 0;
    const ivaL = rate ? Math.round((base + iceL) * rate / 100) : 0;
    subtotal += gross; discount += Math.min(disc, gross);
    if (rate > 0) base15 += base; else base0 += base;
    ice += iceL; iva += ivaL;
  }
  return { subtotal, discount, base15, base0, ice, iva, total: subtotal - discount + ice + iva };
}

function totalsHtml(t) {
  return `<div class="totals"><div><span>Subtotal</span><span>${money(t.subtotal)}</span></div><div><span>Descuento</span><span>${money(t.discount)}</span></div><div><span>Base IVA 15%</span><span>${money(t.base15)}</span></div><div><span>Base IVA 0%</span><span>${money(t.base0)}</span></div><div><span>ICE</span><span>${money(t.ice)}</span></div><div><span>IVA</span><span>${money(t.iva)}</span></div><div class="grand"><span>Total</span><span>${money(t.total)}</span></div></div>`;
}

async function renderDoc(view, type, id) {
  if (id === 'nueva') return renderDocEditor(view, type);
  const doc = await api('/api/documents/' + id);
  const t = { subtotal: doc.subtotal_cents, discount: doc.discount_cents, base15: doc.base15_cents, base0: doc.base0_cents, ice: doc.ice_cents, iva: doc.iva_cents, total: doc.total_cents };
  view.innerHTML = page(`<article class="sheet"><div class="sheet-head"><div><h3 style="margin:0">${esc(docLabel(doc.doc_type))}</h3><p class="muted">${esc(doc.doc_number)} · ${dateES(doc.doc_date)} · ${esc(doc.party_name)} · ${esc(doc.party_ident || '')}</p></div><span class="pill ${doc.status === 'ANULADO' ? 'bad' : ''}">${esc(doc.status)}</span></div>
    <div class="split"><div class="table-wrap"><table class="data"><thead><tr><th>Detalle</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Desc.</th><th>IVA</th><th class="num">Total</th></tr></thead>
      <tbody>${(doc.lines || []).map((l) => `<tr><td>${esc(l.description)}</td><td class="num">${qtyText(l.qty)}</td><td class="num">${money(l.unit_price_cents)}</td><td class="num">${money(l.discount_cents)}</td><td>${l.iva_rate}%</td><td class="num">${money(l.total_cents)}</td></tr>`).join('')}
      ${(doc.retentions || []).map((r) => `<tr><td>Retención ${esc(r.tax)} ${esc(r.code)}</td><td colspan="3">Base ${money(r.base_cents)} · ${r.rate}%</td><td></td><td class="num">${money(r.amount_cents)}</td></tr>`).join('')}</tbody></table>
      <div class="tabs"><button type="button" class="on" data-tab="conta">Contabilidad</button><button type="button" data-tab="pago">Forma de pago</button><button type="button" data-tab="cheque">Cheque</button></div>
      <div data-panel="conta"><table class="data"><thead><tr><th>Cuenta</th><th class="num">Débito</th><th class="num">Crédito</th></tr></thead><tbody>${(doc.journal || []).map((l) => `<tr><td>${esc(l.code)} ${esc(l.name)}</td><td class="num">${l.debit_cents ? money(l.debit_cents) : ''}</td><td class="num">${l.credit_cents ? money(l.credit_cents) : ''}</td></tr>`).join('') || '<tr><td colspan="3">Este documento no genera asiento.</td></tr>'}</tbody></table></div>
      <div data-panel="pago" hidden><p>Forma de pago: <strong>${esc(doc.payment_method || '—')}</strong> · Plazo ${doc.term_days || 0} días · Vence ${dateES(doc.due_date)} · Código SRI ${esc(doc.sri_pay_code || '')}</p><p>${esc(doc.notes || '')}</p></div>
      <div data-panel="cheque" hidden><p>Número ${esc(doc.cheque_number || '—')} · Banco ${esc(doc.cheque_bank || '—')} · Fecha ${dateES(doc.cheque_date)} · ${doc.cheque_postdated ? 'Posfechado' : 'No posfechado'}</p></div>
      <div class="toolbar">${doc.status === 'EMITIDO' && canAccount() ? `<button class="btn-danger" data-act="void-doc" data-id="${doc.id}" type="button">Anular</button>` : ''}${doc.doc_type === 'COT' && doc.status === 'EMITIDO' && canWrite() ? `<button class="btn" data-act="convert-doc" data-id="${doc.id}" type="button">Convertir en factura</button>` : ''}</div>
    </div>${totalsHtml(t)}</div></article>`);
}

async function renderDocEditor(view, type) {
  const meta = state.catalogs.docTypes[type];
  const [products, parties, banks, related] = await Promise.all([
    api('/api/products'),
    api('/api/parties?kind=' + meta.party),
    api('/api/banks'),
    meta.related ? api('/api/documents?type=' + (meta.side === 'VENTA' ? 'FV' : 'FC')) : Promise.resolve({ items: [] }),
  ]);
  state.draft = {
    docType: type,
    lines: type === 'RET' ? [] : [{ productId: '', description: '', qty: 1, price: '', discount: '', ivaRate: 15, iceRate: 0 }],
    retentions: type === 'RET' ? [{ tax: 'RENTA', code: '307', base: '', rate: 2 }] : [],
    products: products.items.filter((p) => p.active),
    parties: parties.items.filter((p) => p.active && !p.blocked),
    banks: banks.items,
    related: (related.items || []).filter((d) => d.status === 'EMITIDO'),
  };
  paintEditor(view);
}

function syncHeader() {
  if (!state.draft || !document.getElementById('f-date')) return;
  state.draft.header = {
    date: document.getElementById('f-date').value,
    party: document.getElementById('f-party').value,
    method: document.getElementById('f-method').value,
    term: document.getElementById('f-term').value,
    due: document.getElementById('f-due').value,
    sri: document.getElementById('f-sri').value,
    bank: document.getElementById('f-bank').value,
    related: document.getElementById('f-related')?.value || '',
    notes: document.getElementById('f-notes')?.value || '',
    chq: document.getElementById('f-chq')?.value || '',
    chqbank: document.getElementById('f-chqbank')?.value || '',
    chqdate: document.getElementById('f-chqdate')?.value || '',
    postdated: !!document.getElementById('f-postdated')?.checked,
  };
}
function paintEditor(view) {
  const d = state.draft;
  const h = d.header || {};
  const t = liveTotals(d.lines);
  const productOpts = '<option value="">Ítem libre</option>' + d.products.map((p) => `<option value="${p.id}">${esc(p.code)} · ${esc(p.name)}</option>`).join('');
  view.innerHTML = page(`<article class="sheet"><div class="sheet-head"><div><h3 style="margin:0">${esc(docLabel(d.docType))}</h3><p class="muted">El número se asigna al grabar. ${d.docType === 'COT' ? 'La cotización no contabiliza.' : 'Al grabar se genera el asiento.'}</p></div></div>
    <div class="form-grid">
      <label>Fecha<input type="date" id="f-date" value="${esc(h.date || state.today)}"></label>
      <label class="wide">${d.docType.startsWith('F') || d.docType === 'NV' || d.docType === 'COT' || d.docType === 'NCV' || d.docType === 'NDV' ? 'Cliente' : 'Proveedor'}<select id="f-party">${d.parties.map((p) => `<option value="${p.id}" ${String(p.id) === String(h.party) ? 'selected' : ''}>${esc(p.identification)} · ${esc(p.name)}</option>`).join('')}</select></label>
      <label>Forma de pago<select id="f-method">${opt(state.catalogs.paymentMethods, h.method || 'CREDITO')}</select></label>
      ${state.catalogs.docTypes[d.docType].related ? `<label class="wide">Documento relacionado<select id="f-related">${d.related.map((r) => `<option value="${r.id}">${esc(r.doc_number)} · ${esc(r.party_name)} · ${money(r.total_cents)}</option>`).join('')}</select></label>` : ''}
      <label>Plazo (días)<input id="f-term" type="number" value="${esc(h.term || 30)}"></label>
      <label>Vencimiento<input id="f-due" type="date" value="${esc(h.due || '')}"></label>
      <label>Código forma de pago SRI<select id="f-sri">${opt(state.catalogs.sriPayCodes, h.sri || '20')}</select></label>
      <label>Cuenta bancaria<select id="f-bank"><option value="">—</option>${d.banks.map((b) => `<option value="${b.id}" ${String(b.id) === String(h.bank) ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
    </div>
    <div class="split" style="margin-top:12px"><div>
      ${d.docType === 'RET' ? retentionEditor() : `<table class="data"><thead><tr><th>Producto</th><th>Descripción</th><th>Cant.</th><th>Precio</th><th>Desc.</th><th>IVA</th><th>ICE</th><th></th></tr></thead><tbody id="line-body">${d.lines.map((l, i) => lineRow(l, i, productOpts)).join('')}</tbody></table>
      <button class="btn-sec" type="button" data-act="add-line" style="margin-top:8px">Agregar ítem</button>`}
      <div class="tabs"><button type="button" class="on" data-tab="conta">Contabilidad</button><button type="button" data-tab="pago">Forma de pago</button><button type="button" data-tab="cheque">Cheque</button></div>
      <div data-panel="conta" id="preview-box"><p class="muted">Abra de nuevo esta pestaña después de completar el detalle para ver el asiento propuesto.</p><button class="btn-sec" type="button" data-act="preview-doc">Calcular asiento</button></div>
      <div data-panel="pago" hidden><label>Notas<textarea id="f-notes"></textarea></label></div>
      <div data-panel="cheque" hidden><div class="form-grid"><label>Número<input id="f-chq"></label><label>Banco<input id="f-chqbank"></label><label>Fecha<input type="date" id="f-chqdate"></label><label class="check"><input type="checkbox" id="f-postdated"> Posfechado</label></div></div>
      ${canWrite() ? '<button class="btn" type="button" data-act="save-doc" style="margin-top:12px">Grabar</button>' : ''}
    </div><div id="live-totals">${totalsHtml(t)}</div></div></article>`);
}

function lineRow(l, i, productOpts) {
  return `<tr data-i="${i}"><td><select name="productId">${productOpts.replace(`value="${l.productId}"`, `value="${l.productId}" selected`)}</select></td>
    <td><input name="description" value="${esc(l.description)}"></td><td><input name="qty" value="${esc(l.qty)}"></td><td><input name="price" value="${esc(l.price)}"></td>
    <td><input name="discount" value="${esc(l.discount)}"></td><td><select name="ivaRate"><option ${Number(l.ivaRate) === 15 ? 'selected' : ''}>15</option><option ${Number(l.ivaRate) === 0 ? 'selected' : ''}>0</option></select></td>
    <td><input name="iceRate" value="${esc(l.iceRate || 0)}"></td><td><button type="button" class="btn-danger" data-act="del-line" data-i="${i}">×</button></td></tr>`;
}
function retentionEditor() {
  const codes = state.catalogs.retentionCodes.map((c) => `<option value="${c.code}" data-tax="${c.tax}" data-rate="${c.rate}">${c.code} · ${esc(c.name)}</option>`).join('');
  return `<table class="data"><thead><tr><th>Impuesto</th><th>Código</th><th>Base</th><th>%</th><th></th></tr></thead><tbody id="ret-body">${state.draft.retentions.map((r, i) => `<tr data-i="${i}"><td><select name="tax"><option ${r.tax === 'RENTA' ? 'selected' : ''}>RENTA</option><option ${r.tax === 'IVA' ? 'selected' : ''}>IVA</option></select></td><td><select name="code">${codes}</select></td><td><input name="base" value="${esc(r.base)}"></td><td><input name="rate" value="${esc(r.rate)}"></td><td><button class="btn-danger" data-act="del-ret" data-i="${i}" type="button">×</button></td></tr>`).join('')}</tbody></table><button class="btn-sec" type="button" data-act="add-ret">Agregar código</button>`;
}
function syncDraftFromDom() {
  const d = state.draft;
  if (!d) return;
  if (d.docType === 'RET') {
    d.retentions = [...document.querySelectorAll('#ret-body tr')].map((tr) => ({
      tax: tr.querySelector('[name=tax]').value,
      code: tr.querySelector('[name=code]').value,
      base: tr.querySelector('[name=base]').value,
      rate: tr.querySelector('[name=rate]').value,
    }));
    return;
  }
  d.lines = [...document.querySelectorAll('#line-body tr')].map((tr) => ({
    productId: tr.querySelector('[name=productId]').value,
    description: tr.querySelector('[name=description]').value,
    qty: tr.querySelector('[name=qty]').value,
    price: tr.querySelector('[name=price]').value,
    discount: tr.querySelector('[name=discount]').value,
    ivaRate: tr.querySelector('[name=ivaRate]').value,
    iceRate: tr.querySelector('[name=iceRate]').value,
  }));
}
function docPayload() {
  syncDraftFromDom();
  const d = state.draft;
  return {
    docType: d.docType,
    date: document.getElementById('f-date').value,
    partyId: Number(document.getElementById('f-party').value),
    paymentMethod: document.getElementById('f-method').value,
    termDays: Number(document.getElementById('f-term').value || 0),
    dueDate: document.getElementById('f-due').value || undefined,
    sriPayCode: document.getElementById('f-sri').value,
    bankAccountId: document.getElementById('f-bank').value || undefined,
    relatedDocumentId: document.getElementById('f-related')?.value || undefined,
    notes: document.getElementById('f-notes')?.value || '',
    chequePostdated: !!document.getElementById('f-postdated')?.checked,
    cheque: { number: document.getElementById('f-chq')?.value, bank: document.getElementById('f-chqbank')?.value, date: document.getElementById('f-chqdate')?.value, postdated: !!document.getElementById('f-postdated')?.checked },
    lines: d.lines.map((l) => ({ productId: l.productId || undefined, description: l.description, qty: l.qty, price: l.price, discount: l.discount || 0, ivaRate: Number(l.ivaRate), iceRate: Number(l.iceRate || 0) })),
    retentions: d.retentions,
  };
}

async function renderSettlement(view, kind, side) {
  const parties = await api('/api/parties?kind=' + (side === 'AP' ? 'PROVEEDOR' : 'CLIENTE'));
  const banks = await api('/api/banks');
  const history = await api('/api/settlements?side=' + side);
  const titles = { COBRO: 'Cobro', PAGO: 'Pago', ANTICIPO: 'Anticipo', CRUCE: 'Cruce de anticipo', VARIOS: side === 'AR' ? 'Cobro a varios' : 'Pago a varios' };
  view.innerHTML = page(`<article class="sheet"><h3>${titles[kind] || kind}</h3>
    <div class="form-grid">
      <label>Fecha<input type="date" id="s-date" value="${state.today}"></label>
      ${kind === 'VARIOS' ? '' : `<label class="wide">Persona<select id="s-party">${parties.items.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>`}
      ${kind !== 'CRUCE' ? `<label>Forma<select id="s-method">${opt(state.catalogs.paymentMethods.filter((m) => m.id !== 'CREDITO'), 'TRANSFERENCIA')}</select></label><label>Banco<select id="s-bank"><option value="">Caja / bancos general</option>${banks.items.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></label><label>Valor<input id="s-amount" inputmode="decimal"></label>` : `<label>Anticipo<select id="s-advance"></select></label>`}
      ${kind === 'COBRO' || kind === 'PAGO' ? '<label class="check"><input type="checkbox" id="s-advance-flag"> El sobrante queda como anticipo</label>' : ''}
    </div>
    <div id="s-items"></div>
    <div class="toolbar">${kind === 'COBRO' || kind === 'PAGO' || kind === 'VARIOS' || kind === 'CRUCE' ? '<button class="btn-sec" type="button" data-act="load-open">Cargar saldos</button><button class="btn-gold" type="button" data-act="fifo">Aplicación secuencial</button>' : ''}${canWrite() ? '<button class="btn" type="button" data-act="save-settlement">Grabar</button>' : ''}</div>
    </article>
    <article class="card" style="margin-top:14px"><h3>Registrados</h3><table class="data"><thead><tr><th>Número</th><th>Fecha</th><th>Tipo</th><th class="num">Valor</th></tr></thead><tbody>${history.items.filter((s) => s.kind === kind || (kind === 'COBRO' && s.kind === 'VARIOS' && side === 'AR') || (kind === 'PAGO' && s.kind === 'VARIOS' && side === 'AP')).slice(0, 20).map((s) => `<tr><td>${esc(s.doc_number)}</td><td>${dateES(s.doc_date)}</td><td>${esc(s.kind)}</td><td class="num">${money(s.total_cents)}</td></tr>`).join('')}</tbody></table></article>`);
  state.settle = { kind, side, items: [] };
}

async function loadOpenItems() {
  const s = state.settle;
  const party = document.getElementById('s-party')?.value;
  if (s.kind === 'CRUCE') {
    const advances = await api(`/api/open-items?side=${s.side}&kind=ANTICIPO&partyId=${party}`);
    document.getElementById('s-advance').innerHTML = advances.items.map((a) => `<option value="${a.id}" data-balance="${a.balance_cents}">${esc(a.doc_number)} · ${money(a.balance_cents)}</option>`).join('') || '<option value="">Sin anticipos</option>';
  }
  const items = await api(`/api/open-items?side=${s.side}${s.kind === 'VARIOS' || !party ? '' : '&partyId=' + party}`);
  s.items = items.items.map((item) => ({ ...item, apply: '' }));
  paintOpen();
}
function paintOpen() {
  const box = document.getElementById('s-items');
  if (!box) return;
  box.innerHTML = `<table class="data"><thead><tr><th>Documento</th><th>Vence</th><th class="num">Saldo</th><th>Aplicar</th></tr></thead><tbody>
    ${state.settle.items.map((item, i) => `<tr><td>${esc(item.doc_number)}</td><td>${dateES(item.due_date)}</td><td class="num">${money(item.balance_cents)}</td><td><input data-apply="${i}" value="${item.apply === '' || item.apply == null ? '' : (item.apply / 100).toFixed(2)}"></td></tr>`).join('')}</tbody></table>`;
}

async function renderStatement(view, side) {
  const parties = await api('/api/parties?kind=' + (side === 'AP' ? 'PROVEEDOR' : 'CLIENTE'));
  view.innerHTML = page(`<div class="toolbar">${rangeFields()}<label>Persona<select id="p-party">${parties.items.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><button class="btn" data-act="run-statement" type="button">Consultar</button><span id="exp"></span></div><div id="result"></div>`);
  state.side = side;
}
async function renderAging(view, side) {
  view.innerHTML = page(`<div class="toolbar"><label>Corte<input type="date" id="cutoff" value="${state.today}"></label><button class="btn" data-act="run-aging" data-side="${side}" type="button">Consultar</button></div><div id="result"></div>`);
}
async function renderDebts(view, side) {
  view.innerHTML = page(`<div class="toolbar"><label>Corte<input type="date" id="cutoff" value="${state.today}"></label><button class="btn" data-act="run-debts" data-side="${side}" type="button">Consultar</button></div><div id="result"></div>`);
}

async function renderAccounts(view) {
  const data = await api('/api/accounts');
  view.innerHTML = page(`<div class="toolbar">${canAccount() ? '<button class="btn" data-act="new-account" type="button">Nueva cuenta</button>' : ''}</div>
    <article class="card"><table class="data"><thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Naturaleza</th><th>Movimiento</th></tr></thead>
    <tbody>${data.items.map((a) => `<tr><td>${esc(a.code)}</td><td style="padding-left:${a.code.split('.').length * 10}px">${esc(a.name)}</td><td>${esc(a.type)}</td><td>${esc(a.nature)}</td><td>${a.is_movement ? 'Sí' : ''}</td></tr>`).join('')}</tbody></table></article>`);
}
async function renderSettings(view) {
  const [settings, accounts] = await Promise.all([api('/api/settings'), api('/api/accounts')]);
  const moves = accounts.items.filter((a) => a.is_movement);
  const fields = Object.entries(settings.values).filter(([k]) => k.startsWith('cuenta_'));
  view.innerHTML = page(`<form id="settings-form" class="sheet"><h3>Cuentas que usan los asientos automáticos</h3><div class="form-grid">${fields.map(([k, v]) => `<label class="wide">${esc(k.replace('cuenta_', '').replaceAll('_', ' '))}<select name="${esc(k)}">${moves.map((a) => `<option value="${esc(a.code)}" ${a.code === v ? 'selected' : ''}>${esc(a.code)} ${esc(a.name)}</option>`).join('')}</select></label>`).join('')}
    <label>SBU (sueldo básico)<input name="sbu_cents" value="${(Number(settings.values.sbu_cents || 0) / 100).toFixed(2)}"></label>
    <label>IESS personal<input name="iess_personal" value="${esc(settings.values.iess_personal)}"></label>
    <label>IESS patronal<input name="iess_patronal" value="${esc(settings.values.iess_patronal)}"></label>
    <label>Fondos de reserva<input name="fondos_reserva" value="${esc(settings.values.fondos_reserva)}"></label>
    </div>${canAccount() ? '<button class="btn" type="submit">Grabar</button>' : ''}</form>`);
  document.getElementById('settings-form').onsubmit = async (e) => {
    e.preventDefault();
    const values = readForm(e.target);
    if (values.sbu_cents) values.sbu_cents = String(cents(values.sbu_cents));
    try { await api('/api/settings', { method: 'PUT', body: { values } }); toast('Cuentas de enlace actualizadas.'); } catch (err) { toast(err.message); }
  };
}

async function renderJournal(view) {
  view.innerHTML = page(`<div class="toolbar">${rangeFields()}<button class="btn" type="button" data-act="run-journal">Consultar</button><span id="exp"></span></div><div id="result"></div>`);
}
async function renderManual(view) {
  const accounts = await api('/api/accounts');
  state.moveAccounts = accounts.items.filter((a) => a.is_movement);
  state.entry = [{ code: '', debit: '', credit: '' }, { code: '', debit: '', credit: '' }];
  paintManual(view);
}
function paintManual(view) {
  const opts = state.moveAccounts.map((a) => `<option value="${esc(a.code)}">${esc(a.code)} ${esc(a.name)}</option>`).join('');
  view.innerHTML = page(`<article class="sheet"><h3>Asiento manual</h3><div class="form-grid"><label>Fecha<input type="date" id="j-date" value="${state.today}"></label><label class="wide">Concepto<input id="j-desc"></label></div>
    <table class="data"><thead><tr><th>Cuenta</th><th>Débito</th><th>Crédito</th></tr></thead><tbody id="j-body">${state.entry.map((l, i) => `<tr data-i="${i}"><td><select name="code"><option value=""></option>${opts}</select></td><td><input name="debit"></td><td><input name="credit"></td></tr>`).join('')}</tbody></table>
    <div class="toolbar"><button class="btn-sec" type="button" data-act="add-j">Agregar línea</button>${canAccount() ? '<button class="btn" type="button" data-act="save-j">Contabilizar</button>' : '<span class="muted">Solo contador o administrador.</span>'}</div></article>`);
}
async function renderLedger(view) {
  const accounts = await api('/api/accounts');
  view.innerHTML = page(`<div class="toolbar">${rangeFields()}<label>Cuenta<select id="acc">${accounts.items.filter((a) => a.is_movement).map((a) => `<option value="${a.id}">${esc(a.code)} ${esc(a.name)}</option>`).join('')}</select></label><button class="btn" data-act="run-ledger" type="button">Mayorizar</button><span id="exp"></span></div><div id="result"></div>`);
}
async function renderSimpleReport(view, path, runner) {
  view.innerHTML = page(`<div class="toolbar">${path === 'comprobacion' || path === 'resultados' ? rangeFields() : `<label>Al<input type="date" id="f-date" value="${state.today}"></label>`}<button class="btn" data-act="${runner}" type="button">Generar</button><span id="exp"></span></div><div id="result"></div>`);
  view.querySelector('[data-act]')?.click();
}

async function renderBanks(view) {
  const data = await api('/api/banks');
  const accounts = await api('/api/accounts');
  state.banks = data.items;
  state.moveAccounts = accounts.items.filter((a) => a.is_movement);
  view.innerHTML = page(`<div class="grid-2"><article class="sheet"><h3>Nueva cuenta bancaria</h3><form id="bank-form"><label>Nombre<input name="name" required></label><label>Banco<input name="bankName"></label><label>Número<input name="accountNumber"></label><label>Cuenta contable<select name="ledgerCode">${state.moveAccounts.map((a) => `<option value="${esc(a.code)}" ${a.code === '1.1.01.02' ? 'selected' : ''}>${esc(a.code)} ${esc(a.name)}</option>`).join('')}</select></label><label>Saldo inicial<input name="opening" value="0"></label><label>Fecha<input type="date" name="openingDate" value="${state.today.slice(0, 4)}-01-02"></label>${canWrite() ? '<button class="btn" type="submit">Grabar</button>' : ''}</form></article>
    <article class="card"><h3>Cuentas</h3>${data.items.map((b) => `<p><button class="btn-sec" data-act="open-bank" data-id="${b.id}" type="button">${esc(b.bank_name)} · ${esc(b.name)}</button></p>`).join('') || '<p>No hay cuentas.</p>'}</article></div><div id="bank-detail"></div>`);
  document.getElementById('bank-form').onsubmit = async (e) => {
    e.preventDefault();
    const body = readForm(e.target);
    body.openingCents = cents(body.opening);
    try { await api('/api/banks', { method: 'POST', body }); toast('Cuenta bancaria creada.'); renderBanks(view); } catch (err) { toast(err.message); }
  };
}
async function renderPostdated(view) {
  const data = await api('/api/banks/postdated');
  view.innerHTML = page(`<article class="card"><table class="data"><thead><tr><th>Fecha</th><th>Banco</th><th>Número</th><th>Detalle</th><th class="num">Valor</th><th>Estado</th><th></th></tr></thead>
    <tbody>${data.items.map((m) => `<tr><td>${dateES(m.doc_date)}</td><td>${esc(m.bank_name)}</td><td>${esc(m.doc_number)}</td><td>${esc(m.description)}</td><td class="num">${money(m.credit_cents || m.debit_cents)}</td><td>${esc(m.status)}</td><td>${m.status === 'PENDIENTE' && canWrite() ? `<button class="btn" data-act="clear-check" data-id="${m.id}" type="button">Efectivizar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7">No hay cheques posfechados.</td></tr>'}</tbody></table></article>`);
}

async function renderStock(view) {
  const data = await api('/api/inventory/stock');
  view.innerHTML = page(`<article class="card"><table class="data"><thead><tr><th>Código</th><th>Producto</th><th class="num">Cantidad</th><th class="num">Costo promedio</th><th class="num">Valor</th><th></th></tr></thead>
    <tbody>${data.items.filter((p) => p.inventoriable).map((p) => `<tr><td>${esc(p.code)}</td><td>${esc(p.name)}</td><td class="num">${qtyText(p.stock_qty)}</td><td class="num">${money(p.avg_cost_cents)}</td><td class="num">${money(p.stock_value_cents)}</td><td><button class="btn-sec" data-act="kardex" data-id="${p.id}" type="button">Kardex</button></td></tr>`).join('')}</tbody></table></article><div id="kardex"></div>`);
}
async function renderWarehouse(view) {
  const products = await api('/api/products');
  state.invProducts = products.items.filter((p) => p.inventoriable);
  view.innerHTML = page(`<article class="sheet"><h3>Documento de bodega</h3><div class="form-grid"><label>Tipo<select id="w-type"><option value="INGRESO">Ingreso</option><option value="EGRESO">Egreso</option><option value="TRANSFERENCIA">Transferencia</option></select></label><label>Fecha<input type="date" id="w-date" value="${state.today}"></label><label>Desde<input id="w-from" value="GENERAL"></label><label>Hacia<input id="w-to" value="SUCURSAL"></label></div>
    <table class="data"><tbody id="w-body"><tr><td><select name="productId">${state.invProducts.map((p) => `<option value="${p.id}">${esc(p.code)} ${esc(p.name)}</option>`).join('')}</select></td><td><input name="qty" placeholder="Cantidad"></td><td><input name="unitCost" placeholder="Costo unitario (ingreso)"></td></tr></tbody></table>
    ${canWrite() ? '<button class="btn" data-act="save-warehouse" type="button">Grabar</button>' : ''}</article>`);
}
async function renderImport(view) {
  view.innerHTML = page(`<article class="sheet"><h3>Importar facturas de compra desde Excel</h3><p class="muted">Columnas: fecha, identificacion, codigo_producto, cantidad, precio, descuento, iva, descripcion. El proveedor y el producto ya deben existir.</p><p><a class="btn-sec" href="/api/inventory/template">Descargar plantilla</a></p><input type="file" id="xlsx" accept=".xlsx"><button class="btn" data-act="import-xlsx" type="button">Importar</button></article>`);
}
async function renderInvReport(view, kind) {
  view.innerHTML = page(`<div class="toolbar">${rangeFields()}<button class="btn" data-act="run-inv" data-kind="${kind}" type="button">Consultar</button></div><div id="result"></div>`);
}

async function renderSri(view, which) {
  const month = state.today.slice(5, 7);
  const year = state.today.slice(0, 4);
  view.innerHTML = page(`<div class="toolbar"><label>Año<input id="y" value="${year}"></label><label>Mes<input id="m" value="${Number(month)}"></label><button class="btn" data-act="run-sri" data-which="${which}" type="button">Generar</button></div><div id="result"></div>`);
}
async function renderPayroll(view) {
  const runs = await api('/api/payroll');
  view.innerHTML = page(`<article class="sheet"><h3>Generación del rol</h3><div class="form-grid"><label>Año<input id="py" value="${state.today.slice(0, 4)}"></label><label>Mes<input id="pm" value="${Number(state.today.slice(5, 7))}"></label><label>Pagar desde<select id="ppay"><option value="">Dejar en sueldos por pagar</option><option value="caja">Caja</option><option value="bancos">Bancos</option></select></label></div>
    <div class="toolbar"><button class="btn-sec" data-act="preview-pay" type="button">Calcular</button>${canAccount() ? '<button class="btn" data-act="save-pay" type="button">Contabilizar rol</button>' : ''}</div><div id="pay-box"></div></article>
    <article class="card" style="margin-top:14px"><h3>Roles grabados</h3><table class="data"><tbody>${runs.items.map((r) => `<tr class="click" data-act="open-pay" data-id="${r.id}"><td>${r.year}-${String(r.month).padStart(2, '0')}</td><td class="num">${money(r.total_net_cents)}</td><td>${esc(r.status)}</td></tr>`).join('') || '<tr><td>Aún no hay roles.</td></tr>'}</tbody></table><div id="pay-detail"></div></article>`);
  state.payItems = null;
}
async function renderEInvoice(view) {
  const data = await api('/api/einvoice');
  view.innerHTML = page(`<article class="phase"><h3>Facturación electrónica · fase 2</h3><p>${esc(data.message)}</p>
    <div class="form-grid"><label>Ambiente<select disabled><option>Pruebas</option><option>Producción</option></select></label><label>Certificado .p12<input disabled placeholder="Se habilita en la fase 2"></label><label>Clave del certificado<input disabled type="password"></label></div>
    <div class="toolbar"><button class="btn" disabled type="button">Firmar XAdES</button><button class="btn-gold" disabled type="button">Enviar al SRI</button><button class="btn-sec" disabled type="button">Consultar autorización</button></div></article>
    <article class="card" style="margin-top:14px"><table class="data"><thead><tr><th>Comprobante</th><th>Fecha</th><th>Cliente</th><th class="num">Total</th><th>Autorización</th></tr></thead>
    <tbody>${data.items.map((d) => `<tr><td>${esc(d.docLabel)} ${esc(d.doc_number)}</td><td>${dateES(d.doc_date)}</td><td>${esc(d.party_name)}</td><td class="num">${money(d.total_cents)}</td><td><span class="pill warn">Pendiente · fase 2</span></td></tr>`).join('') || '<tr><td colspan="5">No hay comprobantes pendientes.</td></tr>'}</tbody></table></article>`);
}
async function renderBackup(view) {
  view.innerHTML = page(`<article class="sheet"><h3>Respaldo por empresa</h3><p>El archivo JSON contiene maestros, documentos, asientos, bancos, inventario y roles solo de la empresa activa.</p>
    ${canAccount() ? `<p><a class="btn" href="/api/backup">Descargar respaldo</a></p><label>Restaurar archivo<input type="file" id="backup-file" accept="application/json"></label><button class="btn-danger" data-act="restore" type="button">Restaurar sobre esta empresa</button>` : '<p>Pida a un contador el respaldo.</p>'}</article>`);
}
async function renderUsers(view) {
  const [users, companies] = await Promise.all([api('/api/users'), api('/api/companies')]);
  view.innerHTML = page(`<article class="sheet"><h3>Nuevo usuario</h3><form id="user-form" class="form-grid"><label>Usuario<input name="username" required></label><label>Nombre<input name="name" required></label><label>Clave<input name="password" required></label><label>Rol<select name="role">${opt(state.catalogs.roles, 'auxiliar')}</select></label><label class="wide">Empresas<select name="companyIds" multiple size="3">${companies.items.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label><button class="btn" type="submit">Crear</button></form></article>
    <article class="card" style="margin-top:14px"><table class="data"><thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th></tr></thead><tbody>${users.items.map((u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.name)}</td><td>${esc(u.role)}</td><td>${u.active ? 'Activo' : 'Inactivo'}</td></tr>`).join('')}</tbody></table></article>`);
  document.getElementById('user-form').onsubmit = async (e) => {
    e.preventDefault();
    const body = readForm(e.target);
    body.companyIds = [...e.target.companyIds.selectedOptions].map((o) => Number(o.value));
    try { await api('/api/users', { method: 'POST', body }); toast('Usuario creado.'); renderUsers(view); } catch (err) { toast(err.message); }
  };
}
function renderPassword(view) {
  view.innerHTML = page(`<form id="pw" class="sheet" style="max-width:420px"><h3>Cambiar mi clave</h3><label>Actual<input type="password" name="current" required></label><label>Nueva<input type="password" name="next" required></label><button class="btn" type="submit">Actualizar</button></form>`);
  document.getElementById('pw').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/me/password', { method: 'POST', body: readForm(e.target) }); toast('Clave actualizada.'); e.target.reset(); } catch (err) { toast(err.message); }
  };
}

function readForm(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  form.querySelectorAll('input[type=checkbox]').forEach((el) => { data[el.name] = el.checked; });
  return data;
}
function openModal(html) {
  const modal = document.getElementById('modal');
  modal.innerHTML = html;
  modal.showModal();
}
function table(headers, rows) {
  return `<article class="card"><table class="data"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></article>`;
}

async function go() {
  if (!state.user) return;
  paintChrome();
  const view = document.getElementById('view');
  const [a, b, c] = (location.hash || '#/inicio').slice(2).split('/');
  view.innerHTML = '<p class="muted">Cargando…</p>';
  try {
    if (!a || a === 'inicio') return renderDashboard(view);
    if (a === 'empresas') return renderCompanies(view);
    if (a === 'empresa') return renderCompany(view);
    if (PARTY[a]) return renderParties(view, a);
    if (a === 'productos') return renderProducts(view);
    if (a === 'doc' && c) return renderDoc(view, b, c);
    if (a === 'doc') return renderDocList(view, b);
    if (a === 'cobro') return renderSettlement(view, b, c || 'AR');
    if (a === 'estado') return renderStatement(view, b);
    if (a === 'cartera') return renderAging(view, b);
    if (a === 'deudas') return renderDebts(view, b);
    if (a === 'cuentas') return renderAccounts(view);
    if (a === 'enlace') return renderSettings(view);
    if (a === 'diario') return renderJournal(view);
    if (a === 'asiento') return renderManual(view);
    if (a === 'mayor') return renderLedger(view);
    if (a === 'descuadrados') return renderSimpleReport(view, 'descuadrados', 'run-unbalanced');
    if (a === 'cierre') return renderSimpleReport(view, 'cierre', 'run-close-screen');
    if (a === 'comprobacion') return renderSimpleReport(view, 'comprobacion', 'run-trial');
    if (a === 'balance') return renderSimpleReport(view, 'balance', 'run-balance');
    if (a === 'resultados') return renderSimpleReport(view, 'resultados', 'run-income');
    if (a === 'cruces') return renderSimpleReport(view, 'cruces', 'run-cross');
    if (a === 'bancos') return renderBanks(view);
    if (a === 'posfechados') return renderPostdated(view);
    if (a === 'stock') return renderStock(view);
    if (a === 'bodega') return renderWarehouse(view);
    if (a === 'importar') return renderImport(view);
    if (a === 'inv-informe') return renderInvReport(view, b);
    if (a === 'sri104') return renderSri(view, '104');
    if (a === 'sri103') return renderSri(view, '103');
    if (a === 'ats') return renderSri(view, 'ats');
    if (a === 'nomina') return renderPayroll(view);
    if (a === 'electronica') return renderEInvoice(view);
    if (a === 'respaldo') return renderBackup(view);
    if (a === 'usuarios') return renderUsers(view);
    if (a === 'clave') return renderPassword(view);
    view.innerHTML = page('<p>Página no encontrada.</p>');
  } catch (err) {
    view.innerHTML = page(`<div class="bad-line">${esc(err.message)}</div>`);
  }
}

document.body.addEventListener('click', async (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    tab.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
    tab.classList.add('on');
    const root = tab.closest('article') || document;
    root.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
    return;
  }
  const href = e.target.closest('[data-href]');
  if (href && !e.target.closest('button')) { location.hash = href.dataset.href; return; }
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  try {
    if (act === 'menu') document.getElementById('sidebar').classList.toggle('open');
    if (act === 'logout') { await api('/api/logout', { method: 'POST' }); location.reload(); }
    if (act === 'close-modal') document.getElementById('modal').close();
    if (act === 'new-company') openModal(`<form id="modal-form"><h3>Nueva empresa</h3>${companyFields({ obligado: 1, regimen: 'GENERAL', establecimiento: '001', punto_emision: '001' })}<button class="btn" type="submit">Crear y precargar plan de cuentas</button></form>`);
    if (act === 'party') {
      const current = state.partyCache?.find((p) => p.id === Number(btn.dataset.id)) || {};
      openModal(partyForm(btn.dataset.kind || current.kind, current));
    }
    if (act === 'product') openModal(productForm(state.productCache?.find((p) => p.id === Number(btn.dataset.id)) || { kind: 'BIEN', iva_rate: 15, inventoriable: 1, active: 1, unit: 'UND' }));
    if (act === 'add-line') { syncHeader(); syncDraftFromDom(); state.draft.lines.push({ productId: '', description: '', qty: 1, price: '', discount: '', ivaRate: 15, iceRate: 0 }); paintEditor(document.getElementById('view')); }
    if (act === 'del-line') { syncHeader(); syncDraftFromDom(); state.draft.lines.splice(Number(btn.dataset.i), 1); if (!state.draft.lines.length) state.draft.lines.push({ productId: '', description: '', qty: 1, price: '', discount: '', ivaRate: 15, iceRate: 0 }); paintEditor(document.getElementById('view')); }
    if (act === 'add-ret') { syncHeader(); syncDraftFromDom(); state.draft.retentions.push({ tax: 'IVA', code: '725', base: '', rate: 30 }); paintEditor(document.getElementById('view')); }
    if (act === 'del-ret') { syncHeader(); syncDraftFromDom(); state.draft.retentions.splice(Number(btn.dataset.i), 1); paintEditor(document.getElementById('view')); }
    if (act === 'preview-doc' || act === 'save-doc') {
      const body = docPayload();
      if (act === 'preview-doc') {
        const preview = await api('/api/documents/preview', { method: 'POST', body });
        document.getElementById('preview-box').innerHTML = `<table class="data"><tbody>${preview.journal.map((l) => `<tr><td>${esc(l.code)} ${esc(l.name)}</td><td class="num">${l.debitCents ? money(l.debitCents) : ''}</td><td class="num">${l.creditCents ? money(l.creditCents) : ''}</td></tr>`).join('') || '<tr><td>Sin asiento.</td></tr>'}</tbody></table>`;
        document.getElementById('live-totals').innerHTML = totalsHtml({ subtotal: preview.totals.subtotalCents, discount: preview.totals.discountCents, base15: preview.totals.base15Cents, base0: preview.totals.base0Cents, ice: preview.totals.iceCents, iva: preview.totals.ivaCents, total: preview.totals.totalCents });
      } else {
        const created = await api('/api/documents', { method: 'POST', body });
        toast((created.warnings || []).join(' ') || 'Documento grabado.');
        location.hash = `#/doc/${body.docType}/${created.id}`;
      }
    }
    if (act === 'void-doc') {
      if (!confirm('¿Anular este documento? Se revierte el asiento si nadie lo ha cobrado o pagado.')) return;
      await api('/api/documents/' + btn.dataset.id + '/void', { method: 'POST', body: {} });
      toast('Documento anulado.'); go();
    }
    if (act === 'convert-doc') {
      const created = await api('/api/documents/' + btn.dataset.id + '/convert', { method: 'POST', body: { date: state.today } });
      location.hash = '#/doc/FV/' + created.id;
    }
    if (act === 'load-open' || act === 'fifo') {
      if (act === 'load-open' || !state.settle.items.length) await loadOpenItems();
      if (act === 'fifo') {
        const advance = document.getElementById('s-advance');
        const cap = state.settle.kind === 'CRUCE'
          ? Number(advance?.selectedOptions[0]?.dataset.balance || 0)
          : cents(document.getElementById('s-amount').value || 0);
        let left = cap;
        state.settle.items = [...state.settle.items].sort((a, b) => String(a.due_date || a.doc_date).localeCompare(String(b.due_date || b.doc_date))).map((item) => {
          const take = Math.min(item.balance_cents, Math.max(0, left));
          left -= take;
          return { ...item, apply: take };
        });
        paintOpen();
      }
    }
    if (act === 'save-settlement') {
      const s = state.settle;
      document.querySelectorAll('[data-apply]').forEach((input) => { s.items[Number(input.dataset.apply)].apply = cents(input.value || 0); });
      const applications = s.items.filter((item) => item.apply > 0).map((item) => ({ openItemId: item.id, amountCents: item.apply }));
      const body = { kind: s.kind, side: s.side, date: document.getElementById('s-date').value, partyId: document.getElementById('s-party')?.value, method: document.getElementById('s-method')?.value, bankAccountId: document.getElementById('s-bank')?.value, applications };
      if (s.kind === 'CRUCE') body.advanceItemId = Number(document.getElementById('s-advance').value);
      else body.amountCents = cents(document.getElementById('s-amount').value || 0);
      if (document.getElementById('s-advance-flag')?.checked) body.asAdvance = true;
      const saved = await api('/api/settlements', { method: 'POST', body });
      toast('Registrado ' + saved.number);
      go();
    }
    if (act === 'run-statement') {
      const from = document.getElementById('f-from').value, to = document.getElementById('f-to').value, partyId = document.getElementById('p-party').value;
      const data = await api(`/api/reports/statement?side=${state.side}&partyId=${partyId}&from=${from}&to=${to}`);
      document.getElementById('exp').innerHTML = exportLinks(`/api/reports/statement?side=${state.side}&partyId=${partyId}&from=${from}&to=${to}`);
      document.getElementById('result').innerHTML = `<p>Saldo anterior ${money(data.openingCents)} · Saldo final ${money(data.endingCents)}</p>` + table(['Fecha', 'Número', 'Detalle', 'Cargo', 'Abono', 'Saldo'], data.items.map((i) => `<tr><td>${dateES(i.doc_date)}</td><td>${esc(i.doc_number)}</td><td>${esc(i.description)}</td><td class="num">${money(i.debit_cents)}</td><td class="num">${money(i.credit_cents)}</td><td class="num">${money(i.balanceCents)}</td></tr>`).join(''));
    }
    if (act === 'run-aging') {
      const cutoff = document.getElementById('cutoff').value;
      const data = await api(`/api/reports/aging?side=${btn.dataset.side}&cutoff=${cutoff}`);
      document.getElementById('result').innerHTML = data.buckets.map((b) => `<h3>${esc(b.label)} · ${money(b.cents)}</h3>` + table(['Persona', 'Documento', 'Vence', 'Días', 'Saldo'], b.items.map((i) => `<tr><td>${esc(i.partyName)}</td><td>${esc(i.docNumber)}</td><td>${dateES(i.dueDate)}</td><td>${i.days}</td><td class="num">${money(i.balanceCents)}</td></tr>`).join(''))).join('') + `<p><a class="btn-sec" href="/api/reports/aging?side=${btn.dataset.side}&cutoff=${cutoff}&format=pdf">PDF</a> <a class="btn-sec" href="/api/reports/aging?side=${btn.dataset.side}&cutoff=${cutoff}&format=xlsx">Excel</a></p>`;
    }
    if (act === 'run-debts') {
      const cutoff = document.getElementById('cutoff').value;
      const data = await api(`/api/reports/debts?side=${btn.dataset.side}&cutoff=${cutoff}`);
      document.getElementById('result').innerHTML = table(['Persona', 'Identificación', 'Saldo'], data.parties.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.identification)}</td><td class="num">${money(p.balanceCents)}</td></tr>`).join('') + `<tr><td colspan="2">Total</td><td class="num">${money(data.totalCents)}</td></tr>`);
    }
    if (act === 'run-journal') {
      const from = document.getElementById('f-from').value, to = document.getElementById('f-to').value;
      const data = await api(`/api/journal?from=${from}&to=${to}`);
      document.getElementById('exp').innerHTML = exportLinks(`/api/journal?from=${from}&to=${to}`);
      document.getElementById('result').innerHTML = data.entries.map((e) => `<article class="card" style="margin-bottom:10px"><strong>${esc(e.doc_number)}</strong> ${dateES(e.doc_date)} · ${esc(e.description)} <span class="pill ${e.status === 'ANULADO' ? 'bad' : ''}">${esc(e.status)}</span><table class="data">${e.lines.map((l) => `<tr><td>${esc(l.code)} ${esc(l.name)}</td><td class="num">${l.debit_cents ? money(l.debit_cents) : ''}</td><td class="num">${l.credit_cents ? money(l.credit_cents) : ''}</td></tr>`).join('')}</table></article>`).join('') || '<p>No hay asientos en el rango.</p>';
    }
    if (act === 'add-j') {
      const body = document.getElementById('j-body');
      body.insertAdjacentHTML('beforeend', body.rows[0].outerHTML);
    }
    if (act === 'save-j') {
      const lines = [...document.querySelectorAll('#j-body tr')].map((tr) => ({ code: tr.querySelector('[name=code]').value, debit: tr.querySelector('[name=debit]').value, credit: tr.querySelector('[name=credit]').value }));
      const saved = await api('/api/journal', { method: 'POST', body: { date: document.getElementById('j-date').value, description: document.getElementById('j-desc').value, lines } });
      toast('Asiento ' + saved.number);
      location.hash = '#/diario';
    }
    if (act === 'run-ledger') {
      const from = document.getElementById('f-from').value, to = document.getElementById('f-to').value, accountId = document.getElementById('acc').value;
      const data = await api(`/api/reports/ledger?accountId=${accountId}&from=${from}&to=${to}`);
      document.getElementById('exp').innerHTML = exportLinks(`/api/reports/ledger?accountId=${accountId}&from=${from}&to=${to}`);
      document.getElementById('result').innerHTML = `<p>${esc(data.account.code)} ${esc(data.account.name)} · Saldo inicial ${money(data.openingCents)}</p>` + table(['Fecha', 'Número', 'Detalle', 'Débito', 'Crédito', 'Saldo'], data.items.map((i) => `<tr><td>${dateES(i.doc_date)}</td><td>${esc(i.doc_number)}</td><td>${esc(i.description)}</td><td class="num">${money(i.debit_cents)}</td><td class="num">${money(i.credit_cents)}</td><td class="num">${money(i.balanceCents)}</td></tr>`).join('') + `<tr><td colspan="5">Saldo final</td><td class="num">${money(data.endingCents)}</td></tr>`);
    }
    if (act === 'run-unbalanced') {
      const data = await api('/api/journal/unbalanced');
      document.getElementById('result').innerHTML = data.items.length ? table(['Fecha', 'Número', 'Detalle', 'Débito', 'Crédito'], data.items.map((i) => `<tr><td>${dateES(i.doc_date)}</td><td>${esc(i.doc_number)}</td><td>${esc(i.description)}</td><td class="num">${money(i.debit_cents)}</td><td class="num">${money(i.credit_cents)}</td></tr>`).join('')) : '<div class="ok-line">No hay asientos descuadrados. El sistema rechaza grabar un asiento que no cuadra.</div>';
    }
    if (act === 'run-close-screen') {
      const closes = await api('/api/year-closes');
      document.getElementById('result').innerHTML = `<article class="sheet"><p>Ejercicios cerrados: ${closes.items.map((c) => c.year).join(', ') || 'ninguno'}.</p><label>Año a cerrar<input id="close-year" value="${Number(state.today.slice(0, 4)) - 1}"></label>${canAccount() ? '<button class="btn" data-act="do-close" type="button">Cerrar ejercicio</button>' : ''}</article>`;
    }
    if (act === 'do-close') {
      if (!confirm('El cierre pasa los ingresos y gastos a patrimonio. No se podrá registrar en ese año.')) return;
      const year = document.getElementById('close-year').value;
      await api('/api/year-close', { method: 'POST', body: { year: Number(year) } });
      toast('Ejercicio cerrado.');
    }
    if (act === 'run-trial') {
      const from = document.getElementById('f-from').value, to = document.getElementById('f-to').value;
      const include = document.getElementById('zeros')?.checked ? '1' : '0';
      const data = await api(`/api/reports/trial-balance?from=${from}&to=${to}&includeZero=${include}`);
      document.getElementById('exp').innerHTML = `<label class="check"><input type="checkbox" id="zeros"> Incluir cuentas sin saldo</label>` + exportLinks(`/api/reports/trial-balance?from=${from}&to=${to}&includeZero=${include}`);
      document.getElementById('result').innerHTML = table(['Código', 'Cuenta', 'SI debe', 'SI haber', 'Debe', 'Haber', 'SF debe', 'SF haber'], data.items.map((i) => `<tr><td>${esc(i.code)}</td><td>${esc(i.name)}</td><td class="num">${money(i.openDebit)}</td><td class="num">${money(i.openCredit)}</td><td class="num">${money(i.debit)}</td><td class="num">${money(i.credit)}</td><td class="num">${money(i.endDebit)}</td><td class="num">${money(i.endCredit)}</td></tr>`).join('') + `<tr><td colspan="2">Sumas</td><td class="num">${money(data.totals.openDebit)}</td><td class="num">${money(data.totals.openCredit)}</td><td class="num">${money(data.totals.debit)}</td><td class="num">${money(data.totals.credit)}</td><td class="num">${money(data.totals.endDebit)}</td><td class="num">${money(data.totals.endCredit)}</td></tr>`);
    }
    if (act === 'run-balance') {
      const date = document.getElementById('f-date').value;
      const data = await api('/api/reports/balance-sheet?date=' + date);
      document.getElementById('exp').innerHTML = exportLinks('/api/reports/balance-sheet?date=' + date);
      const rows = (list) => list.map((r) => `<tr><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td class="num">${money(r.amountCents)}</td></tr>`).join('');
      document.getElementById('result').innerHTML = `<div class="${data.balanced ? 'ok-line' : 'bad-line'}">${data.balanced ? 'El balance cuadra.' : 'Diferencia ' + money(data.difference)} Activo ${money(data.totalAssets)} · Pasivo y patrimonio ${money(data.totalLiabilitiesAndEquity)}</div>
        <div class="balance"><article class="card"><h3>Activo</h3><table class="data">${rows(data.assets)}<tr><td></td><td>Total activo</td><td class="num">${money(data.totalAssets)}</td></tr></table></article>
        <article class="card"><h3>Pasivo y patrimonio</h3><table class="data">${rows(data.liabilities)}${rows(data.equity)}<tr><td></td><td>Total pasivo y patrimonio</td><td class="num">${money(data.totalLiabilitiesAndEquity)}</td></tr></table></article></div>`;
    }
    if (act === 'run-income') {
      const from = document.getElementById('f-from').value, to = document.getElementById('f-to').value;
      const data = await api(`/api/reports/income?from=${from}&to=${to}`);
      document.getElementById('exp').innerHTML = exportLinks(`/api/reports/income?from=${from}&to=${to}`);
      const block = (title, list) => `<h3>${title}</h3><table class="data">${list.map((r) => `<tr><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td class="num">${money(r.amountCents)}</td></tr>`).join('')}</table>`;
      document.getElementById('result').innerHTML = `<article class="card">${block('Ingresos', data.income)}${block('Costos', data.costs)}${block('Gastos', data.expenses)}<p class="ok-line">Utilidad del período ${money(data.profitCents)}</p></article>`;
    }
    if (act === 'run-cross') {
      const date = document.getElementById('f-date').value;
      const data = await api('/api/reports/crosscheck?date=' + date);
      document.getElementById('result').innerHTML = table(['Módulo', 'Contabilidad', 'Submayor', 'Diferencia'], data.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${money(i.ledgerCents)}</td><td class="num">${money(i.subledgerCents)}</td><td class="num">${i.differenceCents === 0 ? '<span class="pill">Cuadra</span>' : money(i.differenceCents)}</td></tr>`).join(''));
    }
    if (act === 'open-bank') {
      const data = await api('/api/banks/' + btn.dataset.id + '/movements');
      document.getElementById('bank-detail').innerHTML = `<article class="sheet"><h3>${esc(data.bank.name)} · saldo en libros ${money(data.bookCents)}</h3>
        <div class="form-grid"><label>Tipo<select id="m-kind"><option>DEPOSITO</option><option>RETIRO</option><option>CHEQUE</option><option>ND</option><option>NC</option><option>TRANSFERENCIA</option></select></label><label>Fecha<input type="date" id="m-date" value="${state.today}"></label><label>Valor<input id="m-amount"></label><label>Detalle<input id="m-desc"></label><label>Cuenta de gasto o contrapartida<select id="m-account">${state.moveAccounts.map((a) => `<option value="${esc(a.code)}">${esc(a.code)} ${esc(a.name)}</option>`).join('')}</select></label><label class="check"><input type="checkbox" id="m-post"> Cheque posfechado</label></div>
        <button class="btn" data-act="save-move" data-bank="${data.bank.id}" type="button">Registrar movimiento</button>
        <table class="data"><thead><tr><th></th><th>Fecha</th><th>Tipo</th><th>Detalle</th><th class="num">Entra</th><th class="num">Sale</th><th>Estado</th></tr></thead>
        <tbody>${data.movements.map((m) => `<tr><td><input type="checkbox" data-rec="${m.id}" ${m.reconciled ? 'checked' : ''}></td><td>${dateES(m.doc_date)}</td><td>${esc(m.kind)}</td><td>${esc(m.description || '')}</td><td class="num">${money(m.debit_cents)}</td><td class="num">${money(m.credit_cents)}</td><td>${esc(m.status)}</td></tr>`).join('')}</tbody></table>
        <label>Saldo del estado de cuenta bancario<input id="stmt"></label><button class="btn-sec" data-act="reconcile" data-bank="${data.bank.id}" type="button">Conciliar marcados</button></article>`;
    }
    if (act === 'save-move') {
      await api('/api/banks/movements', { method: 'POST', body: { bankAccountId: Number(btn.dataset.bank), kind: document.getElementById('m-kind').value, date: document.getElementById('m-date').value, amount: document.getElementById('m-amount').value, description: document.getElementById('m-desc').value, accountCode: document.getElementById('m-account').value, postdated: document.getElementById('m-post').checked } });
      toast('Movimiento registrado.');
      go();
    }
    if (act === 'reconcile') {
      const ids = [...document.querySelectorAll('[data-rec]:checked')].map((el) => Number(el.dataset.rec));
      const data = await api('/api/banks/' + btn.dataset.bank + '/reconcile', { method: 'POST', body: { movementIds: ids, statementCents: cents(document.getElementById('stmt').value || 0), date: state.today } });
      toast('Diferencia de conciliación: ' + money(data.differenceCents));
    }
    if (act === 'clear-check') {
      await api('/api/banks/movements/' + btn.dataset.id + '/clear', { method: 'POST', body: { date: state.today } });
      toast('Cheque efectivizado.'); go();
    }
    if (act === 'kardex') {
      const data = await api(`/api/inventory/kardex?productId=${btn.dataset.id}&from=${state.today.slice(0, 4)}-01-01&to=${state.today}`);
      document.getElementById('kardex').innerHTML = `<h3>Kardex ${esc(data.product.name)}</h3>` + table(['Fecha', 'Tipo', 'Detalle', 'Entra', 'Sale', 'Costo', 'Saldo cant.', 'Saldo valor'], data.items.map((m) => `<tr><td>${dateES(m.doc_date)}</td><td>${esc(m.kind)}</td><td>${esc(m.description || m.doc_number || '')}</td><td class="num">${qtyText(m.qty_in)}</td><td class="num">${qtyText(m.qty_out)}</td><td class="num">${money(m.total_cost_cents)}</td><td class="num">${qtyText(m.balance_qty)}</td><td class="num">${money(m.balance_value_cents)}</td></tr>`).join(''));
    }
    if (act === 'save-warehouse') {
      const tr = document.querySelector('#w-body tr');
      const saved = await api('/api/inventory/warehouse', { method: 'POST', body: { docType: document.getElementById('w-type').value, date: document.getElementById('w-date').value, fromWarehouse: document.getElementById('w-from').value, toWarehouse: document.getElementById('w-to').value, lines: [{ productId: Number(tr.querySelector('[name=productId]').value), qty: tr.querySelector('[name=qty]').value, unitCost: tr.querySelector('[name=unitCost]').value }] } });
      toast('Bodega ' + saved.number);
    }
    if (act === 'import-xlsx') {
      const file = document.getElementById('xlsx').files[0];
      if (!file) throw new Error('Seleccione un archivo .xlsx');
      const buf = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (const b of bytes) binary += String.fromCharCode(b);
      const result = await api('/api/inventory/import', { method: 'POST', body: { fileBase64: btoa(binary) } });
      toast('Se importaron ' + result.imported + ' facturas.');
    }
    if (act === 'run-inv') {
      const from = document.getElementById('f-from').value, to = document.getElementById('f-to').value;
      const data = await api(`/api/inventory/report?kind=${btn.dataset.kind}&from=${from}&to=${to}`);
      document.getElementById('result').innerHTML = table(['Fecha', 'Número', 'Detalle', 'Cant.', 'Total'], data.items.map((i) => `<tr><td>${dateES(i.doc_date)}</td><td>${esc(i.doc_number)}</td><td>${esc(i.description)}</td><td class="num">${qtyText(i.qty)}</td><td class="num">${money(i.total_cents)}</td></tr>`).join(''));
    }
    if (act === 'run-sri') {
      const year = document.getElementById('y').value, month = document.getElementById('m').value;
      if (btn.dataset.which === 'ats') {
        const data = await api(`/api/sri/ats?year=${year}&month=${month}`);
        document.getElementById('result').innerHTML = `<article class="card"><p>${esc(data.company)} · ${data.purchases} compras y ${data.sales} ventas en el mes.</p><a class="btn" href="/api/sri/ats?year=${year}&month=${month}&format=xml">Descargar ATS XML</a><p class="muted">El XML sigue la estructura del Anexo Transaccional Simplificado y debe revisarse antes de enviarlo al SRI.</p></article>`;
      } else if (btn.dataset.which === '104') {
        const d = await api(`/api/sri/104?year=${year}&month=${month}`);
        document.getElementById('result').innerHTML = `<article class="card"><div class="balance"><div><h3>Ventas</h3><p>Gravadas 15% ${money(d.sales15)}</p><p>Tarifa 0% ${money(d.sales0)}</p><p>IVA generado ${money(d.ivaSales)}</p></div><div><h3>Compras</h3><p>Gravadas 15% ${money(d.purchases15)}</p><p>Tarifa 0% ${money(d.purchases0)}</p><p>Crédito tributario ${money(d.ivaPurchases)}</p></div></div><p class="${d.payableCents ? 'bad-line' : 'ok-line'}">${d.payableCents ? 'IVA a pagar ' + money(d.payableCents) : 'Crédito tributario ' + money(d.creditCents)}</p><p class="muted">${esc(d.note)}</p></article>`;
      } else {
        const d = await api(`/api/sri/103?year=${year}&month=${month}`);
        document.getElementById('result').innerHTML = table(['Código', 'Concepto', 'Base', '%', 'Valor'], d.items.map((i) => `<tr><td>${esc(i.code)}</td><td>${esc(i.name)}</td><td class="num">${money(i.base_cents)}</td><td>${i.rate}</td><td class="num">${money(i.amount_cents)}</td></tr>`).join('') + `<tr><td colspan="4">Total retenido</td><td class="num">${money(d.totalCents)}</td></tr>`) + `<p class="muted">${esc(d.note)}</p>`;
      }
    }
    if (act === 'preview-pay' || act === 'save-pay') {
      const body = { year: Number(document.getElementById('py').value), month: Number(document.getElementById('pm').value), payFrom: document.getElementById('ppay').value || undefined, items: state.payItems || [] };
      if (act === 'preview-pay' && state.payItems) {
        body.items = [...document.querySelectorAll('#pay-box tbody tr')].map((tr) => ({ employeeId: Number(tr.dataset.id), hours50: tr.querySelector('[name=h50]').value, hours100: tr.querySelector('[name=h100]').value, bonuses: tr.querySelector('[name=bon]').value, deductions: tr.querySelector('[name=ded]').value }));
      }
      if (act === 'preview-pay') {
        const data = await api('/api/payroll/preview', { method: 'POST', body });
        state.payItems = data.lines.map((l) => ({ employeeId: l.employeeId }));
        document.getElementById('pay-box').innerHTML = table(['Empleado', 'Horas 50%', 'Horas 100%', 'Bonos', 'Deducciones', 'IESS personal', 'Líquido'], data.lines.map((l) => `<tr data-id="${l.employeeId}"><td>${esc(l.name)}</td><td><input name="h50" value="0"></td><td><input name="h100" value="0"></td><td><input name="bon" value="0"></td><td><input name="ded" value="0"></td><td class="num">${money(l.iessPersonalCents)}</td><td class="num">${money(l.netCents)}</td></tr>`).join('') + `<tr><td colspan="6">Total líquido</td><td class="num">${money(data.totals.netCents)}</td></tr>`);
      } else {
        body.items = [...document.querySelectorAll('#pay-box tbody tr')].filter((tr) => tr.dataset.id).map((tr) => ({ employeeId: Number(tr.dataset.id), hours50: tr.querySelector('[name=h50]').value, hours100: tr.querySelector('[name=h100]').value, bonuses: tr.querySelector('[name=bon]').value, deductions: tr.querySelector('[name=ded]').value }));
        const saved = await api('/api/payroll', { method: 'POST', body });
        toast('Rol contabilizado. Líquido ' + money(saved.totals.netCents));
        go();
      }
    }
    if (act === 'open-pay') {
      const data = await api('/api/payroll/' + btn.dataset.id);
      document.getElementById('pay-detail').innerHTML = table(['Empleado', 'Sueldo', 'Extras', 'Décimo 13', 'Décimo 14', 'Fondos', 'IESS', 'Líquido'], data.lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="num">${money(l.salary_cents)}</td><td class="num">${money(l.overtime_cents)}</td><td class="num">${money(l.thirteenth_cents)}</td><td class="num">${money(l.fourteenth_cents)}</td><td class="num">${money(l.reserve_cents)}</td><td class="num">${money(l.iess_personal_cents)}</td><td class="num">${money(l.net_cents)}</td></tr>`).join(''));
    }
    if (act === 'restore') {
      const file = document.getElementById('backup-file').files[0];
      if (!file) throw new Error('Seleccione el JSON de respaldo.');
      if (!confirm('Esto reemplaza los datos de la empresa activa.')) return;
      const data = JSON.parse(await file.text());
      await api('/api/backup/restore', { method: 'POST', body: { data } });
      toast('Empresa restaurada.');
      go();
    }
    if (act === 'new-account') openModal(`<form id="modal-form"><h3>Nueva cuenta</h3><label>Código<input name="code" placeholder="1.1.01.03" required></label><label>Nombre<input name="name" required></label><label>Tipo<select name="type"><option>ACTIVO</option><option>PASIVO</option><option>PATRIMONIO</option><option>INGRESO</option><option>COSTO</option><option>GASTO</option></select></label><label>Naturaleza<select name="nature"><option>DEUDORA</option><option>ACREEDORA</option></select></label><label class="check"><input type="checkbox" name="isMovement" checked> De movimiento</label><button class="btn" type="submit">Grabar</button></form>`);
  } catch (err) { toast(err.message); }
});

document.body.addEventListener('change', async (e) => {
  if (e.target.id === 'company-switch') {
    const me = await api('/api/session/company', { method: 'POST', body: { companyId: Number(e.target.value) } });
    state.companies = me.companies;
    state.company = me.company;
    paintChrome();
    go();
  }
  const product = e.target.closest('select[name=productId]');
  if (product && state.draft) {
    const item = state.draft.products.find((p) => p.id === Number(product.value));
    const tr = product.closest('tr');
    if (item) {
      tr.querySelector('[name=description]').value = item.name;
      tr.querySelector('[name=price]').value = (item.price_cents / 100).toFixed(2);
      tr.querySelector('[name=ivaRate]').value = String(item.iva_rate);
      tr.querySelector('[name=iceRate]').value = item.ice_rate || 0;
    }
    syncDraftFromDom();
    document.getElementById('live-totals').innerHTML = totalsHtml(liveTotals(state.draft.lines));
  }
  if (e.target.closest('#line-body') && state.draft) {
    syncDraftFromDom();
    document.getElementById('live-totals').innerHTML = totalsHtml(liveTotals(state.draft.lines));
  }
  const code = e.target.closest('#ret-body select[name=code]');
  if (code) {
    const optEl = code.selectedOptions[0];
    const tr = code.closest('tr');
    tr.querySelector('[name=tax]').value = optEl.dataset.tax;
    tr.querySelector('[name=rate]').value = optEl.dataset.rate;
  }
});

document.body.addEventListener('submit', async (e) => {
  const form = e.target;
  if (form.id !== 'modal-form') return;
  e.preventDefault();
  try {
    const data = readForm(form);
    if (['CLIENTE', 'PROVEEDOR', 'BENEFICIARIO', 'EMPLEADO'].includes(data.kind)) {
      if (data.id) await api('/api/parties/' + data.id, { method: 'PUT', body: data });
      else await api('/api/parties', { method: 'POST', body: data });
    } else if (data.ruc) {
      await api('/api/companies', { method: 'POST', body: data });
      const me = await api('/api/me');
      state.companies = me.companies;
      state.company = me.company;
    } else if (data.code && data.ivaRate != null && data.price != null) {
      if (data.id) await api('/api/products/' + data.id, { method: 'PUT', body: data });
      else await api('/api/products', { method: 'POST', body: data });
    } else if (data.type && data.nature) {
      await api('/api/accounts', { method: 'POST', body: data });
    }
    document.getElementById('modal').close();
    toast('Registro grabado.');
    go();
  } catch (err) { toast(err.message); }
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('login-error');
  err.hidden = true;
  try {
    const me = await api('/api/login', { method: 'POST', body: readForm(e.target) });
    await enter(me);
  } catch (ex) {
    err.hidden = false;
    err.textContent = ex.message;
  }
});

async function enter(me) {
  state.user = me.user;
  state.companies = me.companies;
  state.company = me.company;
  state.catalogs = await api('/api/catalogs');
  document.getElementById('login').hidden = true;
  document.getElementById('app').hidden = false;
  if (!location.hash) location.hash = '#/inicio';
  else go();
}
window.addEventListener('hashchange', go);
(async function boot() {
  try {
    const health = await api('/api/health');
    state.today = health.today;
    const me = await api('/api/me');
    await enter(me);
  } catch { /* pantalla de acceso */ }
})();
