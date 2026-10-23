# LeadsCaps

Console de prospecção B2B da OnSet Tecnologia — base de decisores, pontuação ICP,
mapa geográfico, status de prospecção e análise de empresa com IA.

Este repositório contém a versão servidor. O console em arquivo único
(`OnSet_Console_Decisores.html`) continua funcionando offline e segue sendo a
origem das regras de normalização.

## Arquitetura

```
Netlify (frontend estático)  ──HTTPS──▶  Caddy  ──▶  API Node  ──▶  PostgreSQL
                                          │
                                          └ TLS automático (Let's Encrypt)
```

- **Banco e API não publicam portas.** Só o Caddy fala com a internet.
- **Chaves da Anthropic e do Apollo vivem no servidor**, nunca no navegador.
- **Autenticação obrigatória**: a base contém dado pessoal de terceiros (LGPD).

## Estrutura

```
db/001_schema.sql     esquema do Postgres (roda sozinho no primeiro boot)
api/                  API Node + Fastify
infra/                docker-compose e Caddyfile
docs/API.md           contrato da API
```

## Subir na VPS

Pré-requisitos: Docker e Docker Compose, e um **domínio já apontando para o IP
da VPS** — sem isso o Caddy não consegue emitir o certificado.

```bash
git clone https://github.com/car2019sjc/leadscaps-v01.git
cd leadscaps-v01
cp .env.example .env
nano .env                       # preencha senha, domínio, segredo e chaves
openssl rand -base64 48         # use a saída como JWT_SECRET

cd infra
docker compose --env-file ../.env up -d
docker compose logs -f api
```

Verificação:

```bash
curl https://SEU_DOMINIO/api/saude
```

Primeiro usuário:

```bash
docker compose exec api node src/criar-usuario.js \
  --email seu@email.com --nome "Seu Nome" --papel admin
```

## Frontend no Netlify

O build gera uma pasta estática. Arraste para o Netlify e defina a variável
`VITE_API_URL` apontando para `https://SEU_DOMINIO/api`. Depois adicione a
origem do Netlify em `ORIGENS_PERMITIDAS` no `.env` e reinicie a API.

## Antes de expor a máquina

A VPS está acessível como `root` por senha. Recomendação, em ordem:

1. Criar usuário comum e dar acesso por chave SSH
2. Desabilitar login de root e autenticação por senha em `/etc/ssh/sshd_config`
3. Firewall liberando apenas 22, 80 e 443
4. `fail2ban` para o SSH

Root com senha é o primeiro alvo de qualquer varredura automatizada.

## Backup

```bash
docker compose exec db pg_dump -U leadscaps leadscaps | gzip > backup-$(date +%F).sql.gz
```

Agende no cron. A base é o ativo; o código se reconstrói.
