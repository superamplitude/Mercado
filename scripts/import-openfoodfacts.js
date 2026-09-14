import fs from 'node:fs/promises';
import path from 'node:path';
import 'dotenv/config';
import { pool } from '../src/db.js';

const baseUrl = process.env.OFF_BASE_URL || 'https://world.openfoodfacts.org/api/v2/search';
const country = process.env.OFF_COUNTRY || 'brazil';
const pageSize = Math.min(100, Number(process.env.OFF_PAGE_SIZE || 100));
const maxPages = Math.max(0, Number(process.env.OFF_MAX_PAGES || 0));
const delayMs = Math.max(0, Number(process.env.OFF_DELAY_MS || 250));
const imageStorageDir = process.env.IMAGE_STORAGE_DIR || path.resolve('public/media/products');
const imageBaseUrl = (process.env.IMAGE_BASE_URL || '').replace(/\/$/, '');
const shouldDownloadImages = String(process.env.OFF_DOWNLOAD_IMAGES || 'true') === 'true';

const categoryRules = [
  ['bebidas',['beverages','sodas','waters','juices','energy-drinks','beers','wines']],
  ['frios-laticinios',['dairies','milks','cheeses','yogurts','butters','eggs']],
  ['congelados',['frozen-foods','ice-creams','frozen-desserts']],
  ['padaria',['breads','pastries','cakes','biscuits']],
  ['mercearia',['groceries','pastas','rices','cereals','sauces','condiments','chocolates','snacks','breakfasts']],
  ['higiene-beleza',['personal-care']],
  ['bebe',['baby-foods']],
  ['pet',['pet-food']]
];

const categoryHints = {
  bebidas: ['refrigerantes-bebidas','sucos-e-nectares-bebidas','agua-bebidas'],
  'frios-laticinios': ['leites-frios-laticinios','queijos-frios-laticinios','iogurtes-frios-laticinios'],
  congelados: ['pratos-prontos-congelados'],
  padaria: ['paes-padaria','bolos-e-tortas-padaria'],
  mercearia: ['biscoitos-e-snacks-mercearia','doces-e-chocolates-mercearia','massas-e-molhos-mercearia'],
  'higiene-beleza': ['banho-higiene-beleza'],
  bebe: ['alimentacao-infantil-bebe'],
  pet: ['racao-para-caes-pet']
};

const slugify = (value='') => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function inferDepartment(tags=[]) {
  const hay = tags.join(' ').toLowerCase();
  for (const [department, needles] of categoryRules) if (needles.some(n => hay.includes(n))) return department;
  return 'mercearia';
}

async function resolveCategoryId(conn, departmentSlug) {
  const hints = categoryHints[departmentSlug] || categoryHints.mercearia;
  for (const slug of hints) {
    const [[row]] = await conn.query('SELECT id FROM categories WHERE slug=? LIMIT 1',[slug]);
    if (row) return row.id;
  }
  const [[fallback]] = await conn.query(`SELECT c.id FROM categories c JOIN departments d ON d.id=c.department_id WHERE d.slug=? ORDER BY c.sort_order LIMIT 1`,[departmentSlug]);
  return fallback?.id || null;
}

async function mirrorImage(url, barcode) {
  if (!url || !shouldDownloadImages) return url || null;
  const response = await fetch(url, { headers: { 'user-agent':'MercadoSuperAmplitude/1.0 (catalog importer)' } });
  if (!response.ok) return url;
  const contentType = response.headers.get('content-type') || '';
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
  const safeCode = String(barcode || Date.now()).replace(/[^0-9A-Za-z_-]/g,'');
  await fs.mkdir(imageStorageDir,{recursive:true});
  const fileName = `${safeCode}.${ext}`;
  await fs.writeFile(path.join(imageStorageDir,fileName), Buffer.from(await response.arrayBuffer()));
  return imageBaseUrl ? `${imageBaseUrl}/products/${fileName}` : `/media/products/${fileName}`;
}

const conn = await pool.getConnection();
let imported = 0;
let skipped = 0;
try {
  for (let page=1; maxPages === 0 || page<=maxPages; page++) {
    const url = new URL(baseUrl);
    url.searchParams.set('countries_tags_en', country);
    url.searchParams.set('page', String(page));
    url.searchParams.set('page_size', String(pageSize));
    url.searchParams.set('fields','code,product_name,brands,quantity,categories_tags,image_front_url,nutriments');
    console.log(`Página ${page}${maxPages ? `/${maxPages}` : ''}: ${url}`);
    const response = await fetch(url, { headers: { 'user-agent':'MercadoSuperAmplitude/1.0' } });
    if (!response.ok) throw new Error(`Open Food Facts HTTP ${response.status}`);
    const body = await response.json();
    const products = body.products || [];
    if (!products.length) break;
    for (const p of products) {
      const barcode = String(p.code || '').trim();
      const name = String(p.product_name || '').trim();
      if (!barcode || !name) { skipped++; continue; }
      const tags = Array.isArray(p.categories_tags) ? p.categories_tags : [];
      const department = inferDepartment(tags);
      const categoryId = await resolveCategoryId(conn, department);
      if (!categoryId) { skipped++; continue; }
      const sku = `OFF-${barcode}`;
      const imageUrl = await mirrorImage(p.image_front_url, barcode).catch(() => p.image_front_url || null);
      const slug = `${slugify(name)}-${barcode}`.slice(0,240);
      await conn.execute(`INSERT INTO products(category_id,sku,barcode,name,slug,brand,description,package_size,price,stock_qty,image_url,image_source_url,image_license,source_name,source_product_id,nutrition_json,active)
        VALUES(?,?,?,?,?,?,?,?,0,0,?,?,?,?,?,?,?,1)
        ON DUPLICATE KEY UPDATE category_id=VALUES(category_id),name=VALUES(name),brand=VALUES(brand),package_size=VALUES(package_size),image_url=COALESCE(VALUES(image_url),image_url),image_source_url=COALESCE(VALUES(image_source_url),image_source_url),nutrition_json=VALUES(nutrition_json),updated_at=CURRENT_TIMESTAMP`,
        [categoryId,sku,barcode,name,slug,p.brands || null,null,p.quantity || null,imageUrl,p.image_front_url || null,'CC BY-SA / Open Food Facts','Open Food Facts',barcode,JSON.stringify(p.nutriments || {})]);
      imported++;
    }
    console.log(`Acumulado: ${imported} importados/atualizados; ${skipped} ignorados.`);
    if (products.length < pageSize) break;
    if (delayMs) await sleep(delayMs);
  }
  console.log(`Importação concluída. Importados/atualizados: ${imported}. Ignorados: ${skipped}.`);
} finally {
  conn.release();
  await pool.end();
}
