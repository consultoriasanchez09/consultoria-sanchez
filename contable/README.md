# Consultoría Sánchez · Sistema contable

Prototipo web multiempresa para la consultora. Cada empresa cliente tiene sus propios maestros, documentos, libros, bancos, inventario y roles. La interfaz está en español y usa la marca de Consultoría Sánchez (azul marino, azul y dorado).

No incluye los módulos de Tesorería ni Transporte. La facturación electrónica del SRI (firma XAdES y envío) queda solo como pantalla preparada para una fase 2: este prototipo no firma ni transmite comprobantes.

## Requisitos

- Node.js 22
- PostgreSQL cuando se publique (variable `DATABASE_URL`)
- En la computadora de desarrollo, si no hay `DATABASE_URL`, usa SQLite con el módulo incluido en Node (`node:sqlite`)

## Ejecutar en local

```bash
cd contable
npm install
npm start
```

Abra http://localhost:3001

La base local se crea en `contable/data/contable.db` la primera vez, con dos empresas marcadas **DEMO** y tres usuarios.

| Rol | Usuario | Clave |
|---|---|---|
| Administrador | `admin` | `Consultora2026!` |
| Auxiliar | `auxiliar` | `Auxiliar2026!` |
| Consulta | `consulta` | `Consulta2026!` |

Cambie esas claves en **Cambiar mi clave** antes de cargar empresas reales. La clave inicial del administrador también puede definirse con `ADMIN_PASSWORD` la primera vez que la base está vacía.

### Qué probar

1. Entre como `admin` y deje seleccionada **DEMO · Comercial Andina Cía. Ltda.**
2. En **Inicio** revise ventas, cartera vencida y punto de equilibrio.
3. En **Ventas → Facturas de venta** abra un comprobante: detalle, IVA 15% y 0%, pestañas Contabilidad, Forma de pago y Cheque.
4. En **Contabilidad → Situación financiera** confirme que el activo iguala al pasivo más el patrimonio. Puede exportar PDF o Excel.
5. Cambie a **DEMO · Servicios del Pacífico S.A.** y compruebe que los saldos son otros.
6. Cree una factura nueva (cliente, productos, Grabar) y vuelva a abrir el estado de situación.

Pruebas automáticas de la partida doble, el IVA, el kardex y el rol:

```bash
npm test
```

## Despliegue en Render como servicio aparte

El sitio público de la consultora y este sistema son dos servicios. No hace falta mezclarlos. El plan gratuito de Render **no conserva el disco**: no use SQLite en producción. La base tiene que ser PostgreSQL, indicada en `DATABASE_URL`.

1. Cree una base PostgreSQL (Render PostgreSQL, Neon o Supabase) y copie la cadena de conexión.
2. En Render: **New → Web Service**, el mismo repositorio.
3. **Root Directory:** `contable`
4. **Build command:** `npm install`
5. **Start command:** `npm start`
6. Variables de entorno:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | cadena `postgres://…` o `postgresql://…` |
| `SESSION_SECRET` | una clave larga y aleatoria |
| `NODE_ENV` | `production` |
| `DATABASE_SSL` | `1` si el proveedor exige SSL (típico en Neon y en la URL externa de Render). `0` en la red interna sin SSL |
| `ADMIN_PASSWORD` | clave del usuario `admin` (solo se usa si la base aún no tiene usuarios) |

7. El servicio escucha el `PORT` que Render asigna. Una ruta útil de comprobación es `/api/health`.

Al arrancar en producción sin `DATABASE_URL` o sin `SESSION_SECRET`, el proceso se detiene a propósito. Las sesiones viven en memoria: al reiniciar el servicio hay que volver a entrar. Los datos contables permanecen en PostgreSQL.

## Alcance del prototipo

- Multiempresa, usuarios y roles (administrador, contador, auxiliar, consulta).
- Plan de cuentas tipo Superintendencia de Compañías / NIIF para PYMES, precargado y editable. Los asientos automáticos usan cuentas configurables.
- Clientes, proveedores, beneficiarios y empleados. Cédula y RUC validan el dígito verificador ecuatoriano.
- Productos y servicios con IVA 15% o 0%, ICE ad valorem simplificado, unidad e indicador de inventariable.
- Factura de venta, nota de venta, cotización, factura de compra, liquidación de compra, notas de crédito y débito, y comprobante de retención. Cada documento emitido (salvo la cotización) genera su asiento. El costo de venta sale del kardex a costo promedio.
- Cobros, pagos, anticipos, cruce de anticipo contra deuda y cobro o pago a varios, con aplicación secuencial.
- Estado de cuenta, cartera (por vencer, 0-30, 31-60, 61-90, 91-120, 121-150 y más de 150) y deudas a una fecha de corte.
- Cuentas bancarias, depósitos, retiros, cheques, notas de débito y crédito, transferencias, conciliación y cheques posfechados.
- Kardex a costo promedio, ingresos, egresos y transferencias de bodega, importación de facturas de compra desde Excel e informes de compras, ventas y existencias.
- Diario, asiento manual (solo si cuadra), mayor, asientos descuadrados, cierre de ejercicio, balance de comprobación con y sin saldos, estado de situación financiera, estado de resultados y cruces de contabilidad contra cuentas por cobrar, por pagar, anticipos, inventario y bancos.
- Apoyo al formulario 104 (IVA), al 103 (retenciones por código) y generación del ATS en XML. Son resúmenes de trabajo: hay que revisarlos antes de declararlos.
- Rol de pagos con IESS personal 9,45%, aporte patronal 11,15%, décimo tercero, décimo cuarto (sobre el sueldo básico configurable, 470 USD por defecto), fondos de reserva 8,33%, horas extra, bonificaciones y deducciones.
- Respaldo y restauración JSON por empresa. Exportación PDF y Excel de los informes principales.

Los porcentajes de retención y el sueldo básico son parámetros de partida. Actualícelos en **Contabilidad → Cuentas de enlace** cuando cambie la norma.

## Estructura

```
contable/
  server.js          arranque
  src/               base, asientos, nómina, ATS, informes
  public/            interfaz
  test/              pruebas de la lógica contable
```
