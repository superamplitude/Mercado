import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import readline from 'node:readline';
import 'dotenv/config';
import { pool } from '../src/db.js';

const sourceUrl = process.env.OFF_BULK_URL || 'https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz';
const countryTag = process.env.OFF_BULK_COUNTRY_TAG || 'en:brazil';

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

function inferDepartment(tags=[]) {
  const hay = tags.join(' ').toLowerCase();
  for (const [department, needles] of categoryRules) if (needles.some(n => hay.includes(n))) return department;
  return 'mercearia';
}

async function buildCategoryCache(conn) {
  const [rows] = await conn.query(`SELECT c.id,c.slug,d.slug department_slug FROM categories c JOIN departments d ON d.id=c.department_id`);
  const bySlug = new Map(rows.map(r => [r.slug,r.id]));
  const firstByDepartment = new Map();
  for (const row of rows) if (!firstByDepartment.has(row.department_slug)) firstByDepartment.set(row.department_slug,row.id);
  return { bySlug, firstByDepartment };
}

function resolveCategoryId(cache, department) {
  for (const slug of categoryHints[department] || categoryHints.mercearia) {
    if (cache.bySlug.has(slug)) return cache.bySlug.get(slug);
  }
  return cache.firstByDepartment.get(department) || cache.firstByDepartment.get('mercearia');
}

console.log(`Baixando e filtrando catálogo: ${sourceUrl}`);
const response = await fetch(sourceUrl, { headers: { 'user-agent':'MercadoSuperAmplitude/1.0 bulk-import' } });
if (!response.ok || !response.body) throw new Error(`Falha no download: HTTP ${response.status}`);

const conn = await pool.getConnection();
const cache = await buildCategoryCache(conn);
const input = Readable.fromWeb(response.body).pipe(createGunzip());
const rl = readline.createInterface({ input, crlfDelay: Infinity });

let seen = 0;
let matched = 0;
let imported = 0;
let skipped = 0;
let errors = 0;

try {
  for await (const line of rl) {
    seen++;
    if (!line || line.length < 2) continue;
    let p;
    try { p = JSON.parse(line); } catch { errors++; continue; }
    const countries = Array.isArray(p.countries_tags) ? p.countries_tags : [];
    if (!countries.includes(countryTag)) continue;
    matched++;

    const barcode = String(p.code || '').trim();
    const name = String(p.product_name_pt || p.product_name || p.product_name_en || '').trim();
    if (!barcode || !name) { skipped++; continue; }

    const tags = Array.isArray(p.categories_tags) ? p.categories_tags : [];
    const department = inferDepartment(tags);
    const categoryId = resolveCategoryId(cache, department);
    if (!categoryId) { skipped++; continue; }

    const sku = `OFF-${barcode}`;
    const slug = `${slugify(name)}-${barcode}`.slice(0,240);
    const imageSource = p.image_front_url || p.image_url || null;
    const brand = Array.isArray(p.brands_tags) && p.brands_tags.length ? p.brands_tags[0].replace(/^en:/,'') : (p.brands || null);
    const nutrition = p.nutriments || {};

    try {
      await conn.execute(`INSERT INTO products(category_id,sku,barcode,name,slug,brand,description,package_size,price,stock_qty,image_url,image_source_url,image_license,source_name,source_product_id,nutrition_json,active)
        VALUES(?,?,?,?,?,?,?,?,0,0,?,?,?,?,?,?,?,1)
        ON DUPLICATE KEY UPDATE category_id=VALUES(category_id),name=VALUES(name),brand=VALUES(brand),package_size=VALUES(package_size),image_source_url=COALESCE(VALUES(image_source_url),image_source_url),nutrition_json=VALUES(nutrition_json),updated_at=CURRENT_TIMESTAMP`,
        [categoryId,sku,barcode,name,slug,brand,null,p.quantity || null,imageSource,imageSource,'CC BY-SA / Open Food Facts','Open Food Facts',barcode,JSON.stringify(nutrition)]);
      imported++;
    } catch (e) {
      errors++;
      if (errors < 20) console.error(`Erro ${barcode}:`, e.message);
    }

    if (matched % 1000 === 0) console.log(`Brasil: ${matched} encontrados; ${imported} importados/atualizados; ${skipped} ignorados; ${errors} erros.`);
  }
} finally {
  rl.close();
  conn.release();
  await pool.end();
}

console.log(`Concluído. Linhas lidas=${seen}; Brasil=${matched}; importados=${imported}; ignorados=${skipped}; erros=${errors}.`);
