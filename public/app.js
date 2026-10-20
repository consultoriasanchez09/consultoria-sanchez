y.textContent=new Date().getFullYear();
document.querySelectorAll('#menu a').forEach(a=>a.onclick=()=>menu.classList.remove('open'));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yn=v=>v==null||v===''?'—':(v==='S'||v===true||v==='SI'?'Sí':v==='N'||v===false||v==='NO'?'No':esc(v));
sriForm.onsubmit=async e=>{e.preventDefault();const box=sriRes;box.style.display='block';
 const v=ruc.value.replace(/\D/g,'');if(!(v.length===10||v.length===13)){box.innerHTML='<p class="err">Ingrese 10 dígitos (cédula) o 13 dígitos (RUC).</p>';return}
 box.innerHTML='<p>Consultando al SRI…</p>';
 try{const r=await fetch('/api/sri/'+v);const d=await r.json();
  if(!d.ok){box.innerHTML='<p class="err">⚠️ '+esc(d.error)+'</p>';return}
  const act=(d.estado||'').toUpperCase()==='ACTIVO';
  box.innerHTML=`<table>
  <tr><td>RUC</td><td>${esc(d.ruc)}</td></tr><tr><td>Razón social</td><td>${esc(d.razonSocial)}</td></tr>
  <tr><td>Estado</td><td><span class="${act?'ok-pill':'bad-pill'}">${esc(d.estado||'—')}</span></td></tr>
  <tr><td>Actividad económica</td><td>${esc(d.actividad||'—')}</td></tr><tr><td>Tipo de contribuyente</td><td>${esc(d.tipo||'—')}</td></tr>
  <tr><td>Régimen / categoría</td><td>${esc([d.regimen,d.categoria].filter(Boolean).join(' – ')||'—')}</td></tr>
  <tr><td>Obligado a llevar contabilidad</td><td>${yn(d.obligadoContabilidad)}</td></tr><tr><td>Agente de retención</td><td>${yn(d.agenteRetencion)}</td></tr>
  <tr><td>Contribuyente especial</td><td>${yn(d.contribuyenteEspecial)}</td></tr><tr><td>Inicio de actividades</td><td>${esc(d.fechaInicio||'—')}</td></tr></table>
  <p class="small">¿Necesitas ayuda con tus obligaciones? <a href="https://wa.me/593990795475" target="_blank">Escríbenos</a>.</p>`;
 }catch{box.innerHTML='<p class="err">No se pudo conectar. Intente nuevamente.</p>'}};
