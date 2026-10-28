const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

const ID_TABLES = new Set([
  'users', 'companies', 'accounts', 'parties', 'products', 'documents', 'document_lines',
  'retention_lines', 'journal_entries', 'journal_lines', 'open_items', 'settlements',
  'settlement_lines', 'bank_accounts', 'bank_movements', 'warehouse_docs', 'inventory_moves',
  'payroll_runs', 'payroll_lines',
]);

const als = new AsyncLocalStorage();
let api = null;

function isPostgresUrl(url) {
  return typeof url === 'string' && /^postgres(ql)?:\/\//i.test(url);
}

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function normalizeParams(params) {
  return params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
}

async function initDb() {
  if (api) return api;
  const url = process.env.DATABASE_URL || '';
  const usePg = process.env.NODE_ENV !== 'test' && isPostgresUrl(url);
  if (process.env.NODE_ENV === 'production' && !usePg) {
    throw new Error('En producción defina DATABASE_URL con PostgreSQL. El disco de Render es efímero y no conserva SQLite.');
  }

  if (usePg) {
    const { Pool, types } = require('pg');
    types.setTypeParser(20, (val) => (val == null ? null : Number(val)));
    types.setTypeParser(1700, (val) => (val == null ? null : Number(val)));
    const ssl = process.env.DATABASE_SSL === '1' ? { rejectUnauthorized: false } : false;
    const pool = new Pool({ connectionString: url, ssl, max: 8 });
    let queue = Promise.resolve();
    const enqueue = (fn) => {
      const job = queue.then(fn, fn);
      queue = job.then(() => {}, () => {});
      return job;
    };
    const direct = async (sql, params) => {
      const client = als.getStore() || pool;
      const text = toPg(sql);
      let q = sql;
      const wants = /^\s*insert\s+into\s+([a-z_]+)/i.exec(sql);
      if (wants && ID_TABLES.has(wants[1].toLowerCase()) && !/returning\s/i.test(sql)) q += ' RETURNING id';
      const res = await client.query(toPg(q), normalizeParams(params));
      return res;
    };
    async function all(sql, params = []) {
      const exec = async () => (await direct(sql, params)).rows;
      if (als.getStore()) return exec();
      return enqueue(exec);
    }
    async function get(sql, params = []) {
      const rows = await all(sql, params);
      return rows[0] || null;
    }
    async function run(sql, params = []) {
      const exec = async () => {
        const res = await direct(sql, params);
        return { lastId: res.rows[0]?.id ?? null, changes: res.rowCount, rows: res.rows };
      };
      if (als.getStore()) return exec();
      return enqueue(exec);
    }
    async function tx(fn) {
      if (als.getStore()) return fn();
      return enqueue(async () => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await als.run(client, fn);
          await client.query('COMMIT');
          return result;
        } catch (err) {
          try { await client.query('ROLLBACK'); } catch { /* ignore */ }
          throw err;
        } finally {
          client.release();
        }
      });
    }
    async function close() {
      await pool.end();
      api = null;
    }
    api = { dialect: 'pg', all, get, run, tx, close, exec: async (sql) => { await pool.query(sql); } };
    return api;
  }

  const { DatabaseSync } = require('node:sqlite');
  const sqlitePath = process.env.NODE_ENV === 'test'
    ? ':memory:'
    : (process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'contable.db'));
  if (sqlitePath !== ':memory:') fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  const sqlite = new DatabaseSync(sqlitePath);
  sqlite.exec('PRAGMA foreign_keys = ON');
  if (sqlitePath !== ':memory:') sqlite.exec('PRAGMA journal_mode = WAL');
  let queue = Promise.resolve();
  const enqueue = (fn) => {
    const job = queue.then(fn, fn);
    queue = job.then(() => {}, () => {});
    return job;
  };
  function directAll(sql, params) {
    return sqlite.prepare(sql).all(...normalizeParams(params));
  }
  function directRun(sql, params) {
    const info = sqlite.prepare(sql).run(...normalizeParams(params));
    return { lastId: Number(info.lastInsertRowid || 0), changes: Number(info.changes || 0), rows: [] };
  }
  async function all(sql, params = []) {
    if (als.getStore()) return directAll(sql, params);
    return enqueue(() => directAll(sql, params));
  }
  async function get(sql, params = []) {
    const rows = await all(sql, params);
    return rows[0] || null;
  }
  async function run(sql, params = []) {
    if (als.getStore()) return directRun(sql, params);
    return enqueue(() => directRun(sql, params));
  }
  async function tx(fn) {
    if (als.getStore()) return fn();
    return enqueue(async () => {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = await als.run({ inTx: true }, fn);
        sqlite.exec('COMMIT');
        return result;
      } catch (err) {
        try { sqlite.exec('ROLLBACK'); } catch { /* ignore */ }
        throw err;
      }
    });
  }
  function close() {
    sqlite.close();
    api = null;
  }
  api = { dialect: 'sqlite', all, get, run, tx, close, exec: async (sql) => { sqlite.exec(sql); } };
  return api;
}

function getDb() {
  if (!api) throw new Error('La base de datos no está inicializada.');
  return api;
}

async function insert(table, data) {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  return getDb().run(sql, keys.map((k) => data[k]));
}

module.exports = { initDb, getDb, insert, ID_TABLES };
