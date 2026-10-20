# Consultoría Sánchez – Sitio web y Aula Virtual

Sitio web corporativo de **Consultoría Sánchez (La Maná, Cotopaxi, Ecuador)** con consulta de RUC en el SRI, Aula Virtual de capacitación y panel de administración.

**Tecnología:** Node.js 18+ · Express · SQLite (better-sqlite3) · bcrypt · sesiones · HTML/CSS/JS sin frameworks.

## Ejecutar en local
```bash
npm install
npm start            # http://localhost:3000
```
- Sitio: `/` · Aula Virtual: `/aula` · Administración: `/admin`
- La base de datos `data.db` se crea sola la primera vez, con datos de ejemplo.

### Cuentas iniciales (¡cambiar la contraseña!)
| Rol | Usuario | Contraseña / código |
|---|---|---|
| Administrador | `admin` | `CambiarEsta2026!` (cámbiela en /admin → "Cambiar mi contraseña") |
| Estudiante demo | `estudiante` | `Estudiante2026` o código `DEMO-2026` |

Elimine al estudiante demo antes de publicar.

### Variables de entorno
| Variable | Uso |
|---|---|
| `PORT` | Puerto (por defecto 3000) |
| `SESSION_SECRET` | Clave larga y aleatoria para las sesiones (**obligatoria en producción**) |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Admin inicial (solo se usan si la base aún no existe) |
| `DB_PATH` | Ruta del archivo SQLite |
| `NODE_ENV=production` y `HTTPS=1` | Cookies seguras detrás de HTTPS |

## Consulta SRI
El navegador no puede consultar al SRI directamente (CORS), así que el servidor hace de proxy en `GET /api/sri/:ruc`. Acepta una cédula (10 dígitos, se le agrega `001`) o un RUC (13 dígitos). Usa estos endpoints públicos del SRI:
- `https://srienlinea.sri.gob.ec/sri-catastro-sujeto-servicio-internet/rest/ConsolidadoContribuyente/existePorNumeroRuc?numeroRuc=RUC`
- `https://srienlinea.sri.gob.ec/sri-catastro-sujeto-servicio-internet/rest/ConsolidadoContribuyente/obtenerPorNumerosRuc?&ruc=RUC`

Las respuestas se guardan en caché 1 hora. Estos endpoints no tienen documentación oficial y el SRI podría cambiarlos; si fallan, la página muestra un mensaje amable. El SRI a veces responde lento o bloquea servidores fuera de Ecuador, así que conviene un hosting que lo alcance bien.

## Aula Virtual
- Los estudiantes entran con usuario y contraseña **o** con un código de acceso, y solo ven los cursos en los que están inscritos.
- Desde `/admin` se pueden crear cursos y clases (enlace de video de YouTube, Vimeo o Google Drive, material y texto), crear estudiantes, generar códigos e inscribir o retirar estudiantes.

## Publicar (VPS Ubuntu)
```bash
sudo apt install -y nodejs npm nginx
cd /opt && unzip consultoria-sanchez.zip && cd consultoria-sanchez && npm install --omit=dev
sudo npm i -g pm2
SESSION_SECRET=$(openssl rand -hex 32) NODE_ENV=production HTTPS=1 pm2 start server.js --name consultoria
pm2 save && pm2 startup
```
Nginx como proxy inverso hacia `127.0.0.1:3000` y HTTPS gratis con `certbot --nginx -d sudominio.ec`.
También funciona en Render/Railway (necesita un disco persistente para `data.db`). **Respalde `data.db` con regularidad.**

## Publicación gratuita permanente (Render)
1. Cree una cuenta gratuita en GitHub y suba este proyecto a un repositorio (sin `node_modules` ni `data.db`, ya excluidos en `.gitignore`).
2. Entre a https://render.com con esa cuenta de GitHub → **New → Blueprint** → elija el repositorio (se usa `render.yaml`).
3. Escriba un `ADMIN_PASSWORD` seguro. Render genera `SESSION_SECRET` por su cuenta.
4. Obtendrá una dirección `https://consultoria-sanchez.onrender.com`. Puede conectar un dominio propio (por ejemplo `.ec`).

**Limitaciones del plan gratuito:** el servicio se apaga tras 15 minutos sin visitas (la primera carga tarda unos 50 s) y **el disco no es persistente**: cursos, estudiantes y códigos se pierden en cada reinicio o despliegue. Para conservar los datos hay tres opciones:
- un disco persistente de Render (de pago, unos USD 7/mes más el plan *Starter*);
- un VPS económico (ver la sección anterior);
- cambiar SQLite por una base gratuita en la nube (Turso o Neon, por ejemplo), lo que requiere ajustar el código.

## Datos de contacto (en `public/index.html`)
Dirección: Amazonas y Benjamín Sarabia, La Maná, Cotopaxi · WhatsApp: +593 99 079 5475 · Correo: glenda_isas@hotmail.com · Horario: Lunes a viernes de 08h00 a 17h00.
Los testimonios son textos de ejemplo con nombres genéricos; reemplácelos por testimonios reales cuando se tenga la autorización de los clientes.
