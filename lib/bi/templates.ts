// Modelos de dashboard (editáveis). Cada modelo declara os CAMPOS de que precisa: nada é associado por «parecer com o nome da coluna» —
// o usuário aponta qual coluna faz o papel de cada campo; sem os campos obrigatórios, o modelo diz que é incompatível.
import type { Aggregation, ChartType, DataType, Filter, FormatType, Grain, FormulaNode } from './engine';

export type RoleDef = { key: string; label: string; types: DataType[]; required: boolean; hint?: string };
export type ExtraDef = { key: string; label: string; hint?: string; requiredFor?: string[] };
export type Mapping = Record<string, string | undefined>; // papel → chave interna da coluna (c1..cn)
export type Extras = Record<string, string | undefined>;

type MetricStep =
  | { kind: 'agg'; agg: Aggregation; role?: string; filters?: (map: Mapping, extras: Extras) => Filter[] }
  | { kind: 'formula'; ast: (id: (key: string) => string) => FormulaNode; uses: string[] };
export type TemplateMetric = { key: string; name: string; format: FormatType; needs: string[]; step: MetricStep; description?: string };
export type TemplateWidget = { title: string; chart: ChartType; metrics: string[]; dim?: { role: string; grain?: Grain }; period?: string; w: number; h: number; needs: string[]; comparison?: boolean };
export type TemplateSpec = { key: string; name: string; description: string; disclaimer?: string; roles: RoleDef[]; extras?: ExtraDef[]; metrics: TemplateMetric[]; widgets: TemplateWidget[] };

const NUM: DataType[] = ['integer', 'decimal', 'currency'];
const TEXT: DataType[] = ['string'];
const DATE: DataType[] = ['date', 'timestamp'];
const div = (a: string, b: string, times100 = false) => (id: (k: string) => string): FormulaNode => {
  const d: FormulaNode = { op: 'div', l: { op: 'ref', metric: id(a) }, r: { op: 'ref', metric: id(b) } };
  return times100 ? { op: 'mul', l: d, r: { op: 'num', value: '100' } } : d;
};

export const TEMPLATES: TemplateSpec[] = [
  {
    key: 'comercial', name: 'Comercial', description: 'Receita observada, pedidos, ticket médio, evolução, canais e vendedores.',
    roles: [
      { key: 'date', label: 'Data da venda', types: DATE, required: true },
      { key: 'revenue', label: 'Valor da venda', types: NUM, required: true },
      { key: 'order', label: 'Número do pedido (texto)', types: TEXT, required: false, hint: 'Sem ele, «Pedidos» conta as linhas da planilha.' },
      { key: 'channel', label: 'Canal', types: TEXT, required: false },
      { key: 'seller', label: 'Vendedor', types: TEXT, required: false },
    ],
    metrics: [
      { key: 'revenue', name: 'Receita observada', format: 'currency', needs: ['revenue'], step: { kind: 'agg', agg: 'sum', role: 'revenue' }, description: 'Soma dos valores de venda do arquivo importado.' },
      { key: 'orders', name: 'Pedidos', format: 'integer', needs: [], step: { kind: 'agg', agg: 'count' }, description: 'Quantidade de linhas (pedidos) no período.' },
      { key: 'ticket', name: 'Ticket médio', format: 'currency', needs: ['revenue'], step: { kind: 'formula', uses: ['revenue', 'orders'], ast: div('revenue', 'orders') }, description: 'Receita observada ÷ pedidos.' },
    ],
    widgets: [
      { title: 'Receita observada', chart: 'kpi', metrics: ['revenue'], period: 'date', w: 4, h: 3, needs: ['revenue', 'date'], comparison: true },
      { title: 'Pedidos', chart: 'kpi', metrics: ['orders'], period: 'date', w: 4, h: 3, needs: ['date'], comparison: true },
      { title: 'Ticket médio', chart: 'kpi', metrics: ['ticket'], period: 'date', w: 4, h: 3, needs: ['revenue', 'date'], comparison: true },
      { title: 'Evolução da receita por mês', chart: 'line', metrics: ['revenue'], dim: { role: 'date', grain: 'month' }, period: 'date', w: 8, h: 6, needs: ['revenue', 'date'] },
      { title: 'Receita por canal', chart: 'donut', metrics: ['revenue'], dim: { role: 'channel' }, period: 'date', w: 4, h: 6, needs: ['revenue', 'channel', 'date'] },
      { title: 'Receita por vendedor', chart: 'bar', metrics: ['revenue'], dim: { role: 'seller' }, period: 'date', w: 12, h: 6, needs: ['revenue', 'seller', 'date'] },
    ],
  },
  {
    key: 'financeiro', name: 'Financeiro gerencial', description: 'Receitas, despesas e resultado gerencial, por categoria e por mês.',
    disclaimer: 'Visão gerencial a partir dos dados importados: não substitui a contabilidade oficial nem apura tributos.',
    roles: [
      { key: 'date', label: 'Data / competência', types: DATE, required: true },
      { key: 'income', label: 'Valor de receita', types: NUM, required: false, hint: 'Informe ao menos receita ou despesa.' },
      { key: 'expense', label: 'Valor de despesa', types: NUM, required: false },
      { key: 'category', label: 'Categoria', types: TEXT, required: false },
    ],
    metrics: [
      { key: 'income', name: 'Receitas', format: 'currency', needs: ['income'], step: { kind: 'agg', agg: 'sum', role: 'income' } },
      { key: 'expense', name: 'Despesas', format: 'currency', needs: ['expense'], step: { kind: 'agg', agg: 'sum', role: 'expense' } },
      { key: 'result', name: 'Resultado gerencial', format: 'currency', needs: ['income', 'expense'], step: { kind: 'formula', uses: ['income', 'expense'], ast: (id) => ({ op: 'sub', l: { op: 'ref', metric: id('income') }, r: { op: 'ref', metric: id('expense') } }) }, description: 'Receitas − despesas, como informadas no arquivo.' },
    ],
    widgets: [
      { title: 'Receitas', chart: 'kpi', metrics: ['income'], period: 'date', w: 4, h: 3, needs: ['income', 'date'], comparison: true },
      { title: 'Despesas', chart: 'kpi', metrics: ['expense'], period: 'date', w: 4, h: 3, needs: ['expense', 'date'], comparison: true },
      { title: 'Resultado gerencial', chart: 'kpi', metrics: ['result'], period: 'date', w: 4, h: 3, needs: ['income', 'expense', 'date'], comparison: true },
      { title: 'Receitas e despesas por mês', chart: 'combo', metrics: ['income', 'expense'], dim: { role: 'date', grain: 'month' }, period: 'date', w: 8, h: 6, needs: ['income', 'expense', 'date'] },
      { title: 'Despesas por categoria', chart: 'bar', metrics: ['expense'], dim: { role: 'category' }, period: 'date', w: 4, h: 6, needs: ['expense', 'category', 'date'] },
    ],
  },
  {
    key: 'marketing', name: 'Marketing', description: 'Investimento, leads, custo por lead, conversões, custo por aquisição e (se houver receita) ROAS.',
    roles: [
      { key: 'date', label: 'Data', types: DATE, required: true },
      { key: 'spend', label: 'Investimento', types: NUM, required: true },
      { key: 'leads', label: 'Leads', types: NUM, required: true },
      { key: 'conversions', label: 'Conversões', types: NUM, required: false },
      { key: 'revenue', label: 'Receita atribuída', types: NUM, required: false, hint: 'Sem ela, o ROAS não é calculado.' },
      { key: 'campaign', label: 'Campanha / canal', types: TEXT, required: false },
    ],
    metrics: [
      { key: 'spend', name: 'Investimento', format: 'currency', needs: ['spend'], step: { kind: 'agg', agg: 'sum', role: 'spend' } },
      { key: 'leads', name: 'Leads', format: 'integer', needs: ['leads'], step: { kind: 'agg', agg: 'sum', role: 'leads' } },
      { key: 'cpl', name: 'Custo por lead (CPL)', format: 'currency', needs: ['spend', 'leads'], step: { kind: 'formula', uses: ['spend', 'leads'], ast: div('spend', 'leads') }, description: 'Investimento ÷ leads.' },
      { key: 'conv', name: 'Conversões', format: 'integer', needs: ['conversions'], step: { kind: 'agg', agg: 'sum', role: 'conversions' } },
      { key: 'cpa', name: 'Custo por aquisição (CPA)', format: 'currency', needs: ['spend', 'conversions'], step: { kind: 'formula', uses: ['spend', 'conv'], ast: div('spend', 'conv') }, description: 'Investimento ÷ conversões.' },
      { key: 'rev', name: 'Receita atribuída', format: 'currency', needs: ['revenue'], step: { kind: 'agg', agg: 'sum', role: 'revenue' } },
      { key: 'roas', name: 'ROAS', format: 'decimal', needs: ['spend', 'revenue'], step: { kind: 'formula', uses: ['rev', 'spend'], ast: div('rev', 'spend') }, description: 'Receita atribuída ÷ investimento (só com receita informada).' },
    ],
    widgets: [
      { title: 'Investimento', chart: 'kpi', metrics: ['spend'], period: 'date', w: 3, h: 3, needs: ['spend', 'date'], comparison: true },
      { title: 'Leads', chart: 'kpi', metrics: ['leads'], period: 'date', w: 3, h: 3, needs: ['leads', 'date'], comparison: true },
      { title: 'CPL', chart: 'kpi', metrics: ['cpl'], period: 'date', w: 3, h: 3, needs: ['spend', 'leads', 'date'], comparison: true },
      { title: 'CPA', chart: 'kpi', metrics: ['cpa'], period: 'date', w: 3, h: 3, needs: ['spend', 'conversions', 'date'], comparison: true },
      { title: 'ROAS', chart: 'kpi', metrics: ['roas'], period: 'date', w: 3, h: 3, needs: ['spend', 'revenue', 'date'], comparison: true },
      { title: 'Investimento por mês', chart: 'area', metrics: ['spend'], dim: { role: 'date', grain: 'month' }, period: 'date', w: 8, h: 6, needs: ['spend', 'date'] },
      { title: 'Leads por campanha', chart: 'bar', metrics: ['leads'], dim: { role: 'campaign' }, period: 'date', w: 4, h: 6, needs: ['leads', 'campaign', 'date'] },
    ],
  },
  {
    key: 'operacoes', name: 'Operações', description: 'Volume de solicitações, conclusões, atrasos, tempo médio e produtividade por responsável.',
    roles: [
      { key: 'date', label: 'Data de abertura', types: DATE, required: true },
      { key: 'status', label: 'Situação', types: TEXT, required: false, hint: 'Necessária para contar conclusões.' },
      { key: 'duration', label: 'Tempo de resolução (número)', types: NUM, required: false },
      { key: 'late', label: 'Atraso (1 = atrasada, 0 = no prazo)', types: NUM, required: false },
      { key: 'owner', label: 'Responsável', types: TEXT, required: false },
    ],
    extras: [{ key: 'done_value', label: 'Valor da «Situação» que significa concluída (ex.: Concluído)', requiredFor: ['status'] }],
    metrics: [
      { key: 'volume', name: 'Solicitações', format: 'integer', needs: [], step: { kind: 'agg', agg: 'count' } },
      { key: 'done', name: 'Concluídas', format: 'integer', needs: ['status'], step: { kind: 'agg', agg: 'count', filters: (m, e) => (m.status && e.done_value ? [{ field: m.status, op: 'eq', value: e.done_value }] : []) } },
      { key: 'rate', name: 'Taxa de conclusão (%)', format: 'percentage', needs: ['status'], step: { kind: 'formula', uses: ['done', 'volume'], ast: div('done', 'volume', true) }, description: 'Concluídas ÷ solicitações × 100.' },
      { key: 'late', name: 'Atrasos', format: 'integer', needs: ['late'], step: { kind: 'agg', agg: 'sum', role: 'late' } },
      { key: 'avgtime', name: 'Tempo médio de resolução', format: 'decimal', needs: ['duration'], step: { kind: 'agg', agg: 'avg', role: 'duration' } },
    ],
    widgets: [
      { title: 'Solicitações', chart: 'kpi', metrics: ['volume'], period: 'date', w: 3, h: 3, needs: ['date'], comparison: true },
      { title: 'Concluídas', chart: 'kpi', metrics: ['done'], period: 'date', w: 3, h: 3, needs: ['status', 'date'], comparison: true },
      { title: 'Atrasos', chart: 'kpi', metrics: ['late'], period: 'date', w: 3, h: 3, needs: ['late', 'date'], comparison: true },
      { title: 'Tempo médio', chart: 'kpi', metrics: ['avgtime'], period: 'date', w: 3, h: 3, needs: ['duration', 'date'], comparison: true },
      { title: 'Solicitações por mês', chart: 'line', metrics: ['volume'], dim: { role: 'date', grain: 'month' }, period: 'date', w: 8, h: 6, needs: ['date'] },
      { title: 'Concluídas por responsável', chart: 'bar', metrics: ['done'], dim: { role: 'owner' }, period: 'date', w: 4, h: 6, needs: ['status', 'owner', 'date'] },
    ],
  },
  {
    key: 'executivo', name: 'Gestão executiva', description: 'Você escolhe os indicadores principais; o modelo monta cartões com variação, metas e avisos de atualização.',
    roles: [{ key: 'date', label: 'Coluna de data usada no período', types: DATE, required: true }],
    metrics: [], widgets: [],
  },
];

export const templateByKey = (k: string) => TEMPLATES.find((t) => t.key === k);

/** Plano de montagem: o que dá para criar com os campos informados e o que fica de fora (e por quê). */
export function planTemplate(spec: TemplateSpec, map: Mapping, extras: Extras) {
  const has = (k: string) => Boolean(map[k]);
  const missingRequired = spec.roles.filter((r) => r.required && !has(r.key)).map((r) => r.label);
  const needExtras = (spec.extras ?? []).filter((x) => x.requiredFor?.some(has) && !extras[x.key]).map((x) => x.label);
  const okMetric = new Set<string>();
  const metrics = spec.metrics.filter((m) => {
    const ok = m.needs.every(has) && (m.step.kind === 'agg' ? true : m.step.uses.every((u) => okMetric.has(u))) && !(m.step.kind === 'agg' && m.key === 'done' && !extras.done_value);
    if (ok) okMetric.add(m.key);
    return ok;
  });
  const widgets = spec.widgets.filter((w) => w.needs.every(has) && w.metrics.every((k) => okMetric.has(k)));
  const skipped = spec.widgets.filter((w) => !widgets.includes(w)).map((w) => w.title);
  return { missingRequired, needExtras, metrics, widgets, skipped };
}
