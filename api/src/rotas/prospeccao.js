import { q, emTransacao } from '../db.js';

const SITUACOES = ['nao_tocado','abordado','respondeu','reuniao_marcada','reuniao_realizada',
                   'proposta_enviada','ganho','sem_fit','sem_resposta','retomar'];
const CANAIS = ['email','linkedin','telefone','evento','indicacao'];

export default async function (app) {
  app.addHook('preHandler', app.autenticar);

  /** grava status e registra a mudança no histórico, sempre */
  app.put('/contatos/:id/prospeccao', { preHandler: app.exigePapel(['admin','operador']) },
    async (req, reply) => {
      const { situacao, canal_ultimo, retomar_em, observacoes, motivo_sem_fit } = req.body || {};
      if (situacao && !SITUACOES.includes(situacao))
        return reply.code(400).send({ erro: 'situacao_invalida', mensagem: `Use uma de: ${SITUACOES.join(', ')}` });
      if (canal_ultimo && !CANAIS.includes(canal_ultimo))
        return reply.code(400).send({ erro: 'canal_invalido', mensagem: `Use um de: ${CANAIS.join(', ')}` });

      return emTransacao(async (cli) => {
        const atual = await cli.query('SELECT situacao FROM prospeccao WHERE contato_id = $1', [req.params.id]);
        const de = atual.rows[0]?.situacao ?? 'nao_tocado';
        const tocou = situacao && situacao !== 'nao_tocado' && situacao !== de;

        const { rows } = await cli.query(`
          INSERT INTO prospeccao (contato_id, responsavel_id, situacao, canal_ultimo,
                                  retomar_em, observacoes, motivo_sem_fit,
                                  primeiro_toque, ultimo_toque, tentativas)
          VALUES ($1,$2,COALESCE($3,'nao_tocado'),$4,$5,$6,$7,
                  CASE WHEN $8 THEN now() END, CASE WHEN $8 THEN now() END, CASE WHEN $8 THEN 1 ELSE 0 END)
          ON CONFLICT (contato_id) DO UPDATE SET
            responsavel_id = EXCLUDED.responsavel_id,
            situacao       = COALESCE(EXCLUDED.situacao, prospeccao.situacao),
            canal_ultimo   = COALESCE(EXCLUDED.canal_ultimo, prospeccao.canal_ultimo),
            retomar_em     = EXCLUDED.retomar_em,
            observacoes    = COALESCE(EXCLUDED.observacoes, prospeccao.observacoes),
            motivo_sem_fit = COALESCE(EXCLUDED.motivo_sem_fit, prospeccao.motivo_sem_fit),
            primeiro_toque = COALESCE(prospeccao.primeiro_toque, EXCLUDED.primeiro_toque),
            ultimo_toque   = COALESCE(EXCLUDED.ultimo_toque, prospeccao.ultimo_toque),
            tentativas     = prospeccao.tentativas + CASE WHEN $8 THEN 1 ELSE 0 END
          RETURNING *`,
          [req.params.id, req.user.id, situacao ?? null, canal_ultimo ?? null,
           retomar_em ?? null, observacoes ?? null, motivo_sem_fit ?? null, !!tocou]);

        if (situacao && situacao !== de)
          await cli.query(`INSERT INTO interacao (contato_id, usuario_id, tipo, canal, situacao_de, situacao_para, conteudo)
                           VALUES ($1,$2,'mudanca_status',$3,$4,$5,$6)`,
            [req.params.id, req.user.id, canal_ultimo ?? null, de, situacao, observacoes ?? null]);

        return rows[0];
      });
    });

  /** marcação em lote, direto da tabela */
  app.post('/prospeccao/lote', { preHandler: app.exigePapel(['admin','operador']) },
    async (req, reply) => {
      const { contatos, situacao, canal_ultimo, retomar_em } = req.body || {};
      if (!Array.isArray(contatos) || !contatos.length)
        return reply.code(400).send({ erro: 'lista_vazia', mensagem: 'Informe ao menos um contato.' });
      if (!SITUACOES.includes(situacao))
        return reply.code(400).send({ erro: 'situacao_invalida', mensagem: `Use uma de: ${SITUACOES.join(', ')}` });

      return emTransacao(async (cli) => {
        const { rows } = await cli.query(`
          INSERT INTO prospeccao (contato_id, responsavel_id, situacao, canal_ultimo, retomar_em,
                                  primeiro_toque, ultimo_toque, tentativas)
          SELECT id, $2, $3, $4, $5, now(), now(), 1 FROM unnest($1::uuid[]) AS t(id)
          ON CONFLICT (contato_id) DO UPDATE SET
            situacao = EXCLUDED.situacao, canal_ultimo = EXCLUDED.canal_ultimo,
            retomar_em = EXCLUDED.retomar_em, ultimo_toque = now(),
            tentativas = prospeccao.tentativas + 1
          RETURNING contato_id`,
          [contatos, req.user.id, situacao, canal_ultimo ?? null, retomar_em ?? null]);

        await cli.query(`INSERT INTO interacao (contato_id, usuario_id, tipo, canal, situacao_para)
                         SELECT id, $2, 'mudanca_status', $3, $4 FROM unnest($1::uuid[]) AS t(id)`,
          [contatos, req.user.id, canal_ultimo ?? null, situacao]);

        return { atualizados: rows.length };
      });
    });

  app.post('/contatos/:id/interacoes', { preHandler: app.exigePapel(['admin','operador']) },
    async (req) => {
      const { tipo, canal, assunto, conteudo, ocorrido_em } = req.body || {};
      const { rows } = await q(
        `INSERT INTO interacao (contato_id, usuario_id, tipo, canal, assunto, conteudo, ocorrido_em)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now())) RETURNING *`,
        [req.params.id, req.user.id, tipo, canal ?? null, assunto ?? null, conteudo ?? null, ocorrido_em ?? null]);
      await q(`UPDATE prospeccao SET ultimo_toque = now(), tentativas = tentativas + 1
               WHERE contato_id = $1`, [req.params.id]);
      return rows[0];
    });

  app.get('/filas/prioritaria', async (req) => {
    const limite = Math.min(Number(req.query.tamanho) || 50, 200);
    const { rows } = await q('SELECT * FROM v_fila_prioritaria LIMIT $1', [limite]);
    return { itens: rows };
  });

  app.get('/filas/retomadas', async () => {
    const { rows } = await q('SELECT * FROM v_retomadas');
    return { itens: rows };
  });
}
