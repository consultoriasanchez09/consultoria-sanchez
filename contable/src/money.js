function parseMoney(input) {
  if (input == null || input === '') return 0;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('Monto inválido.');
    return Math.round(input * 100);
  }
  let s = String(input).trim().replace(/\s/g, '');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error('Monto inválido.');
  return Math.round(n * 100);
}

function formatMoney(cents) {
  const n = Number(cents || 0) / 100;
  return n.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function asCents(n, label = 'monto') {
  const x = Number(n);
  if (!Number.isInteger(x)) throw new Error(`El ${label} debe estar en centavos enteros.`);
  return x;
}

module.exports = { parseMoney, formatMoney, asCents };
