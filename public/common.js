const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(u,o={}){const r=await fetch(u,{method:o.method||(o.body?'POST':'GET'),headers:{'Content-Type':'application/json'},body:o.body&&JSON.stringify(o.body)});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Error');return d}
function embed(u){if(!u)return'';let m=u.match(/(?:youtu\.be\/|v=|embed\/)([\w-]{11})/);if(m)u='https://www.youtube.com/embed/'+m[1];
 m=u.match(/vimeo\.com\/(\d+)/);if(m)u='https://player.vimeo.com/video/'+m[1];
 m=u.match(/drive\.google\.com\/file\/d\/([\w-]+)/);if(m)u='https://drive.google.com/file/d/'+m[1]+'/preview';
 return /^https:\/\//.test(u)?`<div class="video"><iframe src="${esc(u)}" allowfullscreen allow="accelerometer; encrypted-media; picture-in-picture"></iframe></div>`:''}
const header=`<header class="top"><div class="wrap"><a class="brand" href="/"><img src="img/logo.png" alt=""><span><b>Consultoría</b> Sánchez</span></a><nav style="display:flex;gap:12px;align-items:center"><span id="who" class="small"></span><button id="out" class="btn btn-sm btn-sec" style="display:none;border:1px solid #ccd">Salir</button></nav></div></header>`;
document.body.insertAdjacentHTML('afterbegin',header);
out.onclick=async()=>{await api('/api/logout',{method:'POST'});location.reload()};
