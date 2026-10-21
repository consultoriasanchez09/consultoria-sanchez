'use strict';

/** Cédula ecuatoriana de persona natural: 10 dígitos y dígito verificador. */
function validarCedula(value) {
  const cedula = String(value ?? '').replace(/\D/g, '');
  if (!/^\d{10}$/.test(cedula)) return { ok: false, error: 'La cédula debe tener 10 dígitos.' };
  const prov = Number(cedula.slice(0, 2));
  if (prov < 1 || (prov > 24 && prov !== 30)) return { ok: false, error: 'La cédula no corresponde a una provincia ecuatoriana.' };
  if (Number(cedula[2]) > 5) return { ok: false, error: 'La cédula no corresponde a una persona natural.' };
  const coef = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let n = Number(cedula[i]) * coef[i];
    if (n >= 10) n -= 9;
    sum += n;
  }
  const check = (10 - (sum % 10)) % 10;
  if (check !== Number(cedula[9])) return { ok: false, error: 'El dígito verificador de la cédula no coincide.' };
  return { ok: true, cedula };
}

/** RUC: exactamente 13 dígitos, tal como se pidió para esta versión de prueba. */
function validarRuc(value) {
  const ruc = String(value ?? '').replace(/\D/g, '');
  if (!/^\d{13}$/.test(ruc)) return { ok: false, error: 'El RUC debe tener 13 dígitos.' };
  return { ok: true, ruc };
}

function validarDirectivo(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (['1', 'si', 'sí', 's', 'true', 'x', 'directivo', 'rep', 'representante'].includes(s)) return 1;
  if (['0', 'no', 'n', 'false', '', 'null'].includes(s)) return 0;
  return null;
}

module.exports = { validarCedula, validarRuc, validarDirectivo };
