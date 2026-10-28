const path = require('path');
const express = require('express');
const session = require('express-session');
const { initDb } = require('./src/db');
const { ensureSchema } = require('./src/schema');
const { seedIfEmpty } = require('./src/seed');
const { buildRouter } = require('./src/routes');

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
    console.error('En producción defina DATABASE_URL (PostgreSQL). El disco de Render es efímero.');
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    console.error('En producción defina SESSION_SECRET.');
    process.exit(1);
  }
  const db = await initDb();
  await ensureSchema();
  await seedIfEmpty();
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '12mb' }));
  app.use(session({
    name: 'cs.contable',
    secret: process.env.SESSION_SECRET || 'dev-only-consultoria-sanchez',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 12 * 3600 * 1000,
    },
  }));
  app.use('/api', buildRouter());
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    const message = err.status ? err.message : (process.env.NODE_ENV === 'production' ? 'Error interno del servidor.' : err.message);
    res.status(status).json({ error: message });
  });
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    console.log(`Consultoría Sánchez · contable en http://localhost:${port} (${db.dialect})`);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
