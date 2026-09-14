import bcrypt from 'bcryptjs';
import { z } from 'zod';

const roles = ['admin','manager','cashier','stock','delivery'];

export function registerStaffRoutes(app, { auth, query }) {
  const admins = auth(['super_admin','admin']);

  app.get('/api/admin/staff', admins, async (_req, res, next) => {
    try {
      const rows = await query("SELECT id,name,email,role,active,created_at FROM users WHERE role<>'customer' ORDER BY name");
      res.json(rows);
    } catch (e) { next(e); }
  });

  app.post('/api/admin/staff', admins, async (req, res, next) => {
    try {
      const data = z.object({
        name: z.string().min(2).max(160),
        email: z.string().email(),
        password: z.string().min(8).max(200),
        role: z.enum(roles)
      }).parse(req.body);
      const passwordHash = await bcrypt.hash(data.password, 12);
      const result = await query('INSERT INTO users(name,email,password_hash,role,active) VALUES(?,?,?,?,1)', [data.name,data.email.toLowerCase(),passwordHash,data.role]);
      res.status(201).json({ id: result.insertId, name: data.name, email: data.email.toLowerCase(), role: data.role });
    } catch (e) { next(e); }
  });

  app.patch('/api/admin/staff/:id', admins, async (req, res, next) => {
    try {
      const data = z.object({
        name: z.string().min(2).max(160).optional(),
        password: z.string().min(8).max(200).optional(),
        role: z.enum(roles).optional(),
        active: z.boolean().optional()
      }).parse(req.body);
      const sets = [];
      const params = [];
      if (data.name !== undefined) { sets.push('name=?'); params.push(data.name); }
      if (data.password !== undefined) { sets.push('password_hash=?'); params.push(await bcrypt.hash(data.password,12)); }
      if (data.role !== undefined) { sets.push('role=?'); params.push(data.role); }
      if (data.active !== undefined) { sets.push('active=?'); params.push(data.active ? 1 : 0); }
      if (!sets.length) return res.json({ ok: true });
      params.push(req.params.id);
      const result = await query(`UPDATE users SET ${sets.join(',')} WHERE id=? AND role<>'super_admin'`, params);
      if (!result.affectedRows) return res.status(404).json({ error: 'Funcionário não encontrado ou protegido' });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
}
