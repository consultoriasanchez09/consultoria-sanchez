const path = require('path');
const ExcelJS = require('exceljs');
const { BUILT } = require('../src/plan');

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Consultoría Sánchez';
  const ws = wb.addWorksheet('Plan de cuentas');
  ws.addRow(['CODIGO', 'NOMBRE', 'NIVEL', 'ESAGRUPADOR']);
  ws.getRow(1).font = { bold: true, color: { argb: 'FF0E2A47' } };
  for (const row of BUILT) ws.addRow([row.code, row.name, row.level, row.agrupador ? 'True' : 'False']);
  ws.columns = [{ width: 22 }, { width: 78 }, { width: 10 }, { width: 16 }];
  const dest = path.join(__dirname, '..', 'docs', 'plan_cuentas_base.xlsx');
  await wb.xlsx.writeFile(dest);
  console.log(dest, BUILT.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
