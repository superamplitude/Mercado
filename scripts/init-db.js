import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import 'dotenv/config';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = await fs.readFile(path.join(root, 'database/schema.sql'), 'utf8');
const dbName = process.env.DB_NAME || 'mercado';
const conn = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true
});
await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName.replaceAll('`','')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await conn.query(`USE \`${dbName.replaceAll('`','')}\``);
await conn.query(sql);
console.log(`Banco ${dbName} inicializado.`);
await conn.end();
