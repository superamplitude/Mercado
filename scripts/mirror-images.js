import fs from 'node:fs/promises';
import path from 'node:path';
import 'dotenv/config';
import { pool } from '../src/db.js';

const imageStorageDir = process.env.IMAGE_STORAGE_DIR || path.resolve('public/media/products');
const imageBaseUrl = (process.env.IMAGE_BASE_URL || '').replace(/\/$/, '');
const limit = Math.max(0, Number(process.env.MIRROR_IMAGE_LIMIT || 0));
const concurrency = Math.min(6, Math.max(1, Number(process.env.MIRROR_IMAGE_CONCURRENCY || 3)));
const maxBytes = Math.max(100000, Number(process.env.MIRROR_IMAGE_MAX_BYTES || 8000000));

if (!imageBaseUrl) throw new Error('IMAGE_BASE_URL obrigatório para espelhamento.');
await fs.mkdir(imageStorageDir, { recursive: true });

const [rows] = await pool.query(`SELECT id,barcode,sku,image_source_url,image_url FROM products
  WHERE image_source_url IS NOT NULL AND image_source_url<>'' AND (image_url IS NULL OR image_url NOT LIKE ?)
  ORDER BY id ${limit ? `LIMIT ${limit}` : ''}`, [`${imageBaseUrl}%`]);

let index = 0;
let ok = 0;
let failed = 0;
let skipped = 0;

async function processOne(product) {
  const source = String(product.image_source_url || '');
  if (!/^https?:\/\//i.test(source)) { skipped++; return; }
  try {
    const response = await fetch(source, { headers: { 'user-agent':'MercadoSuperAmplitude/1.0 image-mirror' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) throw new Error(`conteúdo inválido: ${contentType}`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length && length > maxBytes) throw new Error(`imagem acima do limite: ${length}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > maxBytes) throw new Error(`imagem acima do limite: ${data.length}`);
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : contentType.includes('avif') ? 'avif' : 'jpg';
    const key = String(product.barcode || product.sku || product.id).replace(/[^0-9A-Za-z_-]/g,'');
    const filename = `${key}.${ext}`;
    await fs.writeFile(path.join(imageStorageDir, filename), data);
    const publicUrl = `${imageBaseUrl}/products/${filename}`;
    await pool.execute('UPDATE products SET image_url=? WHERE id=?', [publicUrl, product.id]);
    ok++;
  } catch (e) {
    failed++;
    if (failed < 30) console.error(`Falha imagem ${product.id}: ${e.message}`);
  }
}

async function worker() {
  while (true) {
    const current = index++;
    if (current >= rows.length) return;
    await processOne(rows[current]);
    if ((ok + failed + skipped) % 100 === 0) console.log(`Imagens: ${ok} ok, ${failed} falhas, ${skipped} ignoradas.`);
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
await pool.end();
console.log(`Espelhamento concluído: ${ok} ok, ${failed} falhas, ${skipped} ignoradas, total ${rows.length}.`);
