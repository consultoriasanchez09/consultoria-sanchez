const DOC_TYPES = {
  FV: { label: 'Factura de venta', side: 'VENTA', posts: true, party: 'CLIENTE' },
  NV: { label: 'Nota de venta', side: 'VENTA', posts: true, party: 'CLIENTE' },
  COT: { label: 'Cotización', side: 'VENTA', posts: false, party: 'CLIENTE' },
  NCV: { label: 'Nota de crédito de venta', side: 'VENTA', posts: true, party: 'CLIENTE', related: true },
  NDV: { label: 'Nota de débito de venta', side: 'VENTA', posts: true, party: 'CLIENTE', related: true },
  FC: { label: 'Factura de compra', side: 'COMPRA', posts: true, party: 'PROVEEDOR' },
  LIQ: { label: 'Liquidación de compra', side: 'COMPRA', posts: true, party: 'PROVEEDOR' },
  NCC: { label: 'Nota de crédito de compra', side: 'COMPRA', posts: true, party: 'PROVEEDOR', related: true },
  NDC: { label: 'Nota de débito de compra', side: 'COMPRA', posts: true, party: 'PROVEEDOR', related: true },
  RET: { label: 'Comprobante de retención', side: 'COMPRA', posts: true, party: 'PROVEEDOR', related: true },
};

const RETENTION_CODES = [
  { code: '303', tax: 'RENTA', rate: 10, name: 'Honorarios profesionales' },
  { code: '304', tax: 'RENTA', rate: 8, name: 'Servicios en los que predomina el intelecto' },
  { code: '307', tax: 'RENTA', rate: 2, name: 'Servicios' },
  { code: '309', tax: 'RENTA', rate: 1.75, name: 'Bienes muebles de naturaleza corporal' },
  { code: '312', tax: 'RENTA', rate: 1.75, name: 'Transferencia de bienes muebles' },
  { code: '320', tax: 'RENTA', rate: 1, name: 'Arrendamiento mercantil' },
  { code: '332', tax: 'RENTA', rate: 2, name: 'Otras retenciones de renta' },
  { code: '725', tax: 'IVA', rate: 30, name: 'Retención IVA 30%' },
  { code: '727', tax: 'IVA', rate: 70, name: 'Retención IVA 70%' },
  { code: '729', tax: 'IVA', rate: 100, name: 'Retención IVA 100%' },
  { code: '721', tax: 'IVA', rate: 10, name: 'Retención IVA 10%' },
  { code: '723', tax: 'IVA', rate: 20, name: 'Retención IVA 20%' },
  { code: '731', tax: 'IVA', rate: 50, name: 'Retención IVA 50%' },
];

const PAYMENT_METHODS = [
  { id: 'CREDITO', label: 'Crédito' },
  { id: 'EFECTIVO', label: 'Efectivo' },
  { id: 'TRANSFERENCIA', label: 'Transferencia' },
  { id: 'CHEQUE', label: 'Cheque' },
  { id: 'TARJETA', label: 'Tarjeta' },
];

const SRI_PAY_CODES = [
  { id: '01', label: '01 Sin utilización del sistema financiero' },
  { id: '15', label: '15 Compensación de deudas' },
  { id: '16', label: '16 Tarjeta de débito' },
  { id: '19', label: '19 Tarjeta de crédito' },
  { id: '20', label: '20 Otros con utilización del sistema financiero' },
];

const REGIMENES = [
  { id: 'GENERAL', label: 'General' },
  { id: 'RIMPE_EMPRENDEDOR', label: 'RIMPE emprendedor' },
  { id: 'RIMPE_NEGOCIO_POPULAR', label: 'RIMPE negocio popular' },
  { id: 'ESPECIAL', label: 'Contribuyente especial' },
];

const ID_TYPES = [
  { id: 'RUC', label: 'RUC' },
  { id: 'CEDULA', label: 'Cédula' },
  { id: 'PASAPORTE', label: 'Pasaporte' },
  { id: 'CONSUMIDOR_FINAL', label: 'Consumidor final' },
];

const FISCAL_DOCS = new Set(['FV', 'FC', 'NV', 'COT', 'NCV', 'NDV', 'NCC', 'NDC', 'RET', 'LIQ']);

function formatNumber(docType, n, est = '001', punto = '001') {
  if (FISCAL_DOCS.has(docType)) return `${est}-${punto}-${String(n).padStart(9, '0')}`;
  return `${docType}-${String(n).padStart(6, '0')}`;
}

function monthRange(year, month) {
  const m = String(month).padStart(2, '0');
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${m}-01`, to: `${year}-${m}-${String(last).padStart(2, '0')}` };
}

function catalogs() {
  return {
    docTypes: DOC_TYPES,
    retentionCodes: RETENTION_CODES,
    paymentMethods: PAYMENT_METHODS,
    sriPayCodes: SRI_PAY_CODES,
    regimenes: REGIMENES,
    idTypes: ID_TYPES,
    ivaRates: [15, 0],
    roles: [
      { id: 'admin', label: 'Administrador' },
      { id: 'contador', label: 'Contador' },
      { id: 'auxiliar', label: 'Auxiliar' },
      { id: 'consulta', label: 'Consulta' },
    ],
  };
}

module.exports = {
  DOC_TYPES,
  RETENTION_CODES,
  PAYMENT_METHODS,
  SRI_PAY_CODES,
  REGIMENES,
  ID_TYPES,
  FISCAL_DOCS,
  formatNumber,
  monthRange,
  catalogs,
};
