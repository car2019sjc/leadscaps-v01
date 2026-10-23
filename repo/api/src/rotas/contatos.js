import { q } from '../db.js';

const LISTA = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : null);
const BOOL  = (v) => v === true || v === 'true' || v === '1';

const ORDENS = {
  score: 'c.score_icp ASC', '-score': 'c.score_icp DESC',
  nome: 'c.nome ASC', empresa: 'e.nome ASC',
  funcionarios: 'e.funcionarios DESC NULLS LAST',
};

/** Monta WHERE a partir dos filtros. `pular` omite uma dimensão (para facetas). */
function montarFiltros(f, pular = null) {
  const cond = [], par = [];
  const add = (sql, valor) => { par.push(valor); cond.push(sql.replace('$?', `$${par.length}`)); };

  if (f.q) add(`(f_unaccent(c.nome) ILIKE f_unaccent($?) OR f_unaccent(c.cargo) ILIKE f_unaccent($?)
                 OR f_unaccent(e.nome) ILIKE f_unaccent($?) OR c.email ILIKE $?)`.replace(/\$\?/g, () => `$${par.length + 1}`), `%${f.q}%`);

  const multi = (campo, valor, chave) => {
    const lista = LISTA(valor);
    if (lista && pular !== chave) add(`${campo} = ANY($?)`, lista);
  };
  multi('c.prioridade',    f.prioridade, 'prioridade');
  multi('c.familia_cargo', f.familia,    'familia');
  multi('e.setor',         f.setor,      'setor');
  multi('e.porte',         f.porte,      'porte');
  multi('c.uf',            f.uf,         'uf');
  multi('c.municipio',     f.municipio,  'municipio');
  multi('c.papel_ti',      f.papel_ti,   'papel_ti');
  multi(`COALESCE(p.situacao,'nao_tocado')`, f.situacao, 'situacao');

  const excl = (campo, valor) => { const l = LISTA(valor); if (l) add(`(${campo} IS NULL OR NOT (${campo} = ANY($?)))`, l); };
  excl('c.familia_cargo', f.excluir_familia);
  excl('e.setor',         f.excluir_setor);
  const termos = LISTA(f.excluir_cargo_contem);
  if (termos) for (const t of termos) add(`f_unaccent(coalesce(c.cargo,'')) NOT ILIKE f_unaccent($?)`, `%${t}%`);

  if (f.func_min) add('e.funcionarios >= $?', Number(f.func_min));
  if (f.func_max) add('e.funcionarios <= $?', Number(f.func_max));
  if (f.fat_min)  add('e.faturamento_usd >= $?', Number(f.fat_min));
  if (f.fat_max)  add('e.faturamento_usd <= $?', Number(f.fat_max));

  if (BOOL(f.so_email_corporativo)) cond.push('c.email_corporativo = true');
  if (BOOL(f.so_com_linkedin))      cond.push('c.linkedin_url IS NOT NULL');

  return { where: cond.length ? `WHERE ${cond.join(' AND ')}` : '', par };
}

const BASE = `FROM contato c
  JOIN empresa e ON e.id = c.empresa_id
  LEFT JOIN prospeccao p ON p.contato_id = c.id`;

export default async function (app) {
  app.addHook('preHandler', app.autenticar);

  app.get('/', async (req) => {
    const f = req.query;
    const { where, par } = montarFiltros(f);
    const ordem = ORDENS[f.ordenar] || ORDENS['-score'];
    const tamanho = Math.min(Number(f.tamanho) || 50, 200);
    const pagina = Math.max(Number(f.pagina) || 1, 1);

    // um por empresa: mantém o de maior score dentro de cada conta
    const dedupe = BOOL(f.um_por_empresa)
      ? `, ROW_NUMBER() OVER (PARTITION BY c.empresa_id ORDER BY c.score_icp DESC NULLS LAST) AS rn`
      : '';
    const filtroDedupe = BOOL(f.um_por_empresa) ? 'WHERE rn = 1' : '';

    const sql = `
      WITH filtrado AS (
        SELECT c.id, c.nome, c.cargo, c.familia_cargo, c.senioridade, c.email,
               c.email_corporativo, c.papel_ti, c.score_icp, c.prioridade,
               c.municipio, c.uf, c.linkedin_url,
               e.id AS empresa_id, e.nome AS empresa, e.setor, e.porte, e.funcionarios,
               COALESCE(p.situacao,'nao_tocado') AS situacao, p.ultimo_toque, p.retomar_em
               ${dedupe}
        ${BASE} ${where}
      )
      SELECT *, count(*) OVER () AS total FROM filtrado ${filtroDedupe}
      ORDER BY ${ordem.replace(/^c\.|^e\./, '')}
      LIMIT $${par.length + 1} OFFSET $${par.length + 2}`;

    const { rows } = await q(sql, [...par, tamanho, (pagina - 1) * tamanho]);
    return {
      total: rows[0] ? Number(rows[0].total) : 0,
      pagina, tamanho,
      itens: rows.map(({ total, rn, ...r }) => r),
    };
  });

  /** contagens por dimensão, cada uma ignorando o próprio filtro */
  app.get('/facetas', async (req) => {
    const f = req.query;
    const dims = {
      familia: 'c.familia_cargo', setor: 'e.setor', porte: 'e.porte',
      uf: 'c.uf', municipio: 'c.municipio', prioridade: 'c.prioridade',
      papel_ti: 'c.papel_ti', situacao: `COALESCE(p.situacao,'nao_tocado')`,
    };
    const saida = {};
    for (const [chave, campo] of Object.entries(dims)) {
      const { where, par } = montarFiltros(f, chave);
      const { rows } = await q(
        `SELECT ${campo} AS valor, count(*)::int AS n ${BASE} ${where}
         GROUP BY 1 HAVING ${campo} IS NOT NULL ORDER BY n DESC`, par);
      saida[chave] = Object.fromEntries(rows.map((r) => [r.valor, r.n]));
    }
    return saida;
  });

  app.get('/:id', async (req, reply) => {
    const { rows } = await q(
      `SELECT c.*, to_jsonb(e.*) AS empresa, to_jsonb(p.*) AS prospeccao
       FROM contato c JOIN empresa e ON e.id = c.empresa_id
       LEFT JOIN prospeccao p ON p.contato_id = c.id WHERE c.id = $1`, [req.params.id]);
    if (!rows[0]) return reply.code(404).send({ erro: 'nao_encontrado', mensagem: 'Contato inexistente.' });

    const [inter, ia] = await Promise.all([
      q('SELECT * FROM interacao WHERE contato_id = $1 ORDER BY ocorrido_em DESC LIMIT 50', [req.params.id]),
      q(`SELECT id, tipo, confianca, criado_em, resultado, fontes FROM analise_ia
         WHERE contato_id = $1 OR empresa_id = $2 ORDER BY criado_em DESC LIMIT 10`,
        [req.params.id, rows[0].empresa.id]),
    ]);
    return { ...rows[0], interacoes: inter.rows, analises: ia.rows };
  });
}
