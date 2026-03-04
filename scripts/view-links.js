#!/usr/bin/env node
/**
 * 用现有 pg 连接直接查 links 表并打印（不依赖 Prisma）。
 * 使用：先开 fly mpg proxy，再 node scripts/view-links.js
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false
});

async function main() {
  try {
    const res = await pool.query(
      'SELECT id, url, category, note, status, last_checked FROM links ORDER BY id DESC LIMIT 100'
    );
    console.log('Total rows:', res.rows.length);
    console.table(res.rows);
    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
