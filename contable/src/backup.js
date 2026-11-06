const { insert } = require('./db');
const { AppError } = require('./errors');
const { db } = require('./ctx');

const FORMAT = 'consultoria-sanchez-contable-v1';

async function rows(sql, params) {
  return db().all(sql, params);
}

async function backupCompany(companyId) {
  const company = await db().get('SELECT * FROM companies WHERE id = ?', [companyId]);
  if (!company) throw new AppError('Empresa no encontrada.', 404);
  const { id, ...companyData } = company;
  return {
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    company: companyData,
    accounts: await rows('SELECT * FROM accounts WHERE company_id = ? ORDER BY code', [companyId]),
    settings: await rows('SELECT * FROM settings WHERE company_id = ?', [companyId]),
    sequences: await rows('SELECT * FROM sequences WHERE company_id = ?', [companyId]),
    parties: await rows('SELECT * FROM parties WHERE company_id = ? ORDER BY id', [companyId]),
    products: await rows('SELECT * FROM products WHERE company_id = ? ORDER BY id', [companyId]),
    journalEntries: await rows('SELECT * FROM journal_entries WHERE company_id = ? ORDER BY id', [companyId]),
    journalLines: await rows(
      `SELECT l.* FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.company_id = ? ORDER BY l.id`,
      [companyId]
    ),
    documents: await rows('SELECT * FROM documents WHERE company_id = ? ORDER BY id', [companyId]),
    documentLines: await rows(
      `SELECT l.* FROM document_lines l JOIN documents d ON d.id = l.document_id WHERE d.company_id = ? ORDER BY l.id`,
      [companyId]
    ),
    retentionLines: await rows(
      `SELECT l.* FROM retention_lines l JOIN documents d ON d.id = l.document_id WHERE d.company_id = ? ORDER BY l.id`,
      [companyId]
    ),
    openItems: await rows('SELECT * FROM open_items WHERE company_id = ? ORDER BY id', [companyId]),
    settlements: await rows('SELECT * FROM settlements WHERE company_id = ? ORDER BY id', [companyId]),
    settlementLines: await rows(
      `SELECT l.* FROM settlement_lines l JOIN settlements s ON s.id = l.settlement_id WHERE s.company_id = ? ORDER BY l.id`,
      [companyId]
    ),
    bankAccounts: await rows('SELECT * FROM bank_accounts WHERE company_id = ? ORDER BY id', [companyId]),
    bankMovements: await rows('SELECT * FROM bank_movements WHERE company_id = ? ORDER BY id', [companyId]),
    warehouseDocs: await rows('SELECT * FROM warehouse_docs WHERE company_id = ? ORDER BY id', [companyId]),
    inventoryMoves: await rows('SELECT * FROM inventory_moves WHERE company_id = ? ORDER BY id', [companyId]),
    payrollRuns: await rows('SELECT * FROM payroll_runs WHERE company_id = ? ORDER BY id', [companyId]),
    payrollLines: await rows(
      `SELECT l.* FROM payroll_lines l JOIN payroll_runs r ON r.id = l.run_id WHERE r.company_id = ? ORDER BY l.id`,
      [companyId]
    ),
    yearCloses: await rows('SELECT * FROM year_closes WHERE company_id = ?', [companyId]),
  };
}

function omitId(row) {
  const copy = { ...row };
  delete copy.id;
  return copy;
}

async function restoreCompany(companyId, payload) {
  if (!payload || payload.format !== FORMAT) throw new AppError('El archivo de respaldo no tiene el formato esperado.');
  if (!payload.company) throw new AppError('El respaldo no incluye la ficha de la empresa.');
  return db().tx(async () => {
    const current = await db().get('SELECT id FROM companies WHERE id = ?', [companyId]);
    if (!current) throw new AppError('Empresa no encontrada.', 404);
    await db().run(`DELETE FROM payroll_lines WHERE run_id IN (SELECT id FROM payroll_runs WHERE company_id = ?)`, [companyId]);
    await db().run('DELETE FROM payroll_runs WHERE company_id = ?', [companyId]);
    await db().run('DELETE FROM inventory_moves WHERE company_id = ?', [companyId]);
    await db().run('DELETE FROM warehouse_docs WHERE company_id = ?', [companyId]);
    await db().run('DELETE FROM bank_movements WHERE company_id = ?', [companyId]);
    await db().run(`DELETE FROM settlement_lines WHERE settlement_id IN (SELECT id FROM settlements WHERE company_id = ?)`, [companyId]);
    await db().run('DELETE FROM settlements WHERE company_id = ?', [companyId]);
    await db().run('DELETE FROM open_items WHERE company_id = ?', [companyId]);
    await db().run(`DELETE FROM retention_lines WHERE document_id IN (SELECT id FROM documents WHERE company_id = ?)`, [companyId]);
    await db().run(`DELETE FROM document_lines WHERE document_id IN (SELECT id FROM documents WHERE company_id = ?)`, [companyId]);
    await db().run('UPDATE documents SET related_document_id = NULL, journal_entry_id = NULL WHERE company_id = ?', [companyId]);
    await db().run('DELETE FROM documents WHERE company_id = ?', [companyId]);
    await db().run(`DELETE FROM journal_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE company_id = ?)`, [companyId]);
    await db().run('DELETE FROM journal_entries WHERE company_id = ?', [companyId]);
    await db().run('DELETE FROM year_closes WHERE company_id = ?', [companyId]);
    await db().run('DELETE FROM bank_accounts WHERE company_id = ?', [companyId]);
    await db().run('DELETE FROM products WHERE company_id = ?', [companyId]);
    await db().run('DELETE FROM parties WHERE company_id = ?', [companyId]);
    await db().run('DELETE FROM settings WHERE company_id = ?', [companyId]);
    await db().run('DELETE FROM sequences WHERE company_id = ?', [companyId]);
    await db().run('UPDATE accounts SET parent_id = NULL WHERE company_id = ?', [companyId]);
    await db().run('DELETE FROM accounts WHERE company_id = ?', [companyId]);

    const c = payload.company;
    await db().run(
      `UPDATE companies SET name=?, commercial_name=?, ruc=?, address=?, city=?, province=?, phone=?, email=?,
        obligado=?, regimen=?, agente_retencion=?, resolucion_agente=?, tipo_contribuyente=?, is_demo=?,
        establecimiento=?, punto_emision=?, ambiente_sri=? WHERE id=?`,
      [c.name, c.commercial_name, c.ruc, c.address, c.city, c.province, c.phone, c.email, c.obligado, c.regimen,
        c.agente_retencion, c.resolucion_agente, c.tipo_contribuyente, c.is_demo, c.establecimiento, c.punto_emision,
        c.ambiente_sri, companyId]
    );

    const accountMap = new Map();
    for (const row of payload.accounts || []) {
      const data = omitId(row);
      data.company_id = companyId;
      data.parent_id = null;
      const ins = await insert('accounts', data);
      accountMap.set(row.id, ins.lastId);
    }
    for (const row of payload.accounts || []) {
      if (row.parent_id) await db().run('UPDATE accounts SET parent_id = ? WHERE id = ?', [accountMap.get(row.parent_id), accountMap.get(row.id)]);
    }
    for (const row of payload.settings || []) {
      await db().run('INSERT INTO settings (company_id, skey, svalue) VALUES (?, ?, ?)', [companyId, row.skey, row.svalue]);
    }
    for (const row of payload.sequences || []) {
      await db().run('INSERT INTO sequences (company_id, doc_type, last_no) VALUES (?, ?, ?)', [companyId, row.doc_type, row.last_no]);
    }
    const partyMap = new Map();
    for (const row of payload.parties || []) {
      const ins = await insert('parties', { ...omitId(row), company_id: companyId });
      partyMap.set(row.id, ins.lastId);
    }
    const productMap = new Map();
    for (const row of payload.products || []) {
      const ins = await insert('products', { ...omitId(row), company_id: companyId });
      productMap.set(row.id, ins.lastId);
    }
    const entryMap = new Map();
    for (const row of payload.journalEntries || []) {
      const ins = await insert('journal_entries', { ...omitId(row), company_id: companyId, source_id: null, created_by: null });
      entryMap.set(row.id, ins.lastId);
    }
    for (const row of payload.journalLines || []) {
      await insert('journal_lines', {
        ...omitId(row),
        entry_id: entryMap.get(row.entry_id),
        account_id: accountMap.get(row.account_id),
        party_id: row.party_id ? partyMap.get(row.party_id) : null,
      });
    }
    const docMap = new Map();
    for (const row of payload.documents || []) {
      const ins = await insert('documents', {
        ...omitId(row),
        company_id: companyId,
        party_id: row.party_id ? partyMap.get(row.party_id) : null,
        related_document_id: null,
        journal_entry_id: row.journal_entry_id ? entryMap.get(row.journal_entry_id) : null,
        created_by: null,
      });
      docMap.set(row.id, ins.lastId);
    }
    for (const row of payload.documents || []) {
      if (row.related_document_id) {
        await db().run('UPDATE documents SET related_document_id = ? WHERE id = ?', [docMap.get(row.related_document_id), docMap.get(row.id)]);
      }
    }
    for (const row of payload.documentLines || []) {
      await insert('document_lines', {
        ...omitId(row),
        document_id: docMap.get(row.document_id),
        product_id: row.product_id ? productMap.get(row.product_id) : null,
      });
    }
    for (const row of payload.retentionLines || []) {
      await insert('retention_lines', { ...omitId(row), document_id: docMap.get(row.document_id) });
    }
    const itemMap = new Map();
    for (const row of payload.openItems || []) {
      const ins = await insert('open_items', {
        ...omitId(row),
        company_id: companyId,
        party_id: partyMap.get(row.party_id),
        document_id: row.document_id ? docMap.get(row.document_id) : null,
      });
      itemMap.set(row.id, ins.lastId);
    }
    const bankMap = new Map();
    for (const row of payload.bankAccounts || []) {
      const ins = await insert('bank_accounts', {
        ...omitId(row),
        company_id: companyId,
        ledger_account_id: accountMap.get(row.ledger_account_id),
      });
      bankMap.set(row.id, ins.lastId);
    }
    const settlementMap = new Map();
    for (const row of payload.settlements || []) {
      const ins = await insert('settlements', {
        ...omitId(row),
        company_id: companyId,
        party_id: row.party_id ? partyMap.get(row.party_id) : null,
        bank_account_id: row.bank_account_id ? bankMap.get(row.bank_account_id) : null,
        advance_item_id: row.advance_item_id ? itemMap.get(row.advance_item_id) : null,
        journal_entry_id: row.journal_entry_id ? entryMap.get(row.journal_entry_id) : null,
        created_by: null,
      });
      settlementMap.set(row.id, ins.lastId);
    }
    for (const row of payload.settlementLines || []) {
      await insert('settlement_lines', {
        settlement_id: settlementMap.get(row.settlement_id),
        target_item_id: itemMap.get(row.target_item_id),
        amount_cents: row.amount_cents,
      });
    }
    for (const row of payload.bankMovements || []) {
      await insert('bank_movements', {
        ...omitId(row),
        company_id: companyId,
        bank_account_id: bankMap.get(row.bank_account_id),
        counterpart_bank_id: row.counterpart_bank_id ? bankMap.get(row.counterpart_bank_id) : null,
        journal_entry_id: row.journal_entry_id ? entryMap.get(row.journal_entry_id) : null,
      });
    }
    const whMap = new Map();
    for (const row of payload.warehouseDocs || []) {
      const ins = await insert('warehouse_docs', {
        ...omitId(row),
        company_id: companyId,
        journal_entry_id: row.journal_entry_id ? entryMap.get(row.journal_entry_id) : null,
      });
      whMap.set(row.id, ins.lastId);
    }
    for (const row of payload.inventoryMoves || []) {
      await insert('inventory_moves', {
        ...omitId(row),
        company_id: companyId,
        product_id: productMap.get(row.product_id),
        document_id: row.document_id ? docMap.get(row.document_id) : null,
        warehouse_doc_id: row.warehouse_doc_id ? whMap.get(row.warehouse_doc_id) : null,
      });
    }
    const runMap = new Map();
    for (const row of payload.payrollRuns || []) {
      const ins = await insert('payroll_runs', {
        ...omitId(row),
        company_id: companyId,
        journal_entry_id: row.journal_entry_id ? entryMap.get(row.journal_entry_id) : null,
      });
      runMap.set(row.id, ins.lastId);
    }
    for (const row of payload.payrollLines || []) {
      await insert('payroll_lines', { ...omitId(row), run_id: runMap.get(row.run_id), employee_id: partyMap.get(row.employee_id) });
    }
    for (const row of payload.yearCloses || []) {
      await db().run(
        'INSERT INTO year_closes (company_id, year, entry_id, closed_at) VALUES (?, ?, ?, ?)',
        [companyId, row.year, row.entry_id ? entryMap.get(row.entry_id) : null, row.closed_at]
      );
    }
    return { ok: true, documents: docMap.size, accounts: accountMap.size };
  });
}

module.exports = { backupCompany, restoreCompany, FORMAT };
