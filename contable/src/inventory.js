function roundQty(q) {
  return Math.round(Number(q) * 10000) / 10000;
}

function snapshot(state) {
  return {
    stockQty: roundQty(state.stockQty || 0),
    stockValueCents: Math.round(state.stockValueCents || 0),
    avgCostCents: Math.round(state.avgCostCents || 0),
  };
}

function withAvg(state) {
  const stockQty = roundQty(state.stockQty);
  const stockValueCents = Math.round(state.stockValueCents);
  const avgCostCents = stockQty > 0 ? Math.round(stockValueCents / stockQty) : 0;
  return { stockQty, stockValueCents, avgCostCents };
}

function applyIn(state, qty, totalCostCents) {
  const q = Number(qty);
  const cost = Math.round(totalCostCents);
  if (!(q > 0)) throw new Error('La cantidad de ingreso debe ser mayor a cero.');
  if (cost < 0) throw new Error('El costo de ingreso no puede ser negativo.');
  return withAvg({
    stockQty: Number(state.stockQty || 0) + q,
    stockValueCents: Math.round(state.stockValueCents || 0) + cost,
  });
}

function applyOut(state, qty) {
  const q = Number(qty);
  if (!(q > 0)) throw new Error('La cantidad de salida debe ser mayor a cero.');
  const stockQty = Number(state.stockQty || 0);
  if (q - stockQty > 0.0001) {
    const err = new Error('Stock insuficiente.');
    err.status = 400;
    throw err;
  }
  const stockValue = Math.round(state.stockValueCents || 0);
  const cost = stockQty > 0 ? Math.round(stockValue * (q / stockQty)) : 0;
  const next = withAvg({ stockQty: stockQty - q, stockValueCents: stockValue - cost });
  return { ...next, costCents: cost };
}

module.exports = { roundQty, snapshot, applyIn, applyOut };
