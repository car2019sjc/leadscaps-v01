# Contrato da API — LeadsCaps v0.1

Base: `https://{DOMINIO_API}/api`
Autenticação: `Authorization: Bearer <jwt>` em tudo, exceto `/auth/login` e `/saude`.
Formato: JSON, UTF-8. Datas em ISO 8601 com fuso.

Erros seguem sempre o mesmo formato:

```json
{ "erro": "credenciais_invalidas", "mensagem": "E-mail ou senha incorretos." }
```

| HTTP | Quando |
|---|---|
| 400 | corpo inválido ou parâmetro fora do domínio |
| 401 | sem token ou token expirado |
| 403 | papel sem permissão para a operação |
| 404 | recurso inexistente |
| 409 | conflito de deduplicação |
| 422 | arquivo de importação ilegível |

---

## Autenticação

### `POST /auth/login`
```json
{ "email": "carlos.rodrigues@onset.com.br", "senha": "..." }
```
→ `{ "token": "...", "expira_em": "...", "usuario": { "id", "nome", "papel" } }`

### `GET /auth/eu`
Devolve o usuário do token.

---

## Contatos

### `GET /contatos`
Todos os filtros do console atual, combináveis. Ausente = sem filtro.

| Parâmetro | Tipo | Observação |
|---|---|---|
| `q` | texto | busca em nome, cargo, empresa, e-mail |
| `prioridade` | `A,B,C` | múltiplos separados por vírgula |
| `familia` | lista | família do cargo |
| `setor` | lista | |
| `porte` | lista | |
| `uf` | lista | |
| `municipio` | lista | |
| `papel_ti` | `decisor,influenciador,nao` | |
| `situacao` | lista | status de prospecção |
| `func_min` / `func_max` | inteiro | faixa de funcionários |
| `fat_min` / `fat_max` | inteiro | faturamento USD |
| `excluir_familia` | lista | filtro negativo |
| `excluir_setor` | lista | filtro negativo |
| `excluir_cargo_contem` | lista | termos no cargo bruto |
| `so_email_corporativo` | bool | |
| `so_com_linkedin` | bool | |
| `um_por_empresa` | bool | mantém o de maior score |
| `ordenar` | `score,-score,nome,empresa,funcionarios` | |
| `pagina` / `tamanho` | inteiro | tamanho máximo 200 |

→
```json
{
  "total": 4516,
  "pagina": 1,
  "tamanho": 50,
  "itens": [ { "id": "...", "nome": "...", "cargo": "...", "empresa": { "id", "nome", "setor", "porte" },
               "email": "...", "papel_ti": "decisor", "score_icp": 94, "prioridade": "A",
               "prospeccao": { "situacao": "abordado", "ultimo_toque": "..." } } ]
}
```

### `GET /contatos/:id`
Contato completo, com empresa, prospecção, últimas interações e análises de IA.

### `GET /contatos/facetas`
Contagens por dimensão **para o filtro atual**, excluindo a própria dimensão —
é o que alimenta os painéis laterais e o mapa sem zerar ao selecionar um estado.

→ `{ "familia": {...}, "setor": {...}, "uf": {...}, "porte": {...}, "prioridade": {...} }`

### `POST /contatos` · `PATCH /contatos/:id` · `DELETE /contatos/:id`
Papel `operador` ou `admin`.

---

## Prospecção

### `PUT /contatos/:id/prospeccao`
```json
{ "situacao": "abordado", "canal_ultimo": "email",
  "retomar_em": "2026-12-01", "observacoes": "..." }
```
Toda mudança de situação grava automaticamente uma `interacao` do tipo
`mudanca_status` com o antes e o depois. Nada é sobrescrito em silêncio.

### `POST /contatos/:id/interacoes`
```json
{ "tipo": "email_enviado", "canal": "email", "assunto": "...", "conteudo": "..." }
```

### `GET /filas/prioritaria` · `GET /filas/retomadas`
Fila do dia e o que volta nos próximos 7 dias.

### `POST /prospeccao/lote`
Marca várias linhas de uma vez, direto da tabela.
```json
{ "contatos": ["uuid", "..."], "situacao": "abordado", "canal_ultimo": "email" }
```

---

## Contas

### `GET /empresas`
Filtros: `q`, `setor`, `uf`, `porte`, `situacao`, `sem_decisor_ti=true`.
Devolve o mapa de poder: contatos, decisores de TI, influenciadores, melhor score,
quantos já foram tocados.

### `GET /empresas/:id`
Empresa, seus contatos ordenados por score e o histórico de interações da conta.

### `PATCH /empresas/:id`
Altera `situacao` e `observacoes` da conta.

---

## Importação

### `POST /importacoes` · `multipart/form-data`
Campos: `arquivo` (csv/xlsx), `modo` (`substituir` | `acrescentar`).

A normalização roda no servidor, com as mesmas regras do console:
famílias de cargo, setor, porte, UF, região, score e deduplicação por
**mesma pessoa na mesma empresa**. As colunas curadas da planilha
(`Decisor de TI`, `Cargo normalizado`) têm precedência sobre o cálculo automático.

→
```json
{ "importacao_id": "...", "linhas_lidas": 4516, "novos": 312, "atualizados": 18,
  "ignorados": 4186, "mapeamento": { "title": "Cargo", "...": "..." },
  "avisos": ["Coluna de faturamento não encontrada"] }
}
```

### `GET /importacoes`
Histórico das cargas.

---

## Análise de IA

### `POST /ia/dossie`
```json
{ "contato_id": "..." }
```
A chave da Anthropic fica no servidor. A resposta é gravada em `analise_ia` e
reaproveitada: se já existe análise da mesma empresa com menos de N dias,
devolve a existente com `"do_cache": true` em vez de pagar de novo.

### `POST /ia/pesquisa`
```json
{ "empresas": ["Embraer", "Akaer"], "pergunta": "..." }
```

### `GET /ia/analises?empresa_id=...`
Histórico de análises, para não pesquisar duas vezes a mesma conta.

---

## Score

### `GET /score/pesos` · `PUT /score/pesos`
```json
{ "nome": "padrao", "pesos": { "cargo": 30, "porte": 35, "setor": 20, "geo": 10, "contato": 5 },
  "modo_corte": "percentil", "corte_a": 75, "corte_b": 30 }
```

### `POST /score/recalcular`
Reaplica os pesos sobre toda a base. Devolve a nova distribuição por prioridade
antes de confirmar — assim dá para ver o efeito do ajuste sem destruir o anterior.

---

## Exportação

### `GET /exportar?formato=xlsx|csv&...`
Aceita os mesmos filtros de `/contatos`. Devolve o arquivo com as abas
Contatos, Resumo por segmento e Empresas, como no console atual.

---

## Saúde

### `GET /saude`
→ `{ "status": "ok", "banco": "ok", "versao": "0.1.0" }`
