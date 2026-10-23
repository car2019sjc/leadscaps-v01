# Modelo de dados — decisões e porquês

## Empresa é entidade, não texto repetido

No console em arquivo único, a empresa existe só como string em cada contato.
Isso impede status de conta, impede contar a lacuna de TI e faz "Embraer",
"Embraer S.A." e "EMBRAER LTDA" virarem três empresas.

Aqui `empresa` é tabela, com `nome_chave` normalizado e único. A normalização
ignora acento, pontuação e sufixo societário — a mesma regra do console.

## Deduplicação: mesma pessoa na MESMA empresa

Dois índices únicos fazem o trabalho:

- `chave_nome_emp`  = `nome|empresa_normalizada`
- `chave_email_emp` = `email|empresa_normalizada` (parcial, só quando há e-mail)

A mesma pessoa em empresas diferentes é mantida — trocou de emprego, ou acumula
cargos. Testado: inserir "Ana Lima" duas vezes na Embraer é rejeitado pelo banco;
inserir "Ana Lima" na Akaer passa.

A regra vive no banco, não na aplicação. Importação concorrente não cria duplicata.

## `papel_ti` com três estados

`decisor | influenciador | nao` — porque a sua planilha curada usa os três e o
booleano perdia a informação. A coluna da planilha tem precedência sobre o
cálculo automático por departamento.

## Status separado do contato

`prospeccao` é tabela à parte, 1-para-1 com `contato`. Motivos:

- contato é dado de mercado, status é dado seu. Reimportar a base não pode apagar o trabalho
- `LEFT JOIN` com `COALESCE(situacao,'nao_tocado')` dá o estado de quem nunca foi tocado sem criar linha

## Histórico nunca é sobrescrito

Toda mudança de situação grava uma linha em `interacao` com `situacao_de` e
`situacao_para`. A API faz isso dentro da mesma transação da atualização —
não dá para mudar status sem deixar rastro.

## Score configurável

`peso_score` guarda os pesos e os cortes em JSONB, com `modo_corte` fixo ou por
percentil. Resolve o problema de 64% da base cair em Prioridade A: no modo
percentil, A é sempre o quartil superior da base carregada.

`score_detalhe` guarda a decomposição por componente, para a ficha explicar
de onde veio a nota.

## Análises de IA são patrimônio

`analise_ia` guarda o JSON estruturado e as fontes. Antes de pagar uma nova
análise, a API procura uma recente da mesma empresa. A pesquisa deixa de ser
descartável.

## Views como contrato de leitura

`v_fila_prioritaria`, `v_conta` e `v_retomadas` concentram a lógica de negócio
no banco. A API vira uma casca fina, e a mesma consulta serve para relatório,
exportação e tela.

## Um detalhe que só apareceu rodando

`unaccent()` é STABLE, não IMMUTABLE, e o Postgres recusa índice sobre ela.
O schema cria `f_unaccent()` como invólucro imutável. **As consultas precisam
usar `f_unaccent()`** — chamar `unaccent()` direto funciona, mas ignora o índice
e faz varredura completa.
