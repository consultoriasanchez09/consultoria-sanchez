'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { initSchema, emitirLote } = require('../lib/igualdad');

const USAGE = `Uso:
  node scripts/generar-certificados.js --input trabajadores.csv --out ./salida --razon "Empresa Cía. Ltda." --ruc 1791234567001 --periodo 2025 --fecha 2025-12-15
  node scripts/generar-certificados.js --input lote.json --out ./salida --db ./data.db --base https://ejemplo.com

CSV con columnas nombre,cedula,cargo
  y --razon --ruc. O columnas nombre,cedula,cargo,razon_social,ruc y, si quiere, periodo,fecha.

JSON: { "razon_social", "ruc", "periodo", "fecha", "trabajadores": [ { "nombre", "cedula", "cargo" } ] }
  o un arreglo de esos lotes.

Escribe un PDF por persona e indice.csv en --out. Cada código CSLM- queda en la base y se consulta en /verificar/CODIGO.
  --periodo   año del certificado. Por defecto 2025.
  --fecha     aprobación y emisión, dentro de ese año. Por defecto el 15 de diciembre.
  --db        base SQLite. Por defecto DB_PATH o ./data.db.
  --base      origen del código QR. Por defecto PUBLIC_URL o http://localhost:3000.
`;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  row.push(cur);
  if (row.some(cell => String(cell).trim())) rows.push(row);
  return rows;
}

function lotesDesdeCsv(text, flags) {
  const matrix = parseCsv(text);
  if (!matrix.length) throw new Error('El CSV está vacío.');
  const headers = matrix[0].map(h => String(h || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  const col = name => headers.indexOf(name);
  const iNombre = col('nombre');
  const iCed = col('cedula');
  const iCargo = col('cargo');
  if (iNombre < 0 || iCed < 0 || iCargo < 0) throw new Error('El CSV debe incluir las columnas nombre, cedula y cargo.');
  const iRazon = col('razon_social');
  const iRuc = col('ruc');
  const iPeriodo = col('periodo');
  const iFecha = col('fecha');
  const groups = new Map();
  matrix.slice(1).forEach((r, n) => {
    const nombre = r[iNombre];
    const cedula = r[iCed];
    const cargo = r[iCargo];
    if (![nombre, cedula, cargo].some(v => String(v || '').trim())) return;
    const razon = iRazon >= 0 ? r[iRazon] : flags.razon;
    const ruc = iRuc >= 0 ? r[iRuc] : flags.ruc;
    const periodo = iPeriodo >= 0 && String(r[iPeriodo] || '').trim() ? r[iPeriodo] : flags.periodo;
    const fecha = iFecha >= 0 && String(r[iFecha] || '').trim() ? r[iFecha] : flags.fecha;
    const key = [ruc, razon, periodo || 2025, fecha || ''].join('|');
    if (!groups.has(key)) groups.set(key, { razon_social: razon, ruc, periodo, fecha, trabajadores: [] });
    groups.get(key).trabajadores.push({ fila: n + 2, nombre, cedula, cargo });
  });
  return [...groups.values()];
}

function lotesDesdeJson(text, flags) {
  const data = JSON.parse(text);
  const lotes = Array.isArray(data) ? data : [data];
  return lotes.map(lote => ({
    razon_social: lote.razon_social || flags.razon,
    ruc: lote.ruc || flags.ruc,
    periodo: lote.periodo == null ? flags.periodo : lote.periodo,
    fecha: lote.fecha || flags.fecha,
    fechaAprobacion: lote.fechaAprobacion,
    fechaEmision: lote.fechaEmision,
    trabajadores: lote.trabajadores || lote.workers || []
  }));
}

function csvCampo(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(USAGE);
    return;
  }
  const input = arg('--input');
  const out = arg('--out');
  if (!input || !out) {
    process.stderr.write(USAGE);
    process.exitCode = 1;
    return;
  }
  const flags = { razon: arg('--razon'), ruc: arg('--ruc'), periodo: arg('--periodo'), fecha: arg('--fecha') };
  const raw = fs.readFileSync(input, 'utf8');
  const lotes = input.toLowerCase().endsWith('.json') || /^\s*[[{]/.test(raw) ? lotesDesdeJson(raw, flags) : lotesDesdeCsv(raw, flags);
  const dbPath = arg('--db') || process.env.DB_PATH || path.join(process.cwd(), 'data.db');
  const base = (arg('--base') || process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
  fs.mkdirSync(out, { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  const indice = ['codigo,nombre,cedula,cargo,razon_social,ruc,archivo'];
  for (const lote of lotes) {
    const emitido = await emitirLote(db, { ...lote, verifyBase: base });
    for (const item of emitido.certificados) {
      fs.writeFileSync(path.join(out, item.filename), item.pdf);
      indice.push([item.code, item.nombre, item.cedula, item.cargo, item.razon, item.ruc, item.filename].map(csvCampo).join(','));
      console.log(`${item.code}  ${item.nombre}  ${item.filename}`);
    }
  }
  fs.writeFileSync(path.join(out, 'indice.csv'), indice.join('\n') + '\n');
  db.close();
  console.log(`Listo: ${indice.length - 1} PDF en ${out}`);
}

main().catch(err => {
  console.error(err.message);
  if (err.errors) console.error(err.errors.map(e => `fila ${e.fila}: ${e.error}`).join('\n'));
  process.exit(1);
});
