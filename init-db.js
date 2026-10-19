require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'ADMIN_EMAIL', 'ADMIN_INITIAL_PASSWORD', 'SESSION_SECRET'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Faltan variables en .env: ${missing.join(', ')}`);
  process.exit(1);
}
if (process.env.ADMIN_INITIAL_PASSWORD.length < 12 || process.env.ADMIN_INITIAL_PASSWORD.includes('CAMBIA_')) {
  console.error('ADMIN_INITIAL_PASSWORD debe ser una contraseña propia de al menos 12 caracteres.');
  process.exit(1);
}
if (process.env.SESSION_SECRET.length < 32 || process.env.SESSION_SECRET.includes('CAMBIA_')) {
  console.error('SESSION_SECRET debe tener al menos 32 caracteres aleatorios.');
  process.exit(1);
}
if (!/^[a-zA-Z0-9_]+$/.test(process.env.DB_NAME)) {
  console.error('DB_NAME solo puede contener letras, números y guion bajo.');
  process.exit(1);
}

async function main() {
  const common = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
    charset: 'utf8mb4'
  };
  let connection;
  try {
    connection = await mysql.createConnection(common);
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query(`USE \`${process.env.DB_NAME}\``);
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await connection.query(schema);
    // Migración compatible con instalaciones existentes: habilita cuentas de clientes por correo/contraseña.
    const [customerColumns] = await connection.execute("SHOW COLUMNS FROM customers LIKE 'password_hash'");
    if (!customerColumns.length) {
      await connection.query('ALTER TABLE customers ADD COLUMN password_hash VARCHAR(255) NULL AFTER full_name');
      console.log('Se agregó el campo de autenticación de clientes.');
    }

    const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
    const name = (process.env.ADMIN_NAME || 'Guillermo').trim();
    const hash = await bcrypt.hash(process.env.ADMIN_INITIAL_PASSWORD, 12);
    const [existing] = await connection.execute('SELECT id FROM admins WHERE email = ?', [email]);
    if (existing.length) {
      await connection.execute('UPDATE admins SET full_name = ?, active = 1 WHERE email = ?', [name, email]);
      console.log(`La cuenta administradora ${email} ya existía; se conservó su contraseña actual.`);
    } else {
      await connection.execute('INSERT INTO admins (email, full_name, password_hash, active) VALUES (?, ?, ?, 1)', [email, name, hash]);
      console.log(`Cuenta dueña creada para ${email} (sin verificación de correo, protegida con contraseña).`);
    }

    const [countRows] = await connection.query('SELECT COUNT(*) AS n FROM products');
    if (Number(countRows[0].n) === 0) {
      const sample = [
        ['Arepas rellenas','arepas-rellenas','Arepas','$4000.00','/assets/arepas.jpg','Arepas doraditas para disfrutar.','1'],
        ['Muffin de chocolate','muffin-de-chocolate','Repostería','$4000.00','/assets/muffin.jpg','Un antojo dulce para cualquier momento.','1'],
        ['Torta de zanahoria','torta-de-zanahoria','Repostería','$5500.00','/assets/torta.jpg','Ideal para compartir.','1'],
        ['Arepa de queso','arepa-de-queso','Arepas','$3500.00','/assets/arepa-queso.jpg','Sabor casero en cada bocado.','0']
      ];
      for (const p of sample) {
        await connection.execute(
          'INSERT INTO products (name, slug, category, price, image_url, description, featured, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
          [p[0], p[1], p[2], Number(p[3].replace('$','')), p[4], p[5], Number(p[6])]
        );
      }
      console.log('Se agregaron 4 productos de muestra. Cambia precios, nombres y fotos desde el panel antes de abrir la tienda al público.');
    }
    const defaultZones = [
      ['Vegachí', null, 'Mismo día, sujeto a disponibilidad'],
      ['Yalí', null, 'Mismo día o día siguiente, por confirmar'],
      ['El Tigre', null, 'Mismo día o día siguiente, por confirmar']
    ];
    for (const z of defaultZones) {
      await connection.execute('INSERT IGNORE INTO delivery_zones (name, shipping_fee, eta, active) VALUES (?, ?, ?, 1)', z);
    }
    const defaultSettings = [
      ['business_name', 'AGUI Repostería y Arepas'],
      ['tagline', 'El mejor sabor, en cada bocado.'],
      ['business_address', process.env.BUSINESS_ADDRESS || 'Vegachí, Antioquia, Colombia'],
      ['business_phone', process.env.BUSINESS_PHONE || ''],
      ['business_whatsapp', process.env.BUSINESS_WHATSAPP || ''],
      ['business_email', process.env.BUSINESS_EMAIL || ''],
      ['order_notice', 'Tu pedido se confirmará cuando AGUI verifique disponibilidad y costo de entrega.']
    ];
    for (const s of defaultSettings) await connection.execute('INSERT IGNORE INTO settings (setting_key, setting_value) VALUES (?, ?)', s);
    console.log('Base de datos inicializada correctamente.');
  } catch (err) {
    console.error('No se pudo preparar la base de datos:', err.message);
    process.exitCode = 1;
  } finally {
    if (connection) await connection.end();
  }
}
main();
