#!/usr/bin/env node
/* Cria o primeiro usuário. A senha é pedida pelo terminal, nunca vem por argumento
   — argumento fica no histórico do shell e na lista de processos. */
import bcrypt from 'bcryptjs';
import readline from 'node:readline/promises';
import { q, pool } from './db.js';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const email = arg('email'), nome = arg('nome'), papel = arg('papel') || 'operador';

if (!email || !nome) {
  console.error('uso: node src/criar-usuario.js --email a@b.com --nome "Nome" [--papel admin]');
  process.exit(1);
}
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const senha = await rl.question('Senha (mínimo 12 caracteres): ');
rl.close();
if (senha.length < 12) { console.error('Senha curta demais.'); process.exit(1); }

const hash = await bcrypt.hash(senha, 12);
await q(`INSERT INTO usuario (email, nome, senha_hash, papel) VALUES ($1,$2,$3,$4)
         ON CONFLICT (email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash, papel = EXCLUDED.papel`,
  [email, nome, hash, papel]);
console.log(`Usuário ${email} criado/atualizado com papel ${papel}.`);
await pool.end();
