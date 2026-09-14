import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import 'dotenv/config';
import { pool, query } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');
const app = express();
const port = Number(process.env.PORT || 3010);
const jwtSecret = process.env.JWT_SECRET || 'change-me-now';

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('combined'));
app.use(express.static(publicDir, { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

function slugify(value = '') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function tokenFor(user) {
  return jwt.sign({ id: user.id, role: user.role, email: user.email }, jwtSecret, { expiresIn: '12h' });
}

function auth(roles = []) {
  return async (req, res, next) => {
    try {
      const raw = req.headers.authorization || '';
      const token = raw.startsWith('Bearer ') ? raw.slice(7) : null;
      if (!token) return res.status(401).json({ error: 'Não autenticado' });
      const payload = jwt.verify(token, jwtSecret);
      const rows = await query('SELECT id,name,email,role,active FROM users WHERE id=? LIMIT 1', [payload.id]);
      const user = rows[0];
      if (!user || !user.active) return res.status(401).json({ error: 'Usuário inválido' });
      if (roles.length && !roles.includes(user.role)) return res.status(403).json({ error: 'Sem permissão' });
      req.user = user;
      next();
    } catch {
      return res.status(401).json({ error: 'Sessão inválida' });
    }
  };
}

app.get('/api/health', async (_req, res) => {
  try {
    await query('SELECT 1 ok');
    res.json({ ok: true, service: 'mercado-superamplitude', time: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message });
  }
});

app.get('/api/store', (_req, res) => {
  res.json({
    name: process.env.STORE_NAME || 'Mercado SuperAmplitude',
    url: process.env.APP_URL || 'https://mercado.superamplitude.com',
    imageBaseUrl: process.env.IMAGE_BASE_URL || '',
    deliveryBaseFee: Number(process.env.DELIVERY_BASE_FEE || 8.9),
    freeDeliveryFrom: Number(process.env.FREE_DELIVERY_FROM || 199)
  });
});

app.get('/api/departments', async (_req, res, next) => {
  try {
    const departments = await query('SELECT id,name,slug FROM departments WHERE active=1 ORDER BY sort_order,name');
    const categories = await query('SELECT id,department_id,parent_id,name,slug FROM categories WHERE active=1 ORDER BY sort_order,name');
    res.json(departments.map(d => ({ ...d, categories: categories.filter(c => c.department_id === d.id) })));
  } catch (e) { next(e); }
});

app.get('/api/products', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(80, Math.max(1, Number(req.query.limit || 24)));
    const offset = (page - 1) * limit;
    const q = String(req.query.q || '').trim();
    const category = String(req.query.category || '').trim();
    const department = String(req.query.department || '').trim();
    const featured = String(req.query.featured || '') === '1';
    const params = [];
    const where = ['p.active=1'];
    if (q) {
      where.push('(p.name LIKE ? OR p.brand LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)');
      const term = `%${q}%`; params.push(term, term, term, term);
    }
    if (category) { where.push('c.slug=?'); params.push(category); }
    if (department) { where.push('d.slug=?'); params.push(department); }
    if (featured) where.push('p.featured=1');
    const sql = `SELECT p.id,p.sku,p.barcode,p.name,p.slug,p.brand,p.description,p.unit,p.package_size,p.price,p.compare_at_price,p.stock_qty,p.image_url,p.featured,c.name category,c.slug category_slug,d.name department,d.slug department_slug
      FROM products p JOIN categories c ON c.id=p.category_id JOIN departments d ON d.id=c.department_id
      WHERE ${where.join(' AND ')} ORDER BY p.featured DESC,p.name LIMIT ${limit} OFFSET ${offset}`;
    const rows = await query(sql, params);
    res.json({ page, limit, items: rows });
  } catch (e) { next(e); }
});

app.get('/api/products/:idOrSlug', async (req, res, next) => {
  try {
    const value = req.params.idOrSlug;
    const rows = await query(`SELECT p.*,c.name category,c.slug category_slug,d.name department,d.slug department_slug
      FROM products p JOIN categories c ON c.id=p.category_id JOIN departments d ON d.id=c.department_id
      WHERE p.active=1 AND (p.id=? OR p.slug=?) LIMIT 1`, [Number(value) || 0, value]);
    if (!rows[0]) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const schema = z.object({ email: z.string().email(), password: z.string().min(6) });
    const { email, password } = schema.parse(req.body);
    const rows = await query('SELECT * FROM users WHERE email=? AND active=1 LIMIT 1', [email.toLowerCase()]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Login inválido' });
    res.json({ token: tokenFor(user), user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (e) { next(e); }
});

const orderSchema = z.object({
  customerName: z.string().min(2).max(160),
  customerEmail: z.string().email().optional().or(z.literal('')),
  customerPhone: z.string().min(8).max(40),
  address: z.object({ street: z.string().min(2), number: z.string().min(1), district: z.string().min(2), city: z.string().min(2), state: z.string().length(2), postalCode: z.string().min(8), complement: z.string().optional() }),
  items: z.array(z.object({ productId: z.number().int().positive(), qty: z.number().positive().max(999) })).min(1),
  notes: z.string().max(1000).optional()
});

app.post('/api/orders', async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const data = orderSchema.parse(req.body);
    await conn.beginTransaction();
    const ids = data.items.map(i => i.productId);
    const marks = ids.map(() => '?').join(',');
    const [products] = await conn.execute(`SELECT id,sku,name,price,stock_qty,active FROM products WHERE id IN (${marks}) FOR UPDATE`, ids);
    if (products.length !== ids.length) throw new Error('Um ou mais produtos não existem');
    let subtotal = 0;
    const normalized = data.items.map(item => {
      const p = products.find(x => x.id === item.productId);
      if (!p.active) throw new Error(`${p.name} está indisponível`);
      if (Number(p.stock_qty) < item.qty) throw new Error(`Estoque insuficiente: ${p.name}`);
      const total = Number(p.price) * item.qty;
      subtotal += total;
      return { ...item, product: p, total };
    });
    const freeFrom = Number(process.env.FREE_DELIVERY_FROM || 199);
    const deliveryFee = subtotal >= freeFrom ? 0 : Number(process.env.DELIVERY_BASE_FEE || 8.9);
    const total = subtotal + deliveryFee;
    const orderNumber = `MSA-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const [orderResult] = await conn.execute(`INSERT INTO orders(order_number,customer_name,customer_email,customer_phone,address_json,subtotal,delivery_fee,total,notes)
      VALUES(?,?,?,?,?,?,?,?,?)`, [orderNumber,data.customerName,data.customerEmail || null,data.customerPhone,JSON.stringify(data.address),subtotal,deliveryFee,total,data.notes || null]);
    for (const item of normalized) {
      await conn.execute('INSERT INTO order_items(order_id,product_id,product_name,sku,qty,unit_price,total_price) VALUES(?,?,?,?,?,?,?)', [orderResult.insertId,item.product.id,item.product.name,item.product.sku,item.qty,item.product.price,item.total]);
      await conn.execute('UPDATE products SET stock_qty=stock_qty-? WHERE id=?', [item.qty,item.product.id]);
      await conn.execute("INSERT INTO inventory_movements(product_id,type,quantity,reference) VALUES(?,'sale',?,?)", [item.product.id,-item.qty,orderNumber]);
    }
    await conn.commit();
    res.status(201).json({ orderNumber, subtotal, deliveryFee, total, status: 'pending', paymentStatus: 'pending' });
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally { conn.release(); }
});

app.get('/api/admin/summary', auth(['super_admin','admin','manager']), async (_req, res, next) => {
  try {
    const [products] = await query('SELECT COUNT(*) total, SUM(active=1) active, SUM(stock_qty<=min_stock) low_stock FROM products');
    const [orders] = await query("SELECT COUNT(*) total, SUM(status IN ('pending','paid','picking','packed','out_for_delivery')) open_orders, COALESCE(SUM(CASE WHEN payment_status='paid' THEN total ELSE 0 END),0) revenue FROM orders");
    const recent = await query('SELECT order_number,customer_name,status,payment_status,total,created_at FROM orders ORDER BY id DESC LIMIT 10');
    res.json({ products, orders, recent });
  } catch (e) { next(e); }
});

app.get('/api/admin/products', auth(['super_admin','admin','manager','stock']), async (req, res, next) => {
  try {
    const q = `%${String(req.query.q || '')}%`;
    const rows = await query(`SELECT p.id,p.sku,p.barcode,p.name,p.brand,p.price,p.stock_qty,p.min_stock,p.active,c.name category
      FROM products p JOIN categories c ON c.id=p.category_id WHERE p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? ORDER BY p.id DESC LIMIT 200`, [q,q,q]);
    res.json(rows);
  } catch (e) { next(e); }
});

app.post('/api/admin/products', auth(['super_admin','admin','manager','stock']), async (req, res, next) => {
  try {
    const schema = z.object({
      categoryId: z.number().int().positive(), sku: z.string().min(2), barcode: z.string().optional(), name: z.string().min(2), brand: z.string().optional(),
      description: z.string().optional(), unit: z.string().default('un'), packageSize: z.string().optional(), price: z.number().nonnegative(), stockQty: z.number().nonnegative().default(0), imageUrl: z.string().url().optional().or(z.literal(''))
    });
    const d = schema.parse(req.body);
    const slug = `${slugify(d.name)}-${slugify(d.sku)}`;
    const result = await query(`INSERT INTO products(category_id,sku,barcode,name,slug,brand,description,unit,package_size,price,stock_qty,image_url)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, [d.categoryId,d.sku,d.barcode || null,d.name,slug,d.brand || null,d.description || null,d.unit,d.packageSize || null,d.price,d.stockQty,d.imageUrl || null]);
    res.status(201).json({ id: result.insertId, slug });
  } catch (e) { next(e); }
});

app.patch('/api/admin/orders/:id/status', auth(['super_admin','admin','manager','cashier','delivery']), async (req, res, next) => {
  try {
    const schema = z.object({ status: z.enum(['pending','paid','picking','packed','out_for_delivery','delivered','cancelled']) });
    const { status } = schema.parse(req.body);
    await query('UPDATE orders SET status=? WHERE id=?', [status, req.params.id]);
    res.json({ ok: true, status });
  } catch (e) { next(e); }
});

app.post('/api/ai/ask', async (req, res, next) => {
  try {
    const question = String(req.body?.question || '').trim().slice(0,1000);
    if (!question) return res.status(400).json({ error: 'Digite uma pergunta' });
    const words = question.split(/\s+/).filter(w => w.length >= 3).slice(0,5);
    const like = `%${words.join('%')}%`;
    const products = await query(`SELECT id,name,brand,price,image_url,stock_qty,slug FROM products WHERE active=1 AND (name LIKE ? OR brand LIKE ?) ORDER BY featured DESC,name LIMIT 8`, [like,like]);
    const aiBase = process.env.AI_BASE_URL;
    const aiKey = process.env.AI_API_KEY;
    const model = process.env.AI_MODEL;
    if (aiBase && aiKey && model) {
      const response = await fetch(`${aiBase.replace(/\/$/,'')}/chat/completions`, {
        method: 'POST', headers: { 'content-type':'application/json', authorization:`Bearer ${aiKey}` },
        body: JSON.stringify({ model, temperature:0.2, messages:[
          { role:'system', content:'Você é o assistente do Mercado SuperAmplitude. Responda em português, seja objetivo, não invente preço ou estoque e use somente os produtos fornecidos como contexto.' },
          { role:'user', content:`Pergunta: ${question}\nProdutos encontrados: ${JSON.stringify(products)}` }
        ] })
      });
      if (response.ok) {
        const body = await response.json();
        return res.json({ answer: body.choices?.[0]?.message?.content || 'Não consegui responder agora.', products });
      }
    }
    const answer = products.length ? `Encontrei ${products.length} item(ns) relacionado(s). Posso ajudar a comparar preço, marca e disponibilidade.` : 'Não encontrei produtos relacionados no catálogo. Tente informar marca, tipo ou nome do produto.';
    res.json({ answer, products });
  } catch (e) { next(e); }
});

app.get('/admin', (_req,res) => res.sendFile(path.join(publicDir,'admin.html')));
app.get('*', (_req,res) => res.sendFile(path.join(publicDir,'index.html')));

app.use((err, req, res, _next) => {
  console.error(err);
  if (err instanceof z.ZodError) return res.status(400).json({ error: 'Dados inválidos', details: err.issues });
  res.status(500).json({ error: err.message || 'Erro interno' });
});

app.listen(port, '0.0.0.0', () => console.log(`Mercado SuperAmplitude na porta ${port}`));
