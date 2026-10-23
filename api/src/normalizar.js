/* Regras de normalização — espelham o console em arquivo único.
   Ficam aqui no servidor para que importação e recálculo usem a MESMA lógica. */

export const sa = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export const low = (s) => sa(s).trim().toLowerCase();

/** chave de empresa: ignora acento, pontuação e sufixo societário */
const SUFIXOS = /\b(ltda|lda|s\s?a|sa|me|epp|eireli|mei|inc|llc|ltd|corp|corporation|co|cia|company|group|grupo|holding|participacoes|industria|comercio|e|do|da|de|dos|das)\b/g;
export const chaveEmpresa = (nome) =>
  low(nome).replace(/[^a-z0-9 ]/g, ' ').replace(SUFIXOS, ' ').replace(/\s+/g, ' ').trim();

export const chaveNomeEmpresa = (nome, empresa) =>
  `${low(nome).replace(/\s+/g, ' ')}|${chaveEmpresa(empresa)}`;
export const chaveEmailEmpresa = (email, empresa) =>
  email ? `${low(email)}|${chaveEmpresa(empresa)}` : null;

export function porteDe(n) {
  if (n == null) return ['Não informado', 10];
  if (n < 50) return ['Micro (< 50)', 5];
  if (n < 200) return ['Pequena (50–199)', 18];
  if (n < 1000) return ['Média (200–999)', 33];
  if (n < 5000) return ['Grande (1.000–4.999)', 35];
  if (n < 20000) return ['Corporação (5.000–19.999)', 28];
  return ['Mega corporação (20.000+)', 20];
}

export const UF_NOME = { AC:'Acre',AL:'Alagoas',AP:'Amapá',AM:'Amazonas',BA:'Bahia',CE:'Ceará',DF:'Distrito Federal',ES:'Espírito Santo',GO:'Goiás',MA:'Maranhão',MT:'Mato Grosso',MS:'Mato Grosso do Sul',MG:'Minas Gerais',PA:'Pará',PB:'Paraíba',PR:'Paraná',PE:'Pernambuco',PI:'Piauí',RJ:'Rio de Janeiro',RN:'Rio Grande do Norte',RS:'Rio Grande do Sul',RO:'Rondônia',RR:'Roraima',SC:'Santa Catarina',SP:'São Paulo',SE:'Sergipe',TO:'Tocantins' };
export const REGIAO = {};
for (const u of ['SP','RJ','MG','ES']) REGIAO[u] = 'Sudeste';
for (const u of ['PR','SC','RS']) REGIAO[u] = 'Sul';
for (const u of ['BA','SE','AL','PE','PB','RN','CE','PI','MA']) REGIAO[u] = 'Nordeste';
for (const u of ['MT','MS','GO','DF']) REGIAO[u] = 'Centro-Oeste';
for (const u of ['AM','PA','AC','RO','RR','AP','TO']) REGIAO[u] = 'Norte';

const UF = {};
for (const [sigla, nome] of Object.entries(UF_NOME)) {
  UF[low(nome)] = sigla;
  UF[low(sigla)] = sigla;
}
UF['federal district'] = 'DF';

export function ufDe(estado) {
  let s = low(estado);
  if (!s) return null;
  s = s.replace(/[.;]/g, ' ')
       .replace(/\b(brasil|brazil|br)\b/g, ' ')
       .replace(/^state of /, '').replace(/^estado (de |do |da )/, '')
       .replace(/ state$/, '').replace(/ province$/, '')
       .trim().replace(/^[,\-/]+|[,\-/]+$/g, '').trim();
  if (UF[s]) return UF[s];
  for (const p of s.split(/[,/()\-|]+/).map((x) => x.trim()).filter(Boolean))
    if (UF[p]) return UF[p];
  return null;
}

/** Pesos padrão — sobrescritos pela linha ativa de peso_score. */
export const PESOS_PADRAO = { cargo: 30, porte: 35, setor: 20, geo: 10, contato: 5, bonus_ti: 4 };

export function pontuar(partes, pesos = PESOS_PADRAO) {
  const bruto = partes.cargo + partes.porte + partes.setor + partes.geo + partes.contato + (partes.bonus_ti || 0);
  return Math.max(0, Math.min(100, Math.round(bruto)));
}

export function prioridadeDe(score, { modo_corte = 'fixo', corte_a = 86, corte_b = 72 } = {}, distribuicao = null) {
  if (modo_corte === 'percentil' && distribuicao) {
    // corte_a e corte_b são percentis (ex.: 75 e 30) calculados sobre a base carregada
    if (score >= distribuicao.p_a) return 'A';
    if (score >= distribuicao.p_b) return 'B';
    return 'C';
  }
  if (score >= corte_a) return 'A';
  if (score >= corte_b) return 'B';
  return 'C';
}
