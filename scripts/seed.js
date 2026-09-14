import bcrypt from 'bcryptjs';
import 'dotenv/config';
import { pool } from '../src/db.js';

const taxonomy = [
  ['Mercearia','mercearia',['Arroz, Feijão e Grãos','Massas e Molhos','Óleos e Azeites','Farinhas e Misturas','Enlatados e Conservas','Temperos e Condimentos','Café, Chá e Achocolatados','Biscoitos e Snacks','Doces e Chocolates','Cereais e Matinais']],
  ['Bebidas','bebidas',['Água','Refrigerantes','Sucos e Néctares','Energéticos e Isotônicos','Cervejas','Vinhos e Espumantes','Destilados','Bebidas sem Álcool']],
  ['Hortifruti','hortifruti',['Frutas','Verduras','Legumes','Raízes e Tubérculos','Ervas e Temperos Frescos','Orgânicos']],
  ['Açougue','acougue',['Bovinos','Suínos','Aves','Peixes e Frutos do Mar','Linguiças e Embutidos','Carnes Congeladas']],
  ['Frios e Laticínios','frios-laticinios',['Leites','Queijos','Iogurtes','Manteigas e Margarinas','Frios e Fatiados','Sobremesas Refrigeradas','Ovos']],
  ['Padaria','padaria',['Pães','Bolos e Tortas','Salgados','Confeitaria','Pães de Forma','Torradas']],
  ['Congelados','congelados',['Pizzas','Pratos Prontos','Vegetais Congelados','Sorvetes','Hambúrgueres','Batatas e Petiscos']],
  ['Limpeza','limpeza',['Lavanderia','Limpeza da Casa','Lava-louças','Desinfetantes','Sacolas e Sacos de Lixo','Inseticidas']],
  ['Higiene e Beleza','higiene-beleza',['Higiene Bucal','Cabelos','Banho','Desodorantes','Barbear','Cuidados Femininos','Papel Higiênico','Dermocosméticos']],
  ['Bebê','bebe',['Fraldas','Lenços Umedecidos','Alimentação Infantil','Higiene do Bebê']],
  ['Pet','pet',['Ração para Cães','Ração para Gatos','Petiscos','Higiene Pet','Areia Sanitária']],
  ['Casa e Utilidades','casa-utilidades',['Cozinha','Descartáveis','Pilhas e Lâmpadas','Organização','Festas']]
];

const slugify = (value='') => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

const conn = await pool.getConnection();
try {
  await conn.beginTransaction();
  let sort = 1;
  for (const [name, slug, categories] of taxonomy) {
    await conn.execute('INSERT INTO departments(name,slug,sort_order) VALUES(?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),sort_order=VALUES(sort_order)', [name,slug,sort++]);
    const [[department]] = await conn.query('SELECT id FROM departments WHERE slug=? LIMIT 1', [slug]);
    let csort = 1;
    for (const categoryName of categories) {
      const categorySlug = `${slugify(categoryName)}-${slug}`;
      await conn.execute('INSERT INTO categories(department_id,name,slug,sort_order) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE department_id=VALUES(department_id),name=VALUES(name),sort_order=VALUES(sort_order)', [department.id,categoryName,categorySlug,csort++]);
    }
  }
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const email = process.env.ADMIN_EMAIL.toLowerCase();
    const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
    await conn.execute("INSERT INTO users(name,email,password_hash,role,active) VALUES('Super Admin',?,?,'super_admin',1) ON DUPLICATE KEY UPDATE name=VALUES(name),role='super_admin',active=1", [email,passwordHash]);
  }
  await conn.commit();
  console.log('Taxonomia criada. Administrador criado quando ADMIN_EMAIL e ADMIN_PASSWORD estão definidos.');
} catch (error) {
  await conn.rollback();
  throw error;
} finally {
  conn.release();
  await pool.end();
}
