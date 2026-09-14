import { z } from 'zod';

const orderStatuses = ['pending','paid','picking','packed','out_for_delivery','delivered','cancelled'];

async function audit(query, req, action, entityType, entityId, payload = {}) {
  try {
    await query(
      'INSERT INTO audit_logs(user_id,action,entity_type,entity_id,payload_json,ip_address) VALUES(?,?,?,?,?,?)',
      [req.user?.id || null, action, entityType, entityId ? String(entityId) : null, JSON.stringify(payload), req.ip || null]
    );
  } catch (error) {
    console.error('audit', error.message);
  }
}

export function registerAdminOpsRoutes(app, { auth, query }) {
  const managers = auth(['super_admin','admin','manager']);
  const catalog = auth(['super_admin','admin','manager','stock']);
  const ordersAccess = auth(['super_admin','admin','manager','cashier','delivery']);

  app.get('/api/admin/orders', ordersAccess, async (req, res, next) => {
    try {
      const status = String(req.query.status || '').trim();
      const q = String(req.query.q || '').trim();
      const where = [];
      const params = [];
      if (status) {
        if (!orderStatuses.includes(status)) return res.status(400).json({ error: 'Status inválido' });
        where.push('status=?'); params.push(status);
      }
      if (q) {
        const term = `%${q}%`;
        where.push('(order_number LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)');
        params.push(term,term,term);
      }
      const rows = await query(`SELECT id,order_number,customer_name,customer_phone,status,payment_provider,payment_status,subtotal,delivery_fee,total,created_at,updated_at
        FROM orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 300`, params);
      res.json(rows);
    } catch (e) { next(e); }
  });

  app.patch('/api/admin/products/:id', catalog, async (req, res, next) => {
    try {
      const schema = z.object({
        price: z.number().nonnegative().optional(),
        compareAtPrice: z.number().nonnegative().nullable().optional(),
        stockQty: z.number().nonnegative().optional(),
        minStock: z.number().nonnegative().optional(),
        active: z.boolean().optional(),
        featured: z.boolean().optional()
      });
      const d = schema.parse(req.body);
      const sets = [];
      const params = [];
      if (d.price !== undefined) { sets.push('price=?'); params.push(d.price); }
      if (d.compareAtPrice !== undefined) { sets.push('compare_at_price=?'); params.push(d.compareAtPrice); }
      if (d.stockQty !== undefined) { sets.push('stock_qty=?'); params.push(d.stockQty); }
      if (d.minStock !== undefined) { sets.push('min_stock=?'); params.push(d.minStock); }
      if (d.active !== undefined) { sets.push('active=?'); params.push(d.active ? 1 : 0); }
      if (d.featured !== undefined) { sets.push('featured=?'); params.push(d.featured ? 1 : 0); }
      if (!sets.length) return res.json({ ok: true });
      params.push(req.params.id);
      await query(`UPDATE products SET ${sets.join(',')} WHERE id=?`, params);
      await audit(query, req, 'product.update', 'product', req.params.id, d);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  app.get('/api/admin/coupons', managers, async (_req, res, next) => {
    try { res.json(await query('SELECT * FROM coupons ORDER BY id DESC')); }
    catch (e) { next(e); }
  });

  app.post('/api/admin/coupons', managers, async (req, res, next) => {
    try {
      const schema = z.object({
        code: z.string().min(2).max(60),
        type: z.enum(['percent','fixed','free_delivery']),
        value: z.number().nonnegative().default(0),
        minOrder: z.number().nonnegative().default(0),
        startsAt: z.string().nullable().optional(),
        endsAt: z.string().nullable().optional(),
        usageLimit: z.number().int().positive().nullable().optional()
      });
      const d = schema.parse(req.body);
      const result = await query('INSERT INTO coupons(code,type,value,min_order,starts_at,ends_at,usage_limit,active) VALUES(?,?,?,?,?,?,?,1)', [d.code.toUpperCase(),d.type,d.value,d.minOrder,d.startsAt || null,d.endsAt || null,d.usageLimit || null]);
      await audit(query, req, 'coupon.create', 'coupon', result.insertId, d);
      res.status(201).json({ id: result.insertId });
    } catch (e) { next(e); }
  });

  app.patch('/api/admin/coupons/:id', managers, async (req, res, next) => {
    try {
      const d = z.object({ active: z.boolean() }).parse(req.body);
      await query('UPDATE coupons SET active=? WHERE id=?', [d.active ? 1 : 0, req.params.id]);
      await audit(query, req, 'coupon.toggle', 'coupon', req.params.id, d);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  app.get('/api/admin/delivery-zones', managers, async (_req, res, next) => {
    try { res.json(await query('SELECT * FROM delivery_zones ORDER BY city,name')); }
    catch (e) { next(e); }
  });

  app.post('/api/admin/delivery-zones', managers, async (req, res, next) => {
    try {
      const schema = z.object({
        name: z.string().min(2).max(120),
        city: z.string().min(2).max(120),
        district: z.string().max(120).nullable().optional(),
        postalCodePrefix: z.string().max(8).nullable().optional(),
        fee: z.number().nonnegative(),
        minimumOrder: z.number().nonnegative().default(0),
        estimatedMinutes: z.number().int().positive().max(1440).default(60)
      });
      const d = schema.parse(req.body);
      const result = await query('INSERT INTO delivery_zones(name,city,district,postal_code_prefix,fee,minimum_order,estimated_minutes,active) VALUES(?,?,?,?,?,?,?,1)', [d.name,d.city,d.district || null,d.postalCodePrefix || null,d.fee,d.minimumOrder,d.estimatedMinutes]);
      await audit(query, req, 'delivery_zone.create', 'delivery_zone', result.insertId, d);
      res.status(201).json({ id: result.insertId });
    } catch (e) { next(e); }
  });

  app.patch('/api/admin/delivery-zones/:id', managers, async (req, res, next) => {
    try {
      const d = z.object({ active: z.boolean() }).parse(req.body);
      await query('UPDATE delivery_zones SET active=? WHERE id=?', [d.active ? 1 : 0, req.params.id]);
      await audit(query, req, 'delivery_zone.toggle', 'delivery_zone', req.params.id, d);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
}
