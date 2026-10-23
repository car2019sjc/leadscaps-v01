import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export const q = (texto, params) => pool.query(texto, params);

/** Executa dentro de transação, com rollback automático em erro. */
export async function emTransacao(fn) {
  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    const r = await fn(cli);
    await cli.query('COMMIT');
    return r;
  } catch (e) {
    await cli.query('ROLLBACK');
    throw e;
  } finally {
    cli.release();
  }
}
