import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.on("connect", () => {
  console.log("✅ Supabase PostgreSQL connected");
});

pool.on("error", (err) => {
  console.error("❌ PostgreSQL pool error:", err);
});

// Converts MySQL-style "?" placeholders to Postgres-style "$1, $2, ..."
async function query(sql, params = []) {
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  const result = await pool.query(pgSql, params);

  // Enable array destructuring [rows, result] and object destructuring { rows, rowCount }
  result[Symbol.iterator] = function* () {
    yield result.rows;
    yield result;
  };
  result[0] = result.rows;
  result[1] = result;

  return result;
}

const db = {
  query,
  pool,
  connect: (...args) => pool.connect(...args),
};

export { pool, query };
export default db;