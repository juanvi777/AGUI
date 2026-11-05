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
const BUSINESS_DEFAULTS = Object.freeze({ address: 'Cra. 52 No. 56 A-54, Vegachí, Antioquia, Colombia', phone: '3122405580', whatsapp: '573122405580' });
const DB_NAME = process.env.DB_NAME || 'agui_store';
const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const requireGoogle = true; // Los clientes deben autenticarse con Google; los pedidos QR de mesa son la única excepción.

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
    const [rows] = await pool.execute('SELECT id, email, full_name, phone, google_id FROM customers WHERE id = ?', [id]);
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
      const [adminIdentity] = await pool.execute('SELECT id FROM admins WHERE email = ? AND active = 1 LIMIT 1', [email]);
      if (adminIdentity.length) return done(null, { id: null, email, full_name: fullName, google_id: profile.id, verified_google_identity: true });
      await pool.execute(
        `INSERT INTO customers (google_id, email, full_name, email_verified_at) VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE google_id = VALUES(google_id), full_name = VALUES(full_name), email_verified_at = COALESCE(email_verified_at, NOW())`,
        [profile.id, email, fullName]
      );
      const [rows] = await pool.execute('SELECT id, email, full_name, phone, google_id FROM customers WHERE email = ?', [email]);
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
  const digits = String(targetNumber ?? process.env.BUSINESS_WHATSAPP ?? BUSINESS_DEFAULTS.whatsapp).replace(/\D/g, '');
  const base = digits ? `https://wa.me/${digits}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(message)}`;
}
function requireAdmin(req, res, next) {
  if (!req.session.adminId) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
  if (req.session.adminMustChangePassword && !['/api/auth/admin/first-password-change','/api/auth/admin/logout'].includes(req.path)) return res.status(428).json({ error: 'Debes completar el cambio inicial de contraseña para administrar AGUI.' });
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
      address: (!settings.business_address || settings.business_address === 'Vegachí, Antioquia, Colombia') ? BUSINESS_DEFAULTS.address : settings.business_address,
      phone: settings.business_phone || BUSINESS_DEFAULTS.phone,
      whatsapp: settings.business_whatsapp || BUSINESS_DEFAULTS.whatsapp, email: settings.business_email || '',
      orderNotice: settings.order_notice || '', zones,
      payments, googleLoginConfigured: googleConfigured, requireGoogleLogin: requireGoogle
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
app.get('/api/me', async (req, res, next) => {
  try {
    let admin = null;
    if (req.session.adminId) {
      const [rows] = await pool.execute('SELECT id, email, password_change_available FROM admins WHERE id = ? AND active = 1 LIMIT 1', [req.session.adminId]);
      if (rows.length) {
        req.session.adminMustChangePassword = Number(rows[0].password_change_available) === 1;
        admin = { id: rows[0].id, email: rows[0].email, mustChangePassword: req.session.adminMustChangePassword };
      } else { req.session.adminId = null; req.session.adminEmail = null; }
    }
    res.json({ customer: req.user || null, admin, googleLoginConfigured: googleConfigured, requireGoogleLogin: requireGoogle });
  } catch (e) { next(e); }
});

app.get('/auth/google', (req, res, next) => {
  if (!googleConfigured) return res.redirect('/?notice=google_config');
  passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' })(req, res, next);
});
app.get('/auth/google/callback', (req, res, next) => {
  if (!googleConfigured) return res.redirect('/?notice=google_config');
  passport.authenticate('google', { failureRedirect: '/?notice=google_failed' }, async (err, user) => {
    if (err || !user) return res.redirect('/?notice=google_failed');
    try {
      // El correo verificado determina el rol; nunca existe un selector público de dueño.
      const [admins] = await pool.execute('SELECT id, email, password_change_available FROM admins WHERE email = ? AND active = 1 LIMIT 1', [String(user.email).toLowerCase()]);
      if (admins.length) {
        return req.session.regenerate(regErr => {
          if (regErr) return next(regErr);
          req.session.adminId = admins[0].id;
          req.session.adminEmail = admins[0].email;
          req.session.adminLastAction = Date.now();
          req.session.adminMustChangePassword = Number(admins[0].password_change_available) === 1;
          req.session.save(saveErr => saveErr ? next(saveErr) : res.redirect('/?login=admin'));
        });
      }
      req.logIn(user, loginErr => {
        if (loginErr) return next(loginErr);
        req.session.customerLastAction = Date.now();
        req.session.save(saveErr => saveErr ? next(saveErr) : res.redirect('/?login=ok'));
      });
    } catch (e) { next(e); }
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
  if (requireGoogle) return res.status(403).json({ error: 'Para crear una cuenta de cliente debes continuar con Google.' });
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
  if (requireGoogle) return res.status(403).json({ error: 'El acceso de clientes se realiza con Google. Usa el botón Continuar con Google.' });
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

app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
  try {
    const email = cleanText(req.body.email, 254).toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Escribe tu correo y contraseña.' });
    // Admin lookup first. The role is resolved server-side, never selected by the visitor.
    const [admins] = await pool.execute('SELECT id, email, full_name, password_hash, active, password_change_available FROM admins WHERE email = ? LIMIT 1', [email]);
    const admin = admins[0];
    if (admin) {
      const matched = admin.active && await bcrypt.compare(password, admin.password_hash);
      if (!matched) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
      return req.session.regenerate(err => {
        if (err) return next(err);
        req.session.adminId = admin.id;
        req.session.adminEmail = admin.email;
        req.session.adminLastAction = Date.now();
        req.session.adminMustChangePassword = Number(admin.password_change_available) === 1;
        req.session.save(saveErr => {
          if (saveErr) return next(saveErr);
          res.json({ ok: true, role: 'admin', mustChangePassword: req.session.adminMustChangePassword, admin: { id: admin.id, email: admin.email, name: admin.full_name } });
        });
      });
    }
    const [customers] = await pool.execute('SELECT id, email, full_name, phone, password_hash, google_id FROM customers WHERE email = ? LIMIT 1', [email]);
    const customer = customers[0];
    const matched = customer && customer.password_hash && await bcrypt.compare(password, customer.password_hash);
    if (!matched) return res.status(401).json({ error: 'Correo o contraseña incorrectos. Si creaste tu cuenta con Google, utiliza Continuar con Google.' });
    finishCustomerLogin(req, res, next, customer);
  } catch (e) { next(e); }
});

app.post('/api/auth/admin/first-password-change', requireAdmin, async (req, res, next) => {
  try {
    const password = String(req.body.password || '');
    const confirm = String(req.body.confirm || '');
    if (password.length < 12 || password.length > 72) return res.status(400).json({ error: 'La nueva contraseña debe tener entre 12 y 72 caracteres.' });
    if (password !== confirm) return res.status(400).json({ error: 'Las contraseñas no coinciden.' });
    const [rows] = await pool.execute('SELECT password_change_available FROM admins WHERE id = ? AND active = 1', [req.session.adminId]);
    if (!rows.length || Number(rows[0].password_change_available) !== 1) return res.status(403).json({ error: 'La oportunidad de cambio inicial ya fue utilizada.' });
    const hash = await bcrypt.hash(password, 12);
    await pool.execute('UPDATE admins SET password_hash = ?, password_change_available = 0 WHERE id = ?', [hash, req.session.adminId]);
    req.session.adminMustChangePassword = false;
    res.json({ ok: true, message: 'Contraseña inicial actualizada. Los próximos cambios requerirán recuperación verificada.' });
  } catch (e) { next(e); }
});

async function sendRecoveryEmail(to, link) {
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) return false;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject: 'Recupera tu acceso a AGUI', html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#38251b"><h2>Recuperación de contraseña · AGUI</h2><p>Solicitaste cambiar tu contraseña. El enlace es válido durante 30 minutos y solo se puede usar una vez.</p><p><a href="${link}" style="display:inline-block;padding:14px 22px;background:#a94e22;color:#fff;text-decoration:none;border-radius:8px">Crear nueva contraseña</a></p><p>Si no solicitaste este cambio, ignora este mensaje.</p></div>` })
  });
  return response.ok;
}
app.post('/api/auth/forgot-password', loginLimiter, async (req, res, next) => {
  try {
    const email = cleanText(req.body.email, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Escribe un correo válido.' });
    const [admins] = await pool.execute('SELECT id, email FROM admins WHERE email = ? AND active = 1 LIMIT 1', [email]);
    const [customers] = admins.length ? [[]] : await pool.execute('SELECT id, email FROM customers WHERE email = ? LIMIT 1', [email]);
    const record = admins[0] ? { ...admins[0], kind: 'admin' } : customers[0] ? { ...customers[0], kind: 'customer' } : null;
    if (record && process.env.RESEND_API_KEY && process.env.MAIL_FROM) {
      const raw = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
      await pool.execute('INSERT INTO password_reset_tokens (user_type, user_id, token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))', [record.kind, record.id, tokenHash]);
      const link = `${BASE_URL}/?reset=${raw}`;
      const sent = await sendRecoveryEmail(email, link);
      if (!sent) console.error('No se pudo enviar correo de recuperación a', email);
    }
    res.json({ ok: true, message: 'Si el correo está registrado y el servicio de correo está configurado, recibirás un enlace de recuperación.' });
  } catch (e) { next(e); }
});
app.post('/api/auth/reset-password', loginLimiter, async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const token = String(req.body.token || '');
    const password = String(req.body.password || '');
    const confirm = String(req.body.confirm || '');
    if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: 'El enlace de recuperación no es válido.' });
    if (password.length < 12 || password.length > 72) return res.status(400).json({ error: 'La contraseña debe tener entre 12 y 72 caracteres.' });
    if (password !== confirm) return res.status(400).json({ error: 'Las contraseñas no coinciden.' });
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT id, user_type, user_id FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1 FOR UPDATE', [tokenHash]);
    if (!rows.length) { await conn.rollback(); return res.status(400).json({ error: 'El enlace venció o ya fue utilizado. Solicita uno nuevo.' }); }
    const reset = rows[0]; const hash = await bcrypt.hash(password, 12);
    if (reset.user_type === 'admin') await conn.execute('UPDATE admins SET password_hash = ?, password_change_available = 0 WHERE id = ?', [hash, reset.user_id]);
    else await conn.execute('UPDATE customers SET password_hash = ? WHERE id = ?', [hash, reset.user_id]);
    await conn.execute('UPDATE password_reset_tokens SET used_at = NOW() WHERE user_type = ? AND user_id = ? AND used_at IS NULL', [reset.user_type, reset.user_id]);
    await conn.commit();
    res.json({ ok: true, message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
  } catch (e) { try { await conn.rollback(); } catch (_) {} next(e); }
  finally { conn.release(); }
});

app.post('/api/auth/admin/logout', requireAdmin, (req, res) => {
  req.session.adminId = null; req.session.adminEmail = null; req.session.adminLastAction = null;
  req.session.save(err => err ? res.status(500).json({ error: 'No se pudo cerrar sesión.' }) : res.json({ ok: true }));
});

app.get('/api/customer/profile', requireCustomer, async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT id, email, full_name, username, phone, email_verified_at FROM customers WHERE id = ? LIMIT 1', [req.user.id]);
    res.json(rows[0] || {});
  } catch (e) { next(e); }
});
app.patch('/api/customer/profile', requireCustomer, async (req, res, next) => {
  try {
    const fullName = cleanText(req.body.full_name, 160);
    const username = cleanText(req.body.username, 40).toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    const phone = cleanText(req.body.phone, 30);
    const newPassword = String(req.body.new_password || '');
    const confirmPassword = String(req.body.confirm_password || '');
    if (fullName.length < 2) return res.status(400).json({ error: 'Escribe tu nombre completo.' });
    if (username.length < 3) return res.status(400).json({ error: 'El usuario debe tener al menos 3 caracteres.' });
    if (newPassword && (newPassword.length < 12 || newPassword.length > 72)) return res.status(400).json({ error: 'La contraseña debe tener entre 12 y 72 caracteres.' });
    if (newPassword && newPassword !== confirmPassword) return res.status(400).json({ error: 'Las nuevas contraseñas no coinciden.' });
    const [dupe] = await pool.execute('SELECT id FROM customers WHERE username = ? AND id <> ? LIMIT 1', [username, req.user.id]);
    if (dupe.length) return res.status(409).json({ error: 'Ese nombre de usuario ya está ocupado.' });
    if (newPassword) { const hash = await bcrypt.hash(newPassword, 12); await pool.execute('UPDATE customers SET full_name = ?, username = ?, phone = ?, password_hash = ? WHERE id = ?', [fullName, username, phone || null, hash, req.user.id]); }
    else await pool.execute('UPDATE customers SET full_name = ?, username = ?, phone = ? WHERE id = ?', [fullName, username, phone || null, req.user.id]);
    const [rows] = await pool.execute('SELECT id, email, full_name, username, phone FROM customers WHERE id = ?', [req.user.id]);
    res.json(rows[0]);
  } catch (e) { next(e); }
});
app.get('/api/customer/addresses', requireCustomer, async (req, res, next) => {
  try { const [rows] = await pool.execute('SELECT id, label, recipient, phone, address, zone, notes, is_default FROM customer_addresses WHERE customer_id = ? ORDER BY is_default DESC, created_at DESC', [req.user.id]); res.json(rows); }
  catch (e) { next(e); }
});
app.post('/api/customer/addresses', requireCustomer, async (req, res, next) => {
  try {
    const label=cleanText(req.body.label,60), recipient=cleanText(req.body.recipient,160), phone=cleanText(req.body.phone,30), address=cleanText(req.body.address,255), zone=cleanText(req.body.zone,100), notes=cleanText(req.body.notes,1000);
    if (!label || !recipient || !phone || !address || !zone) return res.status(400).json({ error: 'Completa nombre de dirección, destinatario, teléfono, zona y dirección.' });
    const [zones] = await pool.execute('SELECT name FROM delivery_zones WHERE name = ? AND active = 1', [zone]);
    if (!zones.length) return res.status(400).json({ error: 'Selecciona una zona de entrega válida.' });
    const [count] = await pool.execute('SELECT COUNT(*) AS total FROM customer_addresses WHERE customer_id = ?', [req.user.id]);
    const isDefault = Number(count[0].total) === 0 || Boolean(req.body.is_default);
    if (isDefault) await pool.execute('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?', [req.user.id]);
    const [result] = await pool.execute('INSERT INTO customer_addresses (customer_id,label,recipient,phone,address,zone,notes,is_default) VALUES (?,?,?,?,?,?,?,?)', [req.user.id,label,recipient,phone,address,zone,notes,isDefault?1:0]);
    const [rows] = await pool.execute('SELECT id,label,recipient,phone,address,zone,notes,is_default FROM customer_addresses WHERE id = ?', [result.insertId]); res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});
app.delete('/api/customer/addresses/:id', requireCustomer, async (req, res, next) => {
  try { const [result] = await pool.execute('DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?', [Number(req.params.id), req.user.id]); if (!result.affectedRows) return res.status(404).json({ error: 'Dirección no encontrada.' }); res.json({ ok: true }); }
  catch (e) { next(e); }
});
app.patch('/api/customer/addresses/:id/default', requireCustomer, async (req, res, next) => {
  const conn=await pool.getConnection();
  try { await conn.beginTransaction(); const [rows]=await conn.execute('SELECT id FROM customer_addresses WHERE id=? AND customer_id=? FOR UPDATE',[Number(req.params.id),req.user.id]); if(!rows.length){await conn.rollback();return res.status(404).json({error:'Dirección no encontrada.'});} await conn.execute('UPDATE customer_addresses SET is_default=0 WHERE customer_id=?',[req.user.id]); await conn.execute('UPDATE customer_addresses SET is_default=1 WHERE id=?',[Number(req.params.id)]); await conn.commit(); res.json({ok:true}); }
  catch(e){try{await conn.rollback();}catch(_){} next(e);} finally{conn.release();}
});
app.get('/api/customer/orders', requireCustomer, async (req, res, next) => {
  try {
    const [orders] = await pool.execute('SELECT id,order_number,customer_name,delivery_zone,delivery_address,subtotal,shipping_cost,total,status,order_type,table_label,payment_method,tracking_token,created_at FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100', [req.user.id]);
    for (const order of orders) { const [items] = await pool.execute('SELECT product_name,unit_price,quantity,line_total FROM order_items WHERE order_id = ? ORDER BY id', [order.id]); order.items = items; }
    res.json(orders);
  } catch (e) { next(e); }
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
    if (!['pending','confirmed','preparing','ready','shipped','delivered','cancelled'].includes(status)) return res.status(400).json({ error: 'Estado de pedido no válido.' });
    const [result] = await pool.execute('UPDATE orders SET status=? WHERE id=?', [status, Number(req.params.id)]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Pedido no encontrado.' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
app.get('/api/admin/tables', requireAdmin, async (_req, res, next) => {
  try { const [rows] = await pool.query('SELECT id, label, public_token, active, created_at FROM dining_tables ORDER BY id'); res.json(rows); }
  catch (e) { next(e); }
});
app.get('/api/admin/tables/:id/qr.png', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID de mesa no válido.' });
    const [rows] = await pool.execute('SELECT label, public_token FROM dining_tables WHERE id = ? AND active = 1 LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Mesa no encontrada o inactiva.' });
    const target = `${BASE_URL}/?mesa=${encodeURIComponent(rows[0].public_token)}`;
    const qrApi = `https://api.qrserver.com/v1/create-qr-code/?size=520x520&format=png&margin=14&data=${encodeURIComponent(target)}`;
    const qrResponse = await fetch(qrApi, { headers: { 'Accept': 'image/png' } });
    if (!qrResponse.ok) return res.status(502).json({ error: 'No se pudo generar la imagen del QR. Intenta nuevamente.' });
    const bytes = Buffer.from(await qrResponse.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="AGUI-QR-MESA-${id}.png"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(bytes);
  } catch (e) { next(e); }
});

app.post('/api/admin/tables', requireAdmin, async (req, res, next) => {
  try {
    const label = cleanText(req.body.label, 80);
    if (!label) return res.status(400).json({ error: 'Escribe el nombre o número de la mesa.' });
    const token = crypto.randomBytes(24).toString('hex');
    const [result] = await pool.execute('INSERT INTO dining_tables (label, public_token, active) VALUES (?, ?, 1)', [label, token]);
    res.status(201).json({ id: result.insertId, label, public_token: token, active: 1 });
  } catch (e) { if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe una mesa con ese nombre.' }); next(e); }
});
app.patch('/api/admin/tables/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id); const label = cleanText(req.body.label, 80);
    if (!Number.isInteger(id) || id < 1 || !label) return res.status(400).json({ error: 'Mesa o nombre no válido.' });
    const active = req.body.active === false ? 0 : 1;
    const [result] = await pool.execute('UPDATE dining_tables SET label = ?, active = ? WHERE id = ?', [label, active, id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Mesa no encontrada.' });
    const [rows] = await pool.execute('SELECT id, label, active FROM dining_tables WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (e) { if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe una mesa con ese nombre.' }); next(e); }
});
app.delete('/api/admin/tables/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'ID de mesa no válido.' });
    // Conserva el número de mesa escrito en los pedidos históricos, pero invalida el QR retirado.
    const [result] = await pool.execute('DELETE FROM dining_tables WHERE id = ?', [id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Mesa no encontrada.' });
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

// Mesa QR: solo expone el nombre visible de una mesa activa, nunca datos del negocio.
app.get('/api/tables/:token', async (req, res, next) => {
  try {
    const token = cleanText(req.params.token, 64);
    if (!/^[a-f0-9]{48}$/.test(token)) return res.status(404).json({ error: 'Código de mesa no válido.' });
    const [rows] = await pool.execute('SELECT label FROM dining_tables WHERE public_token = ? AND active = 1 LIMIT 1', [token]);
    if (!rows.length) return res.status(404).json({ error: 'Esta mesa ya no está disponible. Pide ayuda al personal de AGUI.' });
    res.json({ label: rows[0].label });
  } catch (e) { next(e); }
});

// Seguimiento de solo lectura usando un token aleatorio de alta entropía entregado al crear el pedido.
app.get('/api/orders/track/:token', async (req, res, next) => {
  try {
    const token = cleanText(req.params.token, 64);
    if (!/^[a-f0-9]{48}$/.test(token)) return res.status(404).json({ error: 'No encontramos el seguimiento de este pedido.' });
    const [rows] = await pool.execute('SELECT order_number, status, order_type, table_label, updated_at FROM orders WHERE tracking_token = ? LIMIT 1', [token]);
    if (!rows.length) return res.status(404).json({ error: 'No encontramos el seguimiento de este pedido.' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

app.post('/api/orders', orderLimiter, async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const body = req.body || {};
    const orderType = cleanText(body.order_type || 'delivery', 20);
    if (!['delivery', 'table'].includes(orderType)) return res.status(400).json({ error: 'Tipo de pedido no válido.' });
    let table = null;
    if (orderType === 'table') {
      const tableToken = cleanText(body.table_token, 64);
      if (!/^[a-f0-9]{48}$/.test(tableToken)) return res.status(400).json({ error: 'Escanea nuevamente el código QR de tu mesa.' });
      const [tableRows] = await conn.execute('SELECT id, label FROM dining_tables WHERE public_token = ? AND active = 1 LIMIT 1', [tableToken]);
      if (!tableRows.length) return res.status(400).json({ error: 'Esta mesa ya no está disponible. Solicita ayuda al personal.' });
      table = tableRows[0];
    } else {
      if (!req.user) return res.status(401).json({ error: 'Para domicilios debes iniciar sesión con Google.' });
      if (requireGoogle && !req.user.google_id) return res.status(403).json({ error: 'Para realizar domicilios debes ingresar con una cuenta de Google verificada.' });
    }

    const customerName = cleanText(orderType === 'table' ? body.customer_name : (req.user && req.user.full_name), 160);
    const customerEmail = cleanText((req.user && req.user.email) || '', 254).toLowerCase();
    const customerPhone = orderType === 'table' ? '' : cleanText(body.customer_phone, 30);
    const zoneName = orderType === 'table' ? 'En mesa' : cleanText(body.delivery_zone, 100);
    const address = orderType === 'table' ? `Mesa ${table.label}` : cleanText(body.delivery_address, 255);
    const deliveryNotes = cleanText(body.delivery_notes, 1000);
    const payment = orderType === 'table' ? 'en_mesa' : cleanText(body.payment_method, 60);
    const items = Array.isArray(body.items) ? body.items : [];

    if (!customerName || (orderType === 'delivery' && (!customerPhone || !zoneName || !address))) {
      return res.status(400).json({ error: orderType === 'table' ? 'Escribe tu nombre para enviar el pedido.' : 'Completa nombre, teléfono, zona y dirección de entrega.' });
    }
    if (orderType === 'delivery' && !['contraentrega','transferencia'].includes(payment)) return res.status(400).json({ error: 'Ese medio de pago todavía no está activo en la tienda.' });
    if (!items.length || items.length > 25) return res.status(400).json({ error: 'El carrito no tiene productos válidos.' });

    await conn.beginTransaction();
    let zone = null;
    if (orderType === 'delivery') {
      const [zoneRows] = await conn.execute('SELECT * FROM delivery_zones WHERE name = ? AND active = 1 FOR UPDATE', [zoneName]);
      if (!zoneRows.length) { await conn.rollback(); return res.status(400).json({ error: 'Selecciona una zona de entrega válida.' }); }
      zone = zoneRows[0];
    }
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
    const shipping = orderType === 'table' ? 0 : (zone.shipping_fee === null ? null : Number(zone.shipping_fee));
    const total = shipping === null ? null : money(subtotal + shipping);
    const orderNumber = `AG-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const trackingToken = crypto.randomBytes(24).toString('hex');
    const customerId = req.user ? req.user.id : null;
    if (customerId && customerPhone) await conn.execute('UPDATE customers SET phone = ? WHERE id = ?', [customerPhone, customerId]);
    await conn.execute(
      `INSERT INTO orders (order_number, customer_id, customer_name, customer_email, customer_phone, delivery_zone, delivery_address, delivery_notes, payment_method, subtotal, shipping_cost, total, status, order_type, table_id, table_label, tracking_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      [orderNumber, customerId, customerName, customerEmail || null, customerPhone, zoneName, address, deliveryNotes, payment, subtotal, shipping, total, orderType, table ? table.id : null, table ? table.label : null, trackingToken]
    );
    const [orderRows] = await conn.execute('SELECT id FROM orders WHERE order_number = ?', [orderNumber]);
    const orderId = orderRows[0].id;
    for (const item of cleanItems) {
      await conn.execute('INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total) VALUES (?, ?, ?, ?, ?, ?)', [orderId,item.id,item.name,item.price,item.quantity,item.total]);
      if (item.stock !== null) await conn.execute('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity,item.id]);
    }
    await conn.commit();
    const itemLines = cleanItems.map(i => `• ${i.name} x${i.quantity}: $${i.total.toLocaleString('es-CO')}`).join('\n');
    const contextLine = orderType === 'table' ? `Modalidad: Pedido en mesa ${table.label}` : `Modalidad: Domicilio\nZona: ${zoneName}\nDirección: ${address}`;
    const message = `Hola, AGUI. Quiero confirmar el pedido ${orderNumber}.\n\n${itemLines}\n\nSubtotal: $${subtotal.toLocaleString('es-CO')}\n${orderType === 'table' ? `Total: $${total.toLocaleString('es-CO')}` : `Envío: ${shipping === null ? 'por confirmar' : `$${shipping.toLocaleString('es-CO')}`}\nTotal: ${total === null ? 'por confirmar con AGUI' : `$${total.toLocaleString('es-CO')}`}\nPago: ${payment === 'contraentrega' ? 'Contra entrega' : 'Transferencia bancaria'}`}\n\nNombre: ${customerName}\n${contextLine}${deliveryNotes ? `\nNotas: ${deliveryNotes}` : ''}`;
    const [waRows] = await conn.execute('SELECT setting_value FROM settings WHERE setting_key = ?', ['business_whatsapp']);
    const configuredWhatsApp = (waRows[0] && waRows[0].setting_value) || BUSINESS_DEFAULTS.whatsapp;
    res.status(201).json({ ok: true, order_number: orderNumber, tracking_token: trackingToken, order_type: orderType, table_label: table ? table.label : null, subtotal, shipping_cost: shipping, total, whatsapp_url: whatsappUrl(message, configuredWhatsApp), notice: orderType === 'table' ? `Tu pedido para la mesa ${table.label} fue recibido y está pendiente de confirmación.` : 'Pedido registrado como pendiente. AGUI debe confirmar disponibilidad y entrega por WhatsApp.' });
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
    // Migraciones aditivas e idempotentes: nunca eliminan pedidos, clientes ni productos.
    await pool.query(`CREATE TABLE IF NOT EXISTS dining_tables (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      label VARCHAR(80) NOT NULL UNIQUE,
      public_token CHAR(48) NOT NULL UNIQUE,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    const additions = [
      ['order_type', "ALTER TABLE orders ADD COLUMN order_type ENUM('delivery','table') NOT NULL DEFAULT 'delivery' AFTER status"],
      ['table_id', 'ALTER TABLE orders ADD COLUMN table_id BIGINT UNSIGNED NULL AFTER order_type'],
      ['table_label', 'ALTER TABLE orders ADD COLUMN table_label VARCHAR(80) NULL AFTER table_id'],
      ['tracking_token', 'ALTER TABLE orders ADD COLUMN tracking_token CHAR(48) NULL AFTER table_label']
    ];
    for (const [column, sql] of additions) {
      const [found] = await pool.execute(`SHOW COLUMNS FROM orders LIKE '${column}'`);
      if (!found.length) await pool.query(sql);
    }
    const [trackingIndex] = await pool.execute("SHOW INDEX FROM orders WHERE Key_name = 'uq_orders_tracking_token'");
    if (!trackingIndex.length) await pool.query('CREATE UNIQUE INDEX uq_orders_tracking_token ON orders (tracking_token)');
    const [statusColumns] = await pool.execute("SHOW COLUMNS FROM orders LIKE 'status'");
    if (statusColumns.length && !String(statusColumns[0].Type).includes("'shipped'")) {
      await pool.query("ALTER TABLE orders MODIFY COLUMN status ENUM('pending','confirmed','preparing','ready','shipped','delivered','cancelled') NOT NULL DEFAULT 'pending'");
    }
    const [customerColumns] = await pool.execute("SHOW COLUMNS FROM customers LIKE 'password_hash'");
    if (!customerColumns.length) {
      await pool.query('ALTER TABLE customers ADD COLUMN password_hash VARCHAR(255) NULL AFTER full_name');
      console.log('Base actualizada: cuentas de cliente por correo habilitadas.');
    }
    const customerAdditions = [
      ['username', 'ALTER TABLE customers ADD COLUMN username VARCHAR(40) NULL UNIQUE AFTER full_name'],
      ['email_verified_at', 'ALTER TABLE customers ADD COLUMN email_verified_at DATETIME NULL AFTER google_id']
    ];
    for (const [column, sql] of customerAdditions) { const [found] = await pool.execute(`SHOW COLUMNS FROM customers LIKE '${column}'`); if (!found.length) await pool.query(sql); }
    const [adminFlag] = await pool.execute("SHOW COLUMNS FROM admins LIKE 'password_change_available'");
    if (!adminFlag.length) await pool.query('ALTER TABLE admins ADD COLUMN password_change_available TINYINT(1) NOT NULL DEFAULT 1 AFTER active');
    await pool.query(`CREATE TABLE IF NOT EXISTS customer_addresses (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, customer_id BIGINT UNSIGNED NOT NULL,
      label VARCHAR(60) NOT NULL, recipient VARCHAR(160) NOT NULL, phone VARCHAR(30) NOT NULL,
      address VARCHAR(255) NOT NULL, zone VARCHAR(100) NOT NULL, notes TEXT NULL,
      is_default TINYINT(1) NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_customer_addresses_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
      INDEX idx_customer_addresses_customer (customer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await pool.query(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_type ENUM('admin','customer') NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE, expires_at DATETIME NOT NULL,
      used_at DATETIME NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_password_reset_user (user_type,user_id), INDEX idx_password_reset_expiry (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    const server = app.listen(PORT, () => console.log(`AGUI está disponible en ${BASE_URL} (puerto ${PORT}).`));
    const shutdown = () => server.close(async () => { await pool.end(); sessionStore.close(); process.exit(0); });
    process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  } catch (e) {
    console.error('No se pudo conectar a MySQL. Ejecuta primero npm run setup:db y revisa .env. Detalle:', e.message);
    process.exit(1);
  }
}
start();
