require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const sharp = require('sharp');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DB_NAME = process.env.DB_NAME || 'agui_store';
const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const requireGoogle = String(process.env.REQUIRE_GOOGLE_LOGIN || 'false').toLowerCase() === 'true';

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || process.env.SESSION_SECRET.includes('CAMBIA_')) {
  console.error('Configura SESSION_SECRET en .env con al menos 32 caracteres aleatorios.');
  process.exit(1);
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  decimalNumbers: true
});

const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: DB_NAME,
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: 8 * 60 * 60 * 1000,
  createDatabaseTable: true,
  schema: { tableName: 'sessions', columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' } }
});

app.disable('x-powered-by');
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'"], fontSrc: ["'self'"],
    manifestSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"]
  } }, crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(session({
  name: 'agui.sid', secret: process.env.SESSION_SECRET, store: sessionStore,
  resave: false, saveUninitialized: false, rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use((req, _res, next) => {
  if (!req.user) return next();
  const now = Date.now();
  if (req.session.customerLastAction && now - req.session.customerLastAction > 10 * 60 * 1000) {
    return req.logout(err => { if (err) return next(err); req.session.customerLastAction = null; next(); });
  }
  req.session.customerLastAction = now;
  next();
});

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const [rows] = await pool.execute('SELECT id, email, full_name, phone FROM customers WHERE id = ?', [id]);
    done(null, rows[0] || false);
  } catch (e) { done(e); }
});
if (googleConfigured) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || `${BASE_URL}/auth/google/callback`
  }, async (_accessToken, _refreshToken, profile, done) => {
    try {
      const emailEntry = (profile.emails || []).find(e => e.value);
      if (!emailEntry || !profile._json || profile._json.email_verified !== true) return done(null, false, { message: 'Google debe confirmar que el correo pertenece al cliente.' });
      const email = emailEntry.value.toLowerCase();
      const fullName = profile.displayName || email.split('@')[0];
      await pool.execute(
        `INSERT INTO customers (google_id, email, full_name) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE google_id = VALUES(google_id), full_name = VALUES(full_name)`,
        [profile.id, email, fullName]
      );
      const [rows] = await pool.execute('SELECT id, email, full_name, phone FROM customers WHERE email = ?', [email]);
      done(null, rows[0]);
    } catch (e) { done(e); }
  }));
}

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' } });
const orderLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Se recibieron muchas solicitudes. Espera antes de intentar de nuevo.' } });

function cleanText(value, max = 255) {
  return String(value ?? '').trim().slice(0, max);
}
function slugify(value) {
  return cleanText(value, 160).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `producto-${Date.now()}`;
}
function money(v) { return Number(Number(v || 0).toFixed(2)); }
function whatsappUrl(message, targetNumber) {
  const digits = String(targetNumber ?? process.env.BUSINESS_WHATSAPP ?? '').replace(/\D/g, '');
  const base = digits ? `https://wa.me/${digits}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(message)}`;
}
function requireAdmin(req, res, next) {
  if (!req.session.adminId) return res.status(401).json({ error: 'Inicia sesión como dueño para continuar.' });
  const now = Date.now();
  if (req.session.adminLastAction && now - req.session.adminLastAction > 10 * 60 * 1000) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'La sesión del administrador venció por inactividad. Inicia sesión de nuevo.' });
  }
  req.session.adminLastAction = now;
  next();
}
function requireCustomer(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Debes iniciar sesión o crear una cuenta de cliente antes de realizar el pedido.' });
  next();
}
function productPayload(body) {
  const name = cleanText(body.name, 160);
  const category = cleanText(body.category, 80) || 'Otros';
  const price = Number(body.price);
  const description = cleanText(body.description, 3000);
  const imageUrl = cleanText(body.image_url, 500);
  if (!name) throw new Error('Escribe el nombre del producto.');
  if (!Number.isFinite(price) || price < 0 || price > 100000000) throw new Error('El precio no es válido.');
  if (imageUrl && !imageUrl.startsWith('/assets/') && !imageUrl.startsWith('/uploads/')) throw new Error('La imagen debe ser un archivo local subido a AGUI.');
  return { name, slug: slugify(body.slug || name), category, description, price: money(price), imageUrl, active: body.active === false || body.active === 0 || body.active === '0' ? 0 : 1, featured: body.featured === true || body.featured === 1 || body.featured === '1' ? 1 : 0, stock: body.stock === '' || body.stock == null ? null : Math.max(0, Math.floor(Number(body.stock))) };
}

// Health endpoint for local checks and hosting platforms.
app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, service: 'AGUI', database: 'connected' }); }
  catch (_e) { res.status(503).json({ ok: false, service: 'AGUI', database: 'disconnected' }); }
});

app.get('/api/config', async (_req, res, next) => {
  try {
    const [settingRows] = await pool.query('SELECT setting_key, setting_value FROM settings');
    const settings = Object.fromEntries(settingRows.map(r => [r.setting_key, r.setting_value]));
    const [zones] = await pool.query('SELECT id, name, shipping_fee, eta FROM delivery_zones WHERE active = 1 ORDER BY name');
    const payments = [
      { id: 'contraentrega', label: 'Pago contra entrega', enabled: true },
      { id: 'transferencia', label: 'Transferencia bancaria', enabled: true },
      { id: 'wompi', label: 'Wompi · integración pendiente', enabled: false },
      { id: 'mercadopago', label: 'Mercado Pago · integración pendiente', enabled: false },
      { id: 'epayco', label: 'ePayco · integración pendiente', enabled: false }
    ];
    res.json({
      businessName: settings.business_name || 'AGUI Repostería y Arepas',
      tagline: settings.tagline || 'El mejor sabor, en cada bocado.',
      address: settings.business_address || 'Vegachí, Antioquia, Colombia',
      phone: settings.business_phone || '', whatsapp: settings.business_whatsapp || '', email: settings.business_email || '',
      orderNotice: settings.order_notice || '', zones,
      payments, googleLoginConfigured: googleConfigured, requireGoogleLogin: requireGoogle,
      adminEmail: process.env.ADMIN_EMAIL || 'guillermo171026@gmail.com'
    });
  } catch (e) { next(e); }
});

app.get('/api/products', async (req, res, next) => {
  try {
    const where = ['active = 1']; const params = [];
    if (req.query.category && req.query.category !== 'Todos') { where.push('category = ?'); params.push(cleanText(req.query.category, 80)); }
    if (req.query.q) { where.push('(name LIKE ? OR description LIKE ?)'); const q = `%${cleanText(req.query.q, 80)}%`; params.push(q, q); }
    const [rows] = await pool.execute(`SELECT id, name, slug, category, description, price, image_url, featured, stock FROM products WHERE ${where.join(' AND ')} ORDER BY featured DESC, name ASC`, params);
    res.json(rows);
  } catch (e) { next(e); }
});
app.get('/api/categories', async (_req, res, next) => {
  try { const [rows] = await pool.query('SELECT DISTINCT category FROM products WHERE active = 1 ORDER BY category'); res.json(['Todos', ...rows.map(r => r.category)]); }
  catch (e) { next(e); }
});
app.get('/api/me', (req, res) => res.json({ customer: req.user || null, admin: req.session.adminId ? { id: req.session.adminId, email: req.session.adminEmail } : null, googleLoginConfigured: googleConfigured, requireGoogleLogin: requireGoogle }));

app.get('/auth/google', (req, res, next) => {
  if (!googleConfigured) return res.redirect('/?notice=google_config');
  passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' })(req, res, next);
});
app.get('/auth/google/callback', (req, res, next) => {
  if (!googleConfigured) return res.redirect('/?notice=google_config');
  passport.authenticate('google', { failureRedirect: '/?notice=google_failed' }, (err, user) => {
    if (err || !user) return res.redirect('/?notice=google_failed');
    req.logIn(user, loginErr => {
      if (loginErr) return next(loginErr);
      req.session.customerLastAction = Date.now();
      res.redirect('/?login=ok');
    });
  })(req, res, next);
});
app.post('/api/auth/logout', (req, res) => req.logout(err => {
  if (err) return res.status(500).json({ error: 'No se pudo cerrar sesión.' });
  req.session.adminId = null; req.session.adminEmail = null;
  req.session.save(() => res.json({ ok: true }));
}));

function finishCustomerLogin(req, res, next, customer) {
  // Passport regenera la sesión en req.logIn; no la regeneramos dos veces,
  // para evitar una carrera con el almacenamiento de sesiones.
  req.logIn(customer, loginErr => {
    if (loginErr) return next(loginErr);
    req.session.customerLastAction = Date.now();
    req.session.save(saveErr => {
      if (saveErr) return next(saveErr);
      res.json({ ok: true, customer: { id: customer.id, email: customer.email, full_name: customer.full_name, phone: customer.phone || null } });
    });
  });
}

app.post('/api/auth/customer/register', loginLimiter, async (req, res, next) => {
  try {
    const fullName = cleanText(req.body.full_name, 160);
    const email = cleanText(req.body.email, 254).toLowerCase();
    const password = String(req.body.password || '');
    if (fullName.length < 2) return res.status(400).json({ error: 'Escribe tu nombre completo.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Escribe un correo electrónico válido.' });
    if (password.length < 8 || password.length > 72) return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 72 caracteres.' });
    const [existing] = await pool.execute('SELECT id, password_hash FROM customers WHERE email = ? LIMIT 1', [email]);
    if (existing.length) return res.status(409).json({ error: existing[0].password_hash ? 'Ya existe una cuenta con ese correo. Inicia sesión.' : 'Ese correo ya está asociado a una cuenta de Google. Inicia sesión con Google.' });
    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute('INSERT INTO customers (email, full_name, password_hash) VALUES (?, ?, ?)', [email, fullName, passwordHash]);
    const customer = { id: result.insertId, email, full_name: fullName, phone: null };
    finishCustomerLogin(req, res, next, customer);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe una cuenta con ese correo. Inicia sesión.' });
    next(e);
  }
});

app.post('/api/auth/customer/login', loginLimiter, async (req, res, next) => {
  try {
    const email = cleanText(req.body.email, 254).toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Escribe tu correo y contraseña.' });
    const [rows] = await pool.execute('SELECT id, email, full_name, phone, password_hash FROM customers WHERE email = ? LIMIT 1', [email]);
    const customer = rows[0];
    const matched = customer && customer.password_hash && await bcrypt.compare(password, customer.password_hash);
    if (!matched) return res.status(401).json({ error: 'Correo o contraseña incorrectos. Si creaste la cuenta con Google, entra con Google.' });
    finishCustomerLogin(req, res, next, customer);
  } catch (e) { next(e); }
});

app.post('/api/auth/customer/logout', (req, res) => {
  if (!req.user) return res.json({ ok: true });
  req.logout(err => {
    if (err) return res.status(500).json({ error: 'No se pudo cerrar la sesión de cliente.' });
    req.session.customerLastAction = null;
    req.session.save(saveErr => saveErr ? res.status(500).json({ error: 'No se pudo cerrar la sesión.' }) : res.json({ ok: true }));
  });
});

app.post('/api/auth/admin/login', loginLimiter, async (req, res, next) => {
  try {
    const email = cleanText(req.body.email, 254).toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Escribe el correo y la contraseña.' });
    const [rows] = await pool.execute('SELECT id, email, full_name, password_hash, active FROM admins WHERE email = ? LIMIT 1', [email]);
    const admin = rows[0];
    const matched = admin && admin.active && await bcrypt.compare(password, admin.password_hash);
    if (!matched) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.adminId = admin.id;
      req.session.adminEmail = admin.email;
      req.session.adminLastAction = Date.now();
      req.session.save(saveErr => {
        if (saveErr) return next(saveErr);
        res.json({ ok: true, admin: { id: admin.id, email: admin.email, name: admin.full_name } });
      });
    });
  } catch (e) { next(e); }
});
app.post('/api/auth/admin/logout', requireAdmin, (req, res) => {
  req.session.adminId = null; req.session.adminEmail = null; req.session.adminLastAction = null;
  req.session.save(err => err ? res.status(500).json({ error: 'No se pudo cerrar sesión.' }) : res.json({ ok: true }));
});

app.get('/api/admin/dashboard', requireAdmin, async (_req, res, next) => {
  try {
    const [[products]] = await pool.query('SELECT COUNT(*) AS total, SUM(active = 1) AS active FROM products');
    const [[orders]] = await pool.query("SELECT COUNT(*) AS total, SUM(status = 'pending') AS pending FROM orders");
    const [[sales]] = await pool.query("SELECT COALESCE(SUM(total),0) AS total FROM orders WHERE status NOT IN ('cancelled') AND DATE(created_at) = CURDATE()");
    res.json({ products: Number(products.total || 0), activeProducts: Number(products.active || 0), orders: Number(orders.total || 0), pendingOrders: Number(orders.pending || 0), salesToday: Number(sales.total || 0) });
  } catch (e) { next(e); }
});
app.get('/api/admin/products', requireAdmin, async (_req, res, next) => {
  try { const [rows] = await pool.query('SELECT * FROM products ORDER BY created_at DESC'); res.json(rows); }
  catch (e) { next(e); }
});
app.post('/api/admin/products', requireAdmin, async (req, res, next) => {
  try {
    const p = productPayload(req.body);
    const [existing] = await pool.execute('SELECT id FROM products WHERE slug = ?', [p.slug]);
    if (existing.length) p.slug = `${p.slug}-${crypto.randomBytes(3).toString('hex')}`;
    const [result] = await pool.execute('INSERT INTO products (name, slug, category, description, price, image_url, active, featured, stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [p.name,p.slug,p.category,p.description,p.price,p.imageUrl,p.active,p.featured,p.stock]);
    const [rows] = await pool.execute('SELECT * FROM products WHERE id = ?', [result.insertId]); res.status(201).json(rows[0]);
  } catch (e) { if (e.message && !e.code) return res.status(400).json({ error: e.message }); next(e); }
});
app.put('/api/admin/products/:id', requireAdmin, async (req, res, next) => {
  try {
    const p = productPayload(req.body); const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID no válido.' });
    const [dupe] = await pool.execute('SELECT id FROM products WHERE slug = ? AND id <> ?', [p.slug, id]);
    if (dupe.length) p.slug = `${p.slug}-${crypto.randomBytes(3).toString('hex')}`;
    const [result] = await pool.execute('UPDATE products SET name=?, slug=?, category=?, description=?, price=?, image_url=?, active=?, featured=?, stock=? WHERE id=?', [p.name,p.slug,p.category,p.description,p.price,p.imageUrl,p.active,p.featured,p.stock,id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Producto no encontrado.' });
    const [rows] = await pool.execute('SELECT * FROM products WHERE id = ?', [id]); res.json(rows[0]);
  } catch (e) { if (e.message && !e.code) return res.status(400).json({ error: e.message }); next(e); }
});
app.patch('/api/admin/products/:id/visibility', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID de producto no válido.' });
    const active = req.body.active === true || req.body.active === 1 || req.body.active === '1' ? 1 : 0;
    const [result] = await pool.execute('UPDATE products SET active = ? WHERE id = ?', [active, id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Producto no encontrado.' });
    res.json({ ok: true, active: Boolean(active) });
  } catch (e) { next(e); }
});
app.delete('/api/admin/products/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID de producto no válido.' });
    const [rows] = await pool.execute('SELECT id, image_url FROM products WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Producto no encontrado.' });
    const imageUrl = rows[0].image_url;
    await pool.execute('DELETE FROM products WHERE id = ?', [id]);
    if (imageUrl && imageUrl.startsWith('/uploads/')) {
      const imagePath = path.join(uploadDir, path.basename(imageUrl));
      const [usage] = await pool.execute('SELECT COUNT(*) AS uses_count FROM products WHERE image_url = ?', [imageUrl]);
      if (Number(usage[0].uses_count) === 0) fs.unlink(imagePath, () => {});
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

const uploadDir = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const allowedImageTypes = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${allowedImageTypes[file.mimetype] || '.bin'}`)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'] };
  if (!allowedExtensions[file.mimetype] || !allowedExtensions[file.mimetype].includes(ext)) return cb(new Error('Solo se permiten imágenes JPG, PNG o WebP con extensión compatible.'));
  cb(null, true);
} });
app.post('/api/admin/upload', requireAdmin, upload.single('image'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'Selecciona una imagen.' });
  const sourcePath = req.file.path;
  const webpName = `${path.parse(req.file.filename).name}.webp`;
  const outputPath = path.join(uploadDir, webpName);
  try {
    await sharp(sourcePath).rotate()
      .resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 }).toFile(outputPath);
    fs.unlink(sourcePath, () => {});
    res.status(201).json({ image_url: `/uploads/${webpName}` });
  } catch (e) {
    fs.unlink(sourcePath, () => {});
    next(e);
  }
});

app.get('/api/admin/orders', requireAdmin, async (req, res, next) => {
  try {
    const status = cleanText(req.query.status, 30);
    let rows;
    if (status && ['pending','confirmed','preparing','ready','delivered','cancelled'].includes(status)) {
      [rows] = await pool.execute('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT 200', [status]);
    } else { [rows] = await pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200'); }
    for (const order of rows) {
      const [items] = await pool.execute('SELECT product_name, unit_price, quantity, line_total FROM order_items WHERE order_id = ?', [order.id]);
      order.items = items;
    }
    res.json(rows);
  } catch (e) { next(e); }
});
app.patch('/api/admin/orders/:id', requireAdmin, async (req, res, next) => {
  try {
    const status = cleanText(req.body.status, 30);
    if (!['pending','confirmed','preparing','ready','delivered','cancelled'].includes(status)) return res.status(400).json({ error: 'Estado de pedido no válido.' });
    const [result] = await pool.execute('UPDATE orders SET status=? WHERE id=?', [status, Number(req.params.id)]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Pedido no encontrado.' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
app.get('/api/admin/zones', requireAdmin, async (_req, res, next) => {
  try { const [rows] = await pool.query('SELECT * FROM delivery_zones ORDER BY name'); res.json(rows); }
  catch (e) { next(e); }
});
app.put('/api/admin/zones/:id', requireAdmin, async (req, res, next) => {
  try {
    const fee = req.body.shipping_fee === '' || req.body.shipping_fee == null ? null : Number(req.body.shipping_fee);
    const eta = cleanText(req.body.eta, 160) || 'Por confirmar con AGUI';
    if (fee !== null && (!Number.isFinite(fee) || fee < 0 || fee > 10000000)) return res.status(400).json({ error: 'Tarifa de envío inválida.' });
    const [result] = await pool.execute('UPDATE delivery_zones SET shipping_fee=?, eta=?, active=? WHERE id=?', [fee, eta, req.body.active === false ? 0 : 1, Number(req.params.id)]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Zona no encontrada.' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
app.get('/api/admin/settings', requireAdmin, async (_req, res, next) => {
  try { const [rows] = await pool.query('SELECT setting_key, setting_value FROM settings'); res.json(Object.fromEntries(rows.map(r => [r.setting_key, r.setting_value]))); }
  catch (e) { next(e); }
});
app.put('/api/admin/settings', requireAdmin, async (req, res, next) => {
  try {
    const allowed = ['business_name','tagline','business_address','business_phone','business_whatsapp','business_email','order_notice'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        const val = cleanText(req.body[key], key === 'order_notice' ? 1000 : 254);
        await pool.execute('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)', [key, val]);
      }
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/orders', orderLimiter, requireCustomer, async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const body = req.body || {};
    const customerName = cleanText((req.user && req.user.full_name) || body.customer_name, 160);
    const customerEmail = cleanText((req.user && req.user.email) || body.customer_email, 254).toLowerCase();
    const customerPhone = cleanText(body.customer_phone, 30);
    const zoneName = cleanText(body.delivery_zone, 100);
    const address = cleanText(body.delivery_address, 255);
    const deliveryNotes = cleanText(body.delivery_notes, 1000);
    const payment = cleanText(body.payment_method, 60);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!customerName || !customerPhone || !zoneName || !address) return res.status(400).json({ error: 'Completa nombre, teléfono, zona y dirección de entrega.' });
    if (!['contraentrega','transferencia'].includes(payment)) return res.status(400).json({ error: 'Ese medio de pago todavía no está activo en la tienda.' });
    if (!items.length || items.length > 25) return res.status(400).json({ error: 'El carrito no tiene productos válidos.' });
    await conn.beginTransaction();
    const [zoneRows] = await conn.execute('SELECT * FROM delivery_zones WHERE name = ? AND active = 1 FOR UPDATE', [zoneName]);
    if (!zoneRows.length) { await conn.rollback(); return res.status(400).json({ error: 'Selecciona una zona de entrega válida.' }); }
    const zone = zoneRows[0];
    const cleanItems = []; let subtotal = 0;
    for (const item of items) {
      const id = Number(item.id); const quantity = Number(item.quantity);
      if (!Number.isInteger(id) || id < 1 || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
        await conn.rollback(); return res.status(400).json({ error: 'Hay un producto o cantidad no válida en el carrito.' });
      }
      const [prows] = await conn.execute('SELECT id, name, price, active, stock FROM products WHERE id = ? FOR UPDATE', [id]);
      const p = prows[0];
      if (!p || !p.active) { await conn.rollback(); return res.status(400).json({ error: 'Uno de los productos ya no está disponible. Actualiza el catálogo.' }); }
      if (p.stock !== null && Number(p.stock) < quantity) { await conn.rollback(); return res.status(400).json({ error: `No hay unidades suficientes de ${p.name}.` }); }
      const lineTotal = money(Number(p.price) * quantity); subtotal += lineTotal;
      cleanItems.push({ id, name: p.name, price: Number(p.price), quantity, total: lineTotal, stock: p.stock });
    }
    subtotal = money(subtotal);
    const shipping = zone.shipping_fee === null ? null : Number(zone.shipping_fee);
    const total = shipping === null ? null : money(subtotal + shipping);
    const orderNumber = `AG-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const customerId = req.user ? req.user.id : null;
    if (customerId) await conn.execute('UPDATE customers SET phone = ? WHERE id = ?', [customerPhone, customerId]);
    const [orderResult] = await conn.execute(
      `INSERT INTO orders (order_number, customer_id, customer_name, customer_email, customer_phone, delivery_zone, delivery_address, delivery_notes, payment_method, subtotal, shipping_cost, total, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [orderNumber, customerId, customerName, customerEmail || null, customerPhone, zoneName, address, deliveryNotes, payment, subtotal, shipping, total]
    );
    for (const item of cleanItems) {
      await conn.execute('INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total) VALUES (?, ?, ?, ?, ?, ?)', [orderResult.insertId,item.id,item.name,item.price,item.quantity,item.total]);
      if (item.stock !== null) await conn.execute('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity,item.id]);
    }
    await conn.commit();
    const itemLines = cleanItems.map(i => `• ${i.name} x${i.quantity}: $${i.total.toLocaleString('es-CO')}`).join('\n');
    const message = `Hola, AGUI. Quiero confirmar el pedido ${orderNumber}.\n\n${itemLines}\n\nSubtotal: $${subtotal.toLocaleString('es-CO')}\nEnvío: ${shipping === null ? 'por confirmar' : `$${shipping.toLocaleString('es-CO')}`}\nTotal: ${total === null ? 'por confirmar con AGUI' : `$${total.toLocaleString('es-CO')}`}\n\nNombre: ${customerName}\nTeléfono: ${customerPhone}\nZona: ${zoneName}\nDirección: ${address}\nPago: ${payment === 'contraentrega' ? 'Contra entrega' : 'Transferencia bancaria'}${deliveryNotes ? `\nNotas: ${deliveryNotes}` : ''}`;
    const [waRows] = await conn.execute('SELECT setting_value FROM settings WHERE setting_key = ?', ['business_whatsapp']);
    const configuredWhatsApp = (waRows[0] && waRows[0].setting_value) || process.env.BUSINESS_WHATSAPP || '';
    res.status(201).json({ ok: true, order_number: orderNumber, subtotal, shipping_cost: shipping, total, whatsapp_url: whatsappUrl(message, configuredWhatsApp), notice: 'Pedido registrado como pendiente. AGUI debe confirmar disponibilidad y entrega por WhatsApp.' });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    next(e);
  } finally { conn.release(); }
});

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (filePath.includes(`${path.sep}assets${path.sep}`) || filePath.includes(`${path.sep}uploads${path.sep}`)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (/\.(css|js)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err && err.stack ? err.stack : err);
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'La imagen supera el límite de 5 MB.' : 'No se pudo cargar la imagen.' });
  if (err && err.message && err.message.includes('Solo se permiten imágenes')) return res.status(400).json({ error: err.message });
  res.status(500).json({ error: 'Ocurrió un error interno. Revisa la configuración del servidor.' });
});

async function start() {
  try {
    await pool.query('SELECT 1');
    // Migración automática: permite actualizar una base existente sin borrar datos.
    const [customerColumns] = await pool.execute("SHOW COLUMNS FROM customers LIKE 'password_hash'");
    if (!customerColumns.length) {
      await pool.query('ALTER TABLE customers ADD COLUMN password_hash VARCHAR(255) NULL AFTER full_name');
      console.log('Base actualizada: cuentas de cliente por correo habilitadas.');
    }
    const server = app.listen(PORT, () => console.log(`AGUI está disponible en ${BASE_URL} (puerto ${PORT}).`));
    const shutdown = () => server.close(async () => { await pool.end(); sessionStore.close(); process.exit(0); });
    process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  } catch (e) {
    console.error('No se pudo conectar a MySQL. Ejecuta primero npm run setup:db y revisa .env. Detalle:', e.message);
    process.exit(1);
  }
}
start();
