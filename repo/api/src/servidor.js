import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { pool } from './db.js';
import rotasAuth from './rotas/auth.js';
import rotasContatos from './rotas/contatos.js';
import rotasProspeccao from './rotas/prospeccao.js';
import rotasEmpresas from './rotas/empresas.js';

const app = Fastify({ logger: true, bodyLimit: 20 * 1024 * 1024 });

const origens = (process.env.ORIGENS_PERMITIDAS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

await app.register(cors, {
  origin: (origem, cb) => {
    // requisições sem Origin (curl, health check) passam
    if (!origem || origens.includes(origem)) return cb(null, true);
    cb(new Error('origem não permitida'), false);
  },
  credentials: true,
});

if (!process.env.JWT_SECRET) {
  app.log.error('JWT_SECRET não definido — gere com: openssl rand -base64 48');
  process.exit(1);
}
await app.register(jwt, { secret: process.env.JWT_SECRET, sign: { expiresIn: '12h' } });
await app.register(multipart, { limits: { fileSize: 30 * 1024 * 1024 } });

/** exige token; use como preHandler */
app.decorate('autenticar', async (req, reply) => {
  try { await req.jwtVerify(); }
  catch { reply.code(401).send({ erro: 'nao_autenticado', mensagem: 'Faça login novamente.' }); }
});

/** exige papel mínimo */
app.decorate('exigePapel', (papeis) => async (req, reply) => {
  if (!papeis.includes(req.user?.papel))
    reply.code(403).send({ erro: 'sem_permissao', mensagem: 'Seu perfil não permite esta operação.' });
});

app.get('/api/saude', async () => {
  let banco = 'erro';
  try { await pool.query('SELECT 1'); banco = 'ok'; } catch { /* reportado abaixo */ }
  return { status: banco === 'ok' ? 'ok' : 'degradado', banco, versao: '0.1.0' };
});

await app.register(rotasAuth,       { prefix: '/api/auth' });
await app.register(rotasContatos,   { prefix: '/api/contatos' });
await app.register(rotasProspeccao, { prefix: '/api' });
await app.register(rotasEmpresas,   { prefix: '/api/empresas' });

app.setErrorHandler((err, req, reply) => {
  req.log.error(err);
  const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
  reply.code(status).send({
    erro: err.code || 'erro_interno',
    mensagem: status === 500 ? 'Erro interno.' : err.message,
  });
});

const porta = Number(process.env.PORT || 3000);
await app.listen({ port: porta, host: '0.0.0.0' });
