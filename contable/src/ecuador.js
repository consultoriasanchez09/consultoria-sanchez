const PROVINCES = new Set([
  '01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','30'
]);

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function cedulaCheckDigit(first9) {
  const coef = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let v = Number(first9[i]) * coef[i];
    if (v >= 10) v -= 9;
    sum += v;
  }
  const mod = sum % 10;
  return mod === 0 ? 0 : 10 - mod;
}

function modulo11(base, coef) {
  let sum = 0;
  for (let i = 0; i < coef.length; i++) sum += Number(base[i]) * coef[i];
  const mod = sum % 11;
  let check = 11 - mod;
  if (check === 11) check = 0;
  if (check === 10) check = 1;
  return check;
}

function validateCedula(value) {
  const id = digitsOnly(value);
  if (id.length !== 10) return { ok: false, error: 'La cédula debe tener 10 dígitos.' };
  if (!PROVINCES.has(id.slice(0, 2))) return { ok: false, error: 'El código de provincia de la cédula no es válido.' };
  const third = Number(id[2]);
  if (third >= 6) return { ok: false, error: 'El tercer dígito de la cédula no corresponde a una persona natural.' };
  const expected = cedulaCheckDigit(id.slice(0, 9));
  if (expected !== Number(id[9])) return { ok: false, error: 'El dígito verificador de la cédula no coincide.' };
  return { ok: true, normalized: id, kind: 'CEDULA' };
}

function validateRuc(value) {
  const id = digitsOnly(value);
  if (id.length !== 13) return { ok: false, error: 'El RUC debe tener 13 dígitos.' };
  if (!PROVINCES.has(id.slice(0, 2))) return { ok: false, error: 'El código de provincia del RUC no es válido.' };
  const third = Number(id[2]);
  if (third < 6) {
    const ced = validateCedula(id.slice(0, 10));
    if (!ced.ok) return { ok: false, error: 'El RUC de persona natural no supera la validación de cédula.' };
    if (id.slice(10) === '000') return { ok: false, error: 'El establecimiento del RUC no puede ser 000.' };
    return { ok: true, normalized: id, kind: 'RUC', person: 'NATURAL' };
  }
  if (third === 6) {
    const check = modulo11(id, [3, 2, 7, 6, 5, 4, 3, 2]);
    if (check !== Number(id[8])) return { ok: false, error: 'El dígito verificador del RUC de entidad pública no coincide.' };
    if (id.slice(9) === '0000') return { ok: false, error: 'El establecimiento del RUC público no es válido.' };
    return { ok: true, normalized: id, kind: 'RUC', person: 'PUBLICA' };
  }
  if (third === 9) {
    const check = modulo11(id, [4, 3, 2, 7, 6, 5, 4, 3, 2]);
    if (check !== Number(id[9])) return { ok: false, error: 'El dígito verificador del RUC de sociedad privada no coincide.' };
    if (id.slice(10) === '000') return { ok: false, error: 'El establecimiento del RUC no puede ser 000.' };
    return { ok: true, normalized: id, kind: 'RUC', person: 'PRIVADA' };
  }
  return { ok: false, error: 'El tercer dígito del RUC no es válido.' };
}

function validateIdentification(type, value) {
  const kind = String(type || '').toUpperCase();
  if (kind === 'CONSUMIDOR_FINAL') {
    const id = digitsOnly(value);
    if (id !== '9999999999999') return { ok: false, error: 'El consumidor final usa la identificación 9999999999999.' };
    return { ok: true, normalized: id, kind };
  }
  if (kind === 'PASAPORTE') {
    const id = String(value || '').trim().toUpperCase();
    if (id.length < 4 || id.length > 20) return { ok: false, error: 'El pasaporte debe tener entre 4 y 20 caracteres.' };
    return { ok: true, normalized: id, kind };
  }
  if (kind === 'CEDULA') return validateCedula(value);
  if (kind === 'RUC') return validateRuc(value);
  return { ok: false, error: 'Tipo de identificación no reconocido.' };
}

function makeCedula(province, seven) {
  const base9 = String(province).padStart(2, '0') + String(seven).padStart(7, '0');
  if (base9.length !== 9) throw new Error('Base de cédula inválida.');
  return base9 + String(cedulaCheckDigit(base9));
}

function makeRucNatural(cedula) {
  return validateCedula(cedula).ok ? cedula + '001' : (() => { throw new Error('Cédula base inválida.'); })();
}

function makeRucPrivada(province, six) {
  const base9 = String(province).padStart(2, '0') + '9' + String(six).padStart(6, '0');
  const check = modulo11(base9, [4, 3, 2, 7, 6, 5, 4, 3, 2]);
  return base9 + String(check) + '001';
}

module.exports = {
  validateCedula,
  validateRuc,
  validateIdentification,
  makeCedula,
  makeRucNatural,
  makeRucPrivada,
  cedulaCheckDigit,
  modulo11,
};
