-- ============================================================
--  LeadsCaps · esquema inicial
--  Postgres 16+
--  Convenção: nomes em português, singular para tabela de domínio.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "unaccent";    -- busca sem acento
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- busca por similaridade

-- unaccent() é STABLE, não IMMUTABLE, e por isso não pode ir direto em índice.
-- Este invólucro fixa o dicionário e declara a imutabilidade, que é o padrão
-- recomendado. Use SEMPRE f_unaccent() nas consultas, para o índice ser usado.
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- ------------------------------------------------------------
-- Acesso
-- ------------------------------------------------------------
CREATE TABLE usuario (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  nome          text NOT NULL,
  senha_hash    text NOT NULL,
  papel         text NOT NULL DEFAULT 'operador'
                CHECK (papel IN ('admin', 'operador', 'leitor')),
  ativo         boolean NOT NULL DEFAULT true,
  ultimo_acesso timestamptz,
  criado_em     timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Empresa (conta)
-- ------------------------------------------------------------
CREATE TABLE empresa (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            text NOT NULL,
  nome_chave      text NOT NULL,          -- normalizado p/ deduplicação
  dominio         text,
  setor           text,
  funcionarios    integer,
  porte           text,                   -- derivado de funcionarios
  faturamento_usd bigint,
  municipio       text,
  estado          text,
  uf              char(2),
  regiao          text,
  linkedin_url    text,
  -- status comercial da CONTA (independente do contato)
  situacao        text NOT NULL DEFAULT 'nao_trabalhada'
                  CHECK (situacao IN ('nao_trabalhada','em_prospeccao','em_negociacao',
                                      'cliente','sem_fit','pausada')),
  observacoes     text,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT empresa_nome_chave_unica UNIQUE (nome_chave)
);

CREATE INDEX empresa_uf_idx        ON empresa (uf);
CREATE INDEX empresa_setor_idx     ON empresa (setor);
CREATE INDEX empresa_situacao_idx  ON empresa (situacao);
CREATE INDEX empresa_nome_trgm_idx ON empresa USING gin (nome gin_trgm_ops);

-- ------------------------------------------------------------
-- Contato
-- ------------------------------------------------------------
CREATE TABLE contato (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,

  nome             text NOT NULL,
  cargo            text,
  cargo_normalizado text,                 -- quando a planilha traz
  familia_cargo    text,                  -- CEO / Presidente, CFO / Financeiro, ...
  senioridade      text,
  departamentos    text[] NOT NULL DEFAULT '{}',

  email            text,
  dominio_email    text,
  email_corporativo boolean NOT NULL DEFAULT false,
  email_status     text,                  -- verified | extrapolated | unavailable
  telefone         text,
  linkedin_url     text,

  municipio        text,
  estado           text,
  uf               char(2),
  regiao           text,

  -- sinal de TI com três estados, como na planilha curada
  papel_ti         text NOT NULL DEFAULT 'nao'
                   CHECK (papel_ti IN ('decisor','influenciador','nao')),

  score_icp        smallint CHECK (score_icp BETWEEN 0 AND 100),
  prioridade       char(1)  CHECK (prioridade IN ('A','B','C')),
  score_detalhe    jsonb,                 -- {cargo:30, porte:35, setor:20, ...}

  -- chaves de deduplicação: mesma pessoa na MESMA empresa
  chave_nome_emp   text NOT NULL,
  chave_email_emp  text,

  origem           text,                  -- apollo | manual | importacao
  importacao_id    uuid,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX contato_chave_nome_emp_idx  ON contato (chave_nome_emp);
CREATE UNIQUE INDEX contato_chave_email_emp_idx ON contato (chave_email_emp)
       WHERE chave_email_emp IS NOT NULL;
CREATE INDEX contato_empresa_idx    ON contato (empresa_id);
CREATE INDEX contato_familia_idx    ON contato (familia_cargo);
CREATE INDEX contato_uf_idx         ON contato (uf);
CREATE INDEX contato_prioridade_idx ON contato (prioridade);
CREATE INDEX contato_papel_ti_idx   ON contato (papel_ti);
CREATE INDEX contato_email_idx      ON contato (lower(email));
CREATE INDEX contato_busca_idx      ON contato USING gin
       ((f_unaccent(nome) || ' ' || f_unaccent(coalesce(cargo,''))) gin_trgm_ops);

-- ------------------------------------------------------------
-- Status de prospecção — o que faltava no app
-- ------------------------------------------------------------
CREATE TABLE prospeccao (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id     uuid NOT NULL UNIQUE REFERENCES contato(id) ON DELETE CASCADE,
  responsavel_id uuid REFERENCES usuario(id) ON DELETE SET NULL,

  situacao       text NOT NULL DEFAULT 'nao_tocado'
                 CHECK (situacao IN ('nao_tocado','abordado','respondeu','reuniao_marcada',
                                     'reuniao_realizada','proposta_enviada','ganho',
                                     'sem_fit','sem_resposta','retomar')),
  canal_ultimo   text CHECK (canal_ultimo IN ('email','linkedin','telefone','evento','indicacao')),
  tentativas     smallint NOT NULL DEFAULT 0,
  primeiro_toque timestamptz,
  ultimo_toque   timestamptz,
  retomar_em     date,                    -- alimenta a fila "volta esta semana"
  motivo_sem_fit text,
  observacoes    text,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX prospeccao_situacao_idx   ON prospeccao (situacao);
CREATE INDEX prospeccao_retomar_idx    ON prospeccao (retomar_em) WHERE retomar_em IS NOT NULL;
CREATE INDEX prospeccao_responsavel_idx ON prospeccao (responsavel_id);

-- histórico: cada toque vira uma linha, nunca sobrescreve
CREATE TABLE interacao (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id  uuid NOT NULL REFERENCES contato(id) ON DELETE CASCADE,
  usuario_id  uuid REFERENCES usuario(id) ON DELETE SET NULL,
  tipo        text NOT NULL CHECK (tipo IN ('email_enviado','email_respondido','linkedin',
                                            'ligacao','reuniao','nota','mudanca_status')),
  canal       text,
  assunto     text,
  conteudo    text,
  situacao_de text,
  situacao_para text,
  ocorrido_em timestamptz NOT NULL DEFAULT now(),
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX interacao_contato_idx ON interacao (contato_id, ocorrido_em DESC);

-- ------------------------------------------------------------
-- Análises de IA — deixam de ser descartáveis
-- ------------------------------------------------------------
CREATE TABLE analise_ia (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid REFERENCES empresa(id) ON DELETE CASCADE,
  contato_id   uuid REFERENCES contato(id) ON DELETE CASCADE,
  tipo         text NOT NULL CHECK (tipo IN ('dossie','pesquisa_empresa','pesquisa_grupo')),
  pergunta     text,
  resultado    jsonb NOT NULL,            -- o JSON estruturado devolvido pelo modelo
  fontes       jsonb NOT NULL DEFAULT '[]',
  confianca    text CHECK (confianca IN ('alta','media','baixa')),
  modelo       text,
  buscas_web   smallint,
  custo_tokens integer,
  gerado_por   uuid REFERENCES usuario(id) ON DELETE SET NULL,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analise_alvo_obrigatorio CHECK (empresa_id IS NOT NULL OR contato_id IS NOT NULL)
);

CREATE INDEX analise_empresa_idx ON analise_ia (empresa_id, criado_em DESC);
CREATE INDEX analise_contato_idx ON analise_ia (contato_id, criado_em DESC);

-- ------------------------------------------------------------
-- Importações — rastreia cada carga
-- ------------------------------------------------------------
CREATE TABLE importacao (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     uuid REFERENCES usuario(id) ON DELETE SET NULL,
  arquivo        text NOT NULL,
  modo           text NOT NULL CHECK (modo IN ('substituir','acrescentar')),
  linhas_lidas   integer NOT NULL DEFAULT 0,
  novos          integer NOT NULL DEFAULT 0,
  atualizados    integer NOT NULL DEFAULT 0,
  ignorados      integer NOT NULL DEFAULT 0,
  mapeamento     jsonb,                   -- colunas reconhecidas
  avisos         jsonb NOT NULL DEFAULT '[]',
  criado_em      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE contato
  ADD CONSTRAINT contato_importacao_fk
  FOREIGN KEY (importacao_id) REFERENCES importacao(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- Pesos do score — configuráveis, deixam de ser chute meu
-- ------------------------------------------------------------
CREATE TABLE peso_score (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         text NOT NULL UNIQUE,
  ativo        boolean NOT NULL DEFAULT false,
  pesos        jsonb NOT NULL,            -- {cargo:30, porte:35, setor:20, geo:10, contato:5}
  corte_a      smallint NOT NULL DEFAULT 86,
  corte_b      smallint NOT NULL DEFAULT 72,
  modo_corte   text NOT NULL DEFAULT 'fixo' CHECK (modo_corte IN ('fixo','percentil')),
  criado_em    timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- atualizado_em automático
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION toca_atualizado_em() RETURNS trigger AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER empresa_toca    BEFORE UPDATE ON empresa
  FOR EACH ROW EXECUTE FUNCTION toca_atualizado_em();
CREATE TRIGGER contato_toca    BEFORE UPDATE ON contato
  FOR EACH ROW EXECUTE FUNCTION toca_atualizado_em();
CREATE TRIGGER prospeccao_toca BEFORE UPDATE ON prospeccao
  FOR EACH ROW EXECUTE FUNCTION toca_atualizado_em();

-- ------------------------------------------------------------
-- Visões de trabalho
-- ------------------------------------------------------------

-- fila do dia: prioridade A ainda não tocada
CREATE VIEW v_fila_prioritaria AS
SELECT c.id, c.nome, c.cargo, c.familia_cargo, c.email, c.papel_ti,
       c.score_icp, c.prioridade, e.nome AS empresa, e.setor, e.porte, c.uf,
       COALESCE(p.situacao, 'nao_tocado') AS situacao
FROM contato c
JOIN empresa e ON e.id = c.empresa_id
LEFT JOIN prospeccao p ON p.contato_id = c.id
WHERE c.prioridade = 'A'
  AND COALESCE(p.situacao, 'nao_tocado') = 'nao_tocado'
  AND c.email IS NOT NULL
ORDER BY c.score_icp DESC;

-- contas e seu mapa de poder, com a lacuna de TI explícita
CREATE VIEW v_conta AS
SELECT e.id, e.nome, e.setor, e.porte, e.funcionarios, e.uf, e.situacao,
       count(c.id)                                              AS contatos,
       count(*) FILTER (WHERE c.papel_ti = 'decisor')            AS decisores_ti,
       count(*) FILTER (WHERE c.papel_ti = 'influenciador')      AS influenciadores_ti,
       count(*) FILTER (WHERE c.senioridade = 'C-Level')         AS c_level,
       max(c.score_icp)                                          AS melhor_score,
       count(*) FILTER (WHERE p.situacao IS NOT NULL
                          AND p.situacao <> 'nao_tocado')        AS ja_tocados,
       (count(*) FILTER (WHERE c.papel_ti = 'decisor') = 0)      AS sem_decisor_ti
FROM empresa e
LEFT JOIN contato c    ON c.empresa_id = e.id
LEFT JOIN prospeccao p ON p.contato_id = c.id
GROUP BY e.id;

-- o que volta esta semana
CREATE VIEW v_retomadas AS
SELECT c.id, c.nome, c.cargo, e.nome AS empresa, p.retomar_em, p.situacao,
       p.ultimo_toque, p.tentativas, p.observacoes
FROM prospeccao p
JOIN contato c ON c.id = p.contato_id
JOIN empresa e ON e.id = c.empresa_id
WHERE p.retomar_em IS NOT NULL AND p.retomar_em <= current_date + 7
ORDER BY p.retomar_em;
