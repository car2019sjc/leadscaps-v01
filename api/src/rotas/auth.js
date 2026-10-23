import bcrypt from 'bcryptjs';
import { q } from '../db.js';

export default async function (app) {
  app.post('/login', async (req, reply) => {
    const { email, senha } = req.body || {};
    if (!email || !senha)
      return reply.code(400).send({ erro: 'dados_incompletos', mensagem: 'Informe e-mail e senha.' });

    const { rows } = await q(
      'SELECT id, nome, email, senha_hash, papel, ativo FROM usuario WHERE lower(email) = lower($1)',
      [email]);
    const u = rows[0];
    // mesma resposta para usuário inexistente e senha errada — não revela quem existe
    if (!u || !u.ativo || !(await bcrypt.compare(senha, u.senha_hash)))
      return reply.code(401).send({ erro: 'credenciais_invalidas', mensagem: 'E-mail ou senha incorretos.' });

    await q('UPDATE usuario SET ultimo_acesso = now() WHERE id = $1', [u.id]);
    const token = app.jwt.sign({ id: u.id, nome: u.nome, papel: u.papel });
    return { token, usuario: { id: u.id, nome: u.nome, email: u.email, papel: u.papel } };
  });

  app.get('/eu', { preHandler: app.autenticar }, async (req) => ({ usuario: req.user }));
}
