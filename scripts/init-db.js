import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import 'dotenv/config';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = await fs.readFile(path.join(root, 'database/schema.sql'), 'utf8');
const dbName = (process.env.DB_NAME || 'mercado').replaceAll('`','');
const base = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true
};

let conn;
try {
  conn = await mysql.createConnection({ ...base, database: dbName });
} catch (error) {
  const canCreate = String(process.env.DB_CREATE_DATABASE || 'false') === 'true';
  if (error?.code !== 'ER_BAD_DB_ERROR' || !canCreate) throw error;
  conn = await mysql.createConnection(base);
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${dbName}\``);
}

await conn.query(sql);
console.log(`Schema do banco ${dbName} inicializado.`);
await conn.end();
