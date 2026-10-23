import { q } from '../db.js';

export default async function (app) {
  app.addHook('preHandler', app.autenticar);

  app.get('/', async (req) => {
    const f = req.query, cond = [], par = [];
    const add = (sql, v) => { par.push(v); cond.push(sql.replace('$?', `$${par.length}`)); };
    if (f.q)        add('f_unaccent(nome) ILIKE f_unaccent($?)', `%${f.q}%`);
    if (f.setor)    add('setor = ANY($?)', String(f.setor).split(','));
    if (f.uf)       add('uf = ANY($?)', String(f.uf).split(','));
    if (f.porte)    add('porte = ANY($?)', String(f.porte).split(','));
    if (f.situacao) add('situacao = ANY($?)', String(f.situacao).split(','));
    if (f.sem_decisor_ti === 'true') cond.push('sem_decisor_ti = true');

    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const tamanho = Math.min(Number(f.tamanho) || 50, 200);
    const pagina = Math.max(Number(f.pagina) || 1, 1);
    const { rows } = await q(
      `SELECT *, count(*) OVER () AS total FROM v_conta ${where}
       ORDER BY melhor_score DESC NULLS LAST, contatos DESC
       LIMIT $${par.length + 1} OFFSET $${par.length + 2}`,
      [...par, tamanho, (pagina - 1) * tamanho]);
    return {
      total: rows[0] ? Number(rows[0].total) : 0, pagina, tamanho,
      itens: rows.map(({ total, ...r }) => r),
    };
  });

  app.get('/:id', async (req, reply) => {
    const { rows } = await q('SELECT * FROM v_conta WHERE id = $1', [req.params.id]);
    if (!rows[0]) return reply.code(404).send({ erro: 'nao_encontrado', mensagem: 'Empresa inexistente.' });
    const contatos = await q(
      `SELECT c.id, c.nome, c.cargo, c.familia_cargo, c.email, c.papel_ti,
              c.score_icp, c.prioridade, COALESCE(p.situacao,'nao_tocado') AS situacao
       FROM contato c LEFT JOIN prospeccao p ON p.contato_id = c.id
       WHERE c.empresa_id = $1 ORDER BY c.score_icp DESC NULLS LAST`, [req.params.id]);
    return { ...rows[0], contatos: contatos.rows };
  });

  app.patch('/:id', { preHandler: app.exigePapel(['admin','operador']) }, async (req) => {
    const { situacao, observacoes } = req.body || {};
    const { rows } = await q(
      `UPDATE empresa SET situacao = COALESCE($2, situacao), observacoes = COALESCE($3, observacoes)
       WHERE id = $1 RETURNING *`, [req.params.id, situacao ?? null, observacoes ?? null]);
    return rows[0];
  });
}
