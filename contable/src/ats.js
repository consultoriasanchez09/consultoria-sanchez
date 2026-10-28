function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function money(cents) {
  return (Math.round(Number(cents || 0)) / 100).toFixed(2);
}

function dmy(iso) {
  const [y, m, d] = String(iso || '').split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

function splitNumber(docNumber) {
  const parts = String(docNumber || '').split('-');
  if (parts.length >= 3) return { est: parts[0], punto: parts[1], sec: parts[2] };
  return { est: '001', punto: '001', sec: String(docNumber || '0').padStart(9, '0') };
}

function clientIdType(idType) {
  if (idType === 'RUC') return '04';
  if (idType === 'CEDULA') return '05';
  if (idType === 'PASAPORTE') return '06';
  return '07';
}

function supplierIdType(idType) {
  if (idType === 'CEDULA') return '02';
  if (idType === 'PASAPORTE') return '03';
  return '01';
}

function saleDocCode(docType) {
  if (docType === 'NCV') return '04';
  if (docType === 'NDV') return '05';
  return '18';
}

function purchaseDocCode(docType) {
  if (docType === 'LIQ') return '03';
  if (docType === 'NCC') return '04';
  if (docType === 'NDC') return '05';
  return '01';
}

function signed(docType, cents) {
  return docType === 'NCV' || docType === 'NCC' ? -Math.round(cents || 0) : Math.round(cents || 0);
}

function buildAtsXml({ company, year, month, purchases, sales }) {
  const ventasGravadas = sales.reduce((s, v) => s + signed(v.docType, v.base15), 0);
  const totalVentas = sales.reduce((s, v) => s + signed(v.docType, (v.base15 || 0) + (v.base0 || 0)), 0);
  const groups = new Map();
  for (const sale of sales) {
    const key = [clientIdType(sale.idType), sale.identification, saleDocCode(sale.docType), sale.parteRel || 'NO'].join('|');
    const g = groups.get(key) || {
      tp: clientIdType(sale.idType),
      id: sale.identification,
      parte: sale.parteRel || 'NO',
      tipo: saleDocCode(sale.docType),
      count: 0,
      base0: 0,
      base15: 0,
      iva: 0,
      ice: 0,
      forma: sale.sriPayCode || '20',
    };
    g.count += 1;
    g.base0 += signed(sale.docType, sale.base0);
    g.base15 += signed(sale.docType, sale.base15);
    g.iva += signed(sale.docType, sale.iva);
    g.ice += signed(sale.docType, sale.ice);
    groups.set(key, g);
  }
  const estMap = new Map();
  for (const sale of sales) {
    const est = sale.establecimiento || company.establecimiento || '001';
    estMap.set(est, (estMap.get(est) || 0) + signed(sale.docType, (sale.base15 || 0) + (sale.base0 || 0)));
  }
  const comprasXml = purchases.map((p) => {
    const num = splitNumber(p.docNumber);
    const air = (p.retenciones || []).filter((r) => r.tax === 'RENTA' && r.amountCents);
    const ivaRets = (p.retenciones || []).filter((r) => r.tax === 'IVA');
    const ivaByRate = (rate) => ivaRets.filter((r) => Number(r.rate) === rate).reduce((s, r) => s + r.amountCents, 0);
    const sign = p.docType === 'NCC' ? -1 : 1;
    return `    <detalleCompras>
      <codSustento>${xmlEscape(p.sustento || '01')}</codSustento>
      <tpIdProv>${supplierIdType(p.idType)}</tpIdProv>
      <idProv>${xmlEscape(p.identification)}</idProv>
      <tipoComprobante>${purchaseDocCode(p.docType)}</tipoComprobante>
      <parteRel>${p.parteRel ? 'SI' : 'NO'}</parteRel>
      <fechaRegistro>${dmy(p.date)}</fechaRegistro>
      <establecimiento>${xmlEscape(num.est)}</establecimiento>
      <puntoEmision>${xmlEscape(num.punto)}</puntoEmision>
      <secuencial>${xmlEscape(num.sec)}</secuencial>
      <fechaEmision>${dmy(p.date)}</fechaEmision>
      <autorizacion>${xmlEscape(p.autorizacion || '9999999999')}</autorizacion>
      <baseNoGraIva>0.00</baseNoGraIva>
      <baseImponible>${money(sign * (p.base0 || 0))}</baseImponible>
      <baseImpGrav>${money(sign * (p.base15 || 0))}</baseImpGrav>
      <baseImpExe>0.00</baseImpExe>
      <montoIce>${money(sign * (p.ice || 0))}</montoIce>
      <montoIva>${money(sign * (p.iva || 0))}</montoIva>
      <valRetBien10>${money(ivaByRate(10))}</valRetBien10>
      <valRetServ20>${money(ivaByRate(20))}</valRetServ20>
      <valorRetBienes>${money(ivaByRate(30))}</valorRetBienes>
      <valRetServ50>${money(ivaByRate(50))}</valRetServ50>
      <valorRetServicios>${money(ivaByRate(70))}</valorRetServicios>
      <valRetServ100>${money(ivaByRate(100))}</valRetServ100>
      <totbasesImpReemb>0.00</totbasesImpReemb>
      <pagoExterior>
        <pagoLocExt>01</pagoLocExt>
        <paisEfecPago>NA</paisEfecPago>
        <aplicConvDobTrib>NA</aplicConvDobTrib>
        <pagExtSujRetNorLeg>NA</pagExtSujRetNorLeg>
      </pagoExterior>
      ${air.length ? `<air>
        ${air.map((r) => `<detalleAir>
          <codRetAir>${xmlEscape(r.code)}</codRetAir>
          <baseImpAir>${money(r.baseCents)}</baseImpAir>
          <porcentajeAir>${Number(r.rate).toFixed(2)}</porcentajeAir>
          <valRetAir>${money(r.amountCents)}</valRetAir>
        </detalleAir>`).join('\n        ')}
      </air>` : ''}
      <formasDePago>
        <formaPago>${xmlEscape(p.sriPayCode || '20')}</formaPago>
      </formasDePago>
    </detalleCompras>`;
  }).join('\n');

  const ventasXml = [...groups.values()].map((g) => `    <detalleVentas>
      <tpIdCliente>${g.tp}</tpIdCliente>
      <idCliente>${xmlEscape(g.id)}</idCliente>
      <parteRelVtas>${g.parte}</parteRelVtas>
      <tipoComprobante>${g.tipo}</tipoComprobante>
      <tipoEmision>F</tipoEmision>
      <numeroComprobantes>${g.count}</numeroComprobantes>
      <baseNoGraIva>0.00</baseNoGraIva>
      <baseImponible>${money(g.base0)}</baseImponible>
      <baseImpGrav>${money(g.base15)}</baseImpGrav>
      <montoIva>${money(g.iva)}</montoIva>
      <montoIce>${money(g.ice)}</montoIce>
      <valorRetIva>0.00</valorRetIva>
      <valorRetRenta>0.00</valorRetRenta>
      <formasDePago>
        <formaPago>${xmlEscape(g.forma)}</formaPago>
      </formasDePago>
    </detalleVentas>`).join('\n');

  const estXml = [...estMap.entries()].map(([est, cents]) => `    <ventaEst>
      <codEstab>${xmlEscape(est)}</codEstab>
      <ventasEstab>${money(cents)}</ventasEstab>
      <ivaComp>0.00</ivaComp>
    </ventaEst>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<iva>
  <TipoIDInformante>R</TipoIDInformante>
  <IdInformante>${xmlEscape(company.ruc)}</IdInformante>
  <razonSocial>${xmlEscape(company.name)}</razonSocial>
  <Anio>${xmlEscape(year)}</Anio>
  <Mes>${String(month).padStart(2, '0')}</Mes>
  <numEstabRuc>${xmlEscape(company.establecimiento || '001')}</numEstabRuc>
  <totalVentas>${money(totalVentas)}</totalVentas>
  <codigoOperativo>IVA</codigoOperativo>
  <compras>
${comprasXml}
  </compras>
  <ventas>
${ventasXml}
  </ventas>
  <ventasEstablecimiento>
${estXml}
  </ventasEstablecimiento>
</iva>
`;
}

module.exports = { buildAtsXml, xmlEscape, money, dmy };
