#!/usr/bin/env node
// Teste de mutação das regras críticas (banco E motor TypeScript): quebra cada regra DE PROPÓSITO numa cópia do código
// e exige que a suíte reprove. Se alguma mutação sobreviver, falta teste.
//   suite 'db'   → pnpm test:db (testes SQL com fixtures à mão)
//   suite 'conc' → pnpm test:concurrency (sessões simultâneas reais; rode SEM outra carga na máquina)
//   suite 'unit' → vitest nos testes do motor (lib/bi)
// Cada mutação aponta para a definição VIVA (as migrações não redefinem funções umas das outras).
// Uso: node scripts/mutation-check.mjs [--only <trecho do nome>] [--jobs 3]
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const jobs = Number(args.includes('--jobs') ? args[args.indexOf('--jobs') + 1] : 3);

const E = 'lib/bi/engine/';
// { name, file (trecho do arquivo de migração) | ts (caminho do arquivo TS), find, replace, nth (qual ocorrência; omitido = única), suite }
const M = [
  // ---------------------------------------------------------------- motor TypeScript: leitura e tipagem
  { name: 'import: milhar fora do padrão aceito', ts: `${E}parse.ts`, suite: 'unit', find: "if (s.includes('.') && !BR_THOUSANDS.test(s)) return", replace: 'if (false) return' },
  { name: 'import: data inexistente aceita (31/02)', ts: `${E}parse.ts`, suite: 'unit', find: 't.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d', replace: 'true' },
  { name: 'import: deslocamento de fuso com sinal trocado', ts: `${E}parse.ts`, suite: 'unit', find: "const sign = min < 0 ? '-' : '+';", replace: "const sign = min < 0 ? '+' : '-';" },
  { name: 'import: inteiro com casas decimais aceito', ts: `${E}parse.ts`, suite: 'unit', find: "if (col.type === 'integer' && !new D(r.value).isInteger())", replace: 'if (false)' },
  { name: 'import: texto gigante aceito', ts: `${E}parse.ts`, suite: 'unit', find: 'if (v.length > MAX_STRING)', replace: 'if (false)' },
  { name: 'import: campo obrigatório vazio aceito', ts: `${E}parse.ts`, suite: 'unit', find: 'if (isBlank(raw)) return col.required ?', replace: 'if (isBlank(raw)) return false ?' },
  { name: 'import: série numérica do Excel fora do intervalo aceita', ts: `${E}parse.ts`, suite: 'unit', find: 'if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;', replace: 'if (!Number.isFinite(serial)) return null;' },
  { name: 'import: linha repetida pela chave não detectada', ts: `${E}ingest.ts`, suite: 'unit', find: 'if (keys.has(rowKey))', replace: 'if (false)' },
  { name: 'import: linha inválida entra no resultado', ts: `${E}ingest.ts`, suite: 'unit', find: 'if (bad) invalid++;', replace: 'if (false) invalid++;' },
  { name: 'import: chave vazia aceita', ts: `${E}ingest.ts`, suite: 'unit', find: 'if (parts.some((p) => p === null)) {', replace: 'if (false) {' },
  { name: 'xlsx: macros (VBA) aceitas', ts: `${E}xlsx.ts`, suite: 'unit', find: 'if (names.some((n) => /vbaProject/i.test(n.name))) throw', replace: 'if (false) throw' },
  { name: 'xlsx: zip bomb por parte aceito', ts: `${E}xlsx.ts`, suite: 'unit', find: 'if (names.some((n) => n.size > XLSX_LIMITS.sheetUncompressed)) throw', replace: 'if (false) throw' },
  { name: 'xlsx: zip bomb por total aceito', ts: `${E}xlsx.ts`, suite: 'unit', find: 'if (total > XLSX_LIMITS.totalUncompressed) throw', replace: 'if (false) throw' },
  { name: 'xlsx: percentual não multiplicado por 100', ts: `${E}xlsx.ts`, suite: 'unit', find: '.mul(100).toSignificantDigits(15)', replace: '.mul(1).toSignificantDigits(15)' },
  { name: 'xlsx: ruído binário do número não removido', ts: `${E}xlsx.ts`, suite: 'unit', find: 'd.toSignificantDigits(15).toFixed()', replace: 'd.toFixed()' },
  { name: 'arquivo: PDF aceito como texto', ts: `${E}files.ts`, suite: 'unit', find: 'if (bytes.length >= 5 && bytes[0] === 0x25', replace: 'if (false && bytes[0] === 0x25' },
  { name: 'arquivo: limite de linhas ignorado', ts: `${E}files.ts`, suite: 'unit', find: 'if (body.length > IMPORT_LIMITS.rows) throw', replace: 'if (false) throw' },
  { name: 'arquivo: extensão com macro aceita', ts: `${E}files.ts`, suite: 'unit', find: 'if (/^(xlsm|xlsb|xls|xltm|xlam)$/.test(ext))', replace: 'if (false)' },
  { name: 'arquivo: célula gigante aceita', ts: `${E}files.ts`, suite: 'unit', find: 'if (cell.length > IMPORT_LIMITS.cellChars) throw', replace: 'if (false) throw' },
  { name: 'inferência: número nativo vira data', ts: `${E}infer.ts`, suite: 'unit', find: "cells.some((c) => c?.t === 'n')) continue;", replace: 'false) continue;' },
  // ---------------------------------------------------------------- motor TypeScript: consulta, métricas, períodos, metas
  { name: 'consulta: operador fora do tipo aceito', ts: `${E}query.ts`, suite: 'unit', find: 'if (!opsFor(col.type).includes(f.op)) throw', replace: 'if (false) throw' },
  { name: 'consulta: período invertido aceito', ts: `${E}query.ts`, suite: 'unit', find: 'if (period.from > period.to) throw', replace: 'if (false) throw' },
  { name: 'consulta: limite sem teto', ts: `${E}query.ts`, suite: 'unit', find: 'const limit = Math.min(Math.max(Math.trunc(spec.limit ?? 500), 1), MAX_QUERY_LIMIT);', replace: 'const limit = Math.max(Math.trunc(spec.limit ?? 500), 1);' },
  { name: 'consulta: número fora do formato canônico aceito', ts: `${E}query.ts`, suite: 'unit', find: 'if (!/^-?\\d+(\\.\\d+)?$/.test(v) || !toDec(v)) throw', replace: 'if (false) throw' },
  { name: 'consulta: agregação incompatível com o tipo aceita', ts: `${E}query.ts`, suite: 'unit', find: 'if (!aggAllowed(m.agg, type)) throw', replace: 'if (false) throw' },
  { name: 'métrica: divisão por zero vira número', ts: `${E}metrics.ts`, suite: 'unit', find: "case 'div': return b.v.isZero() ? { fail: 'div_zero' } : { v: a.v.div(b.v) };", replace: "case 'div': return b.v.isZero() ? { v: a.v } : { v: a.v.div(b.v) };" },
  { name: 'métrica: referência circular não detectada', ts: `${E}metrics.ts`, suite: 'unit', find: 'if (visiting.has(cur)) return', replace: 'if (false) return' },
  { name: 'métrica: dataset diferente permitido na fórmula', ts: `${E}metrics.ts`, suite: 'unit', find: 'if (d.datasetId !== root.datasetId) throw', replace: 'if (false) throw' },
  { name: 'métrica: contagem vazia não vira zero', ts: `${E}metrics.ts`, suite: 'unit', find: "if ((m.agg === 'count' || m.agg === 'count_distinct') &&", replace: 'if (false &&' },
  { name: 'métrica: profundidade da fórmula sem limite', ts: `${E}metrics.ts`, suite: 'unit', find: "if (depth > FORMULA_LIMITS.depth) throw new BiError('formula_deep', `Fórmula", replace: "if (false) throw new BiError('formula_deep', `Fórmula" },
  { name: 'métrica: operação desconhecida aceita', ts: `${E}metrics.ts`, suite: 'unit', find: "throw new BiError('formula_op', 'Operação não permitida na fórmula.');", replace: 'return;' },
  { name: 'métrica: soma de razões considerada aditiva', ts: `${E}metrics.ts`, suite: 'unit', find: "root.kind === 'aggregation' ? additive : false", replace: 'additive' },
  { name: 'período: últimos 7 dias com 8 dias', ts: `${E}periods.ts`, suite: 'unit', find: "case 'last_7': return { from: addDays(today, -6), to: today };", replace: "case 'last_7': return { from: addDays(today, -7), to: today };" },
  { name: 'período: base do mês parcial invertida', ts: `${E}periods.ts`, suite: 'unit', find: "(opts.partialBasis ?? 'same_days') === 'full'", replace: "(opts.partialBasis ?? 'same_days') === 'same_days'" },
  { name: 'período: variação com anterior zero vira percentual', ts: `${E}periods.ts`, suite: 'unit', find: 'if (p.isZero()) {', replace: 'if (false) {' },
  { name: 'período: dia 31 sem ajuste ao mês menor', ts: `${E}periods.ts`, suite: 'unit', find: 'return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)));', replace: 'return fmt(ny, nm, d);' },
  { name: 'período: personalizado sem teto de tamanho', ts: `${E}periods.ts`, suite: 'unit', find: 'if (daysBetween(custom.from, custom.to) > 3660) throw', replace: 'if (false) throw' },
  { name: 'meta: máxima tratada como mínima', ts: `${E}goals.ts`, suite: 'unit', find: 'if (actual.lte(target)) return { status: \'achieved\', attainmentPct: used', replace: 'if (actual.gte(target)) return { status: \'achieved\', attainmentPct: used' },
  { name: 'meta: faixa exclusiva nas pontas', ts: `${E}goals.ts`, suite: 'unit', find: 'actual.gte(target) && actual.lte(hi)', replace: 'actual.gt(target) && actual.lt(hi)' },
  { name: 'meta: redução com sinal errado', ts: `${E}goals.ts`, suite: 'unit', find: "g.kind === 'growth' ? change : change.neg()", replace: 'change' },
  { name: 'meta: período aberto declara «não atingida»', ts: `${E}goals.ts`, suite: 'unit', find: "return { status: open ? (pct.gte(warn) ? 'on_track' : 'attention') : 'missed'", replace: "return { status: 'missed'" },
  { name: 'gráfico: pizza com média permitida', ts: `${E}chart-rules.ts`, suite: 'unit', find: 'if (!c.measures[0]!.additive) return no(', replace: 'if (false) return no(' },
  { name: 'gráfico: linha sem dimensão de tempo permitida', ts: `${E}chart-rules.ts`, suite: 'unit', find: 'if (nd !== 1 || !isTemporal(c.dimensions[0]!.type)) return no(', replace: 'if (false) return no(' },
  { name: 'gráfico: empilhado com média permitido', ts: `${E}chart-rules.ts`, suite: 'unit', find: "if (c.measures.some((m) => !m.additive)) return no('Barras empilhadas", replace: "if (false) return no('Barras empilhadas" },
  { name: 'widget: «Outros» sem verificar aditividade', ts: 'lib/bi/widgets.ts', suite: 'unit', find: '|| !display.metrics[0]!.additive) return null;', replace: ') return null;' },
  { name: 'widget: medidas repetidas não deduplicadas', ts: 'lib/bi/widgets.ts', suite: 'unit', find: 'let alias = bySig.get(k);', replace: 'let alias: string | undefined;' },
  { name: 'exportação: fórmula não neutralizada (-)', ts: `${E}csv-out.ts`, suite: 'unit', find: "/^[=+\\-@\\t\\r]/.test(raw)", replace: '/^[=+@\\t\\r]/.test(raw)' },
  { name: 'exportação: número formal recebe apóstrofo', ts: `${E}csv-out.ts`, suite: 'unit', find: "typeof v === 'string' && /^", replace: '/^' },
  { name: 'exibição: arredondamento truncado', ts: `${E}format.ts`, suite: 'unit', find: 'toDecimalPlaces(decimals, D.ROUND_HALF_UP)', replace: 'toDecimalPlaces(decimals, D.ROUND_DOWN)' },
  { name: 'modelo: campo obrigatório ignorado', ts: 'lib/bi/templates.ts', suite: 'unit', find: "spec.roles.filter((r) => r.required && !has(r.key))", replace: 'spec.roles.filter((r) => false && !has(r.key))' },

  // ---------------------------------------------------------------- banco: consultas declarativas
  { name: 'consulta SQL: «contém» vira curinga', file: 'bi_query', find: 'strpos(lower(%s), lower(%s)) > 0', replace: 'strpos(lower(%s), lower(%s)) >= 0' },
  { name: 'consulta SQL: período sem o último dia', file: 'bi_query', find: "'%s between %L::date and %L::date'", replace: "'%s between %L::date and (%L::date - 1)'" },
  { name: 'consulta SQL: dia civil em UTC', file: 'bi_query', find: "format('((r.values_json ->> %L)::timestamptz at time zone %L)::date', p_key, p_tz)", replace: "format('((r.values_json ->> %L)::timestamptz at time zone ''UTC'')::date', p_key, p_tz)" },
  { name: 'consulta SQL: contagem de valores conta vazios', file: 'bi_query', find: "when 'count' then format('count(r.values_json ->> %L)', k)", replace: "when 'count' then format('count(*)')" },
  { name: 'consulta SQL: limite sem teto', file: 'bi_query', find: "lim := least(greatest(coalesce((p_spec ->> 'limit')::int, 500), 1), 1000);", replace: "lim := greatest(coalesce((p_spec ->> 'limit')::int, 500), 1);" },
  { name: 'consulta SQL: filtro da medida ignorado', file: 'bi_query', find: "mexpr := format('%s filter (where %s)', mexpr, cond);", replace: 'mexpr := mexpr;' },
  { name: 'consulta SQL: coluna fora do catálogo aceita', file: 'bi_query', find: "or not (p_cols ? p_key) then raise exception 'coluna inválida na consulta'", replace: "then raise exception 'coluna inválida na consulta'" },
  { name: 'consulta SQL: número de filtro sem validação', file: 'bi_query', find: "if v !~ '^-?\\d{1,15}(\\.\\d{1,6})?$' then raise exception 'valor numérico de filtro inválido' using errcode = '22023'; end if;", replace: '' },
  { name: 'consulta SQL: soma de coluna não numérica aceita', file: 'bi_query', find: "if agg in ('sum', 'avg') and not private.bi_is_numeric(t) then raise exception 'soma e média exigem coluna numérica'", replace: "if false then raise exception 'soma e média exigem coluna numérica'" },
  { name: 'consulta SQL: dataset restrito ignorado no widget', file: 'bi_query', find: 'if ds.restricted and not (private.bi_is_admin(p_org)', replace: 'if false and not (private.bi_is_admin(p_org)' },
  { name: 'consulta SQL: rascunho visível a quem só visualiza', file: 'bi_query', find: "if d.status <> 'published' and lvl = 'view' then raise", replace: "if false then raise" },
  { name: 'consulta SQL: visualizador faz consulta livre', file: 'bi_query', find: "create function public.bi_run_query(p_org uuid, p_spec jsonb) returns jsonb\nlanguage plpgsql security definer set search_path = '' as $$\ndeclare ds uuid; v record; res jsonb;\nbegin\n  perform private.bi_guard(p_org, 'analyst');", replace: "create function public.bi_run_query(p_org uuid, p_spec jsonb) returns jsonb\nlanguage plpgsql security definer set search_path = '' as $$\ndeclare ds uuid; v record; res jsonb;\nbegin\n  perform private.bi_guard(p_org, 'read');", extra: [{ file: 'bi_rls', find: 'select private.bi_is_analyst(org) and exists (\n    select 1 from public.datasets d', replace: 'select exists (\n    select 1 from public.datasets d' }] },
  { name: 'consulta SQL: exportação bruta liberada ao analista', file: 'bi_query', find: "case when p_for_export then 'manager' else 'analyst' end", replace: "'analyst'" },
  { name: 'consulta SQL: página sem teto', file: 'bi_query', find: 'size := case when p_for_export then least(greatest(p_size, 1), 5000) else least(greatest(p_size, 1), 100) end;', replace: 'size := greatest(p_size, 1);' },
  { name: 'acesso: dataset restrito visível a todo analista', file: 'bi_rls', find: 'and (not d.restricted or private.bi_is_admin(org)', replace: 'and (true or private.bi_is_admin(org)' },
  { name: 'acesso: MFA ignorado nas funções', file: 'bi_guards', find: 'if not private.mfa_ok() then raise exception', replace: 'if false then raise exception' },
  // ---------------------------------------------------------------- banco: importação
  { name: 'importação SQL: valor fora do tipo aceito', file: 'bi_import', find: 'where c.id is null or not private.bi_value_ok(kv.value, c.data_type);', replace: 'where false;' },
  { name: 'importação SQL: campo obrigatório vazio aceito', file: 'bi_import', find: "and not c.nullable and (r -> 'v' -> c.column_key is null", replace: "and false and (r -> 'v' -> c.column_key is null" },
  { name: 'importação SQL: mais linhas que o declarado aceitas', file: 'bi_import', find: 'if staged + n > j.total_rows then raise', replace: 'if false then raise' },
  { name: 'importação SQL: envio incompleto fecha', file: 'bi_import', find: 'if staged <> p_valid then raise', replace: 'if false then raise' },
  { name: 'importação SQL: segunda publicação aceita', file: 'bi_import', find: "if j.status = 'published' then raise exception 'importação já publicada'", replace: "if false then raise exception 'importação já publicada'" },
  { name: 'importação SQL: mesmo arquivo importado de novo', file: 'bi_import', find: "j.file_hash = p_file_hash and j.status = 'published') then", replace: "j.file_hash = p_file_hash and j.status = 'published' and false) then" },
  { name: 'importação SQL: duas importações simultâneas no dataset', file: 'bi_import', find: "if exists (select 1 from public.import_jobs j where j.dataset_id = ds.id and j.status = 'processing') then raise", replace: 'if false then raise' },
  { name: 'importação SQL: impacto publicado sem confirmação', file: 'bi_import', find: 'if jsonb_array_length(impact) > 0 and not p_ack_impact then', replace: 'if false then' },
  { name: 'importação SQL: linhas com erro publicadas sem escolha', file: 'bi_import', find: "if j.invalid_rows > 0 and j.invalid_policy <> 'skip_invalid' then", replace: 'if false then' },
  { name: 'importação SQL: acréscimo não ignora chave existente', file: 'bi_import', find: 'n.row_key = o.row_key returning n.id', replace: 'n.row_key = o.row_key and false returning n.id' },
  { name: 'importação SQL: retenção nunca remove linhas', file: 'bi_import', find: 'offset greatest(s.retained_versions - 1, 1) loop', replace: 'offset 100000 loop' },
  { name: 'importação SQL: indicadores não revalidados', file: 'bi_import', find: 'if not (cols ? m.field_key) then bad := ', replace: 'if false then bad := ' },
  { name: 'importação SQL: auditoria da publicação omitida', file: 'bi_import', find: "perform private.bi_audit(p_org, 'import_published'", replace: "perform private.bi_audit(p_org, 'import_published_x'" },
  { name: 'dados: linhas importadas editáveis', file: 'bi_guards', find: "if tg_op = 'UPDATE' then raise exception 'linhas importadas não podem ser alteradas'", replace: "if false then raise exception 'linhas importadas não podem ser alteradas'" },
  { name: 'dados: linhas apagáveis sem a rotina de retenção', file: 'bi_guards', find: "<> 'on' then raise exception 'linhas importadas só são removidas", replace: "<> 'on' and false then raise exception 'linhas importadas só são removidas" },
  { name: 'dados: versão publicada com esquema editável', file: 'bi_guards', find: "if old.status <> 'staging' and (new.schema_json", replace: "if false and (new.schema_json" },
  // ---------------------------------------------------------------- banco: modelo analítico, dashboards, acesso, metas
  { name: 'indicador SQL: referência circular aceita', file: 'bi_models', find: 'if p_id is not null and private.bi_metric_reaches(p_org, ref::uuid, p_id) then', replace: 'if false then' },
  { name: 'indicador SQL: operação desconhecida aceita', file: 'bi_models', find: "raise exception 'operação não permitida na fórmula' using errcode = '22023';", replace: "return jsonb_build_object('nodes', 1, 'refs', '[]'::jsonb);" },
  { name: 'indicador SQL: fórmula sem limite de profundidade', file: 'bi_models', find: "if depth > 6 then raise exception 'fórmula profunda demais", replace: "if false then raise exception 'fórmula profunda demais" },
  { name: 'indicador SQL: métrica de outro dataset na fórmula', file: 'bi_models', find: 'and m.dataset_id = p_dataset and m.status = \'active\';\n      if cnt = 0', replace: 'and m.status = \'active\';\n      if cnt = 0' },
  { name: 'dashboard SQL: conflito de edição ignorado', file: 'bi_dashboards', find: 'if d.row_version <> p_expected then\n    raise exception \'conflito de edição: este dashboard', replace: 'if false then\n    raise exception \'conflito de edição: este dashboard' },
  { name: 'dashboard SQL: consulta do widget não validada ao salvar', file: 'bi_dashboards', find: 'perform private.bi_exec_query(p_org, ds.current_version_id, spec, tz);', replace: 'null;' },
  { name: 'dashboard SQL: posição fora da grade aceita', file: 'bi_dashboards', find: "(b ->> 'x')::int + (b ->> 'w')::int > 12 then return false", replace: "(b ->> 'x')::int + (b ->> 'w')::int > 999 then return false" },
  { name: 'dashboard SQL: analista publica', file: 'bi_dashboards', find: "perform private.bi_guard(p_org, 'manager');\n  perform private.bi_need_level(p_org, p_id, 'edit');\n  if p_visibility not in", replace: "perform private.bi_guard(p_org, 'analyst');\n  perform private.bi_need_level(p_org, p_id, 'edit');\n  if p_visibility not in" },
  { name: 'dashboard SQL: dataset restrito visível à empresa toda', file: 'bi_dashboards', find: "if p_visibility = 'organization' and restricted_n > 0 then", replace: "if p_visibility = 'organization' and restricted_n > 999 then" },
  { name: 'dashboard SQL: visualizador recebe edição', file: 'bi_dashboards', find: "if p_level in ('edit', 'admin') and role_ = 'viewer' then raise", replace: 'if false then raise' },
  { name: 'dashboard SQL: compartilha dataset restrito sem acesso', file: 'bi_dashboards', find: "if not (role_ in ('owner', 'admin') or exists (select 1 from public.dataset_access a", replace: "if false and not (role_ in ('owner', 'admin') or exists (select 1 from public.dataset_access a" },
  { name: 'dashboard SQL: revogação sem efeito', file: 'bi_dashboards', find: 'delete from public.dashboard_permissions where dashboard_id = p_id and user_id = p_user and organization_id = p_org;', replace: 'delete from public.dashboard_permissions where dashboard_id = p_id and user_id = p_user and organization_id = p_org and false;' },
  { name: 'dashboard SQL: restaurar sem checar conflito', file: 'bi_dashboards', find: "if d.row_version <> p_expected then raise exception 'conflito de edição: o dashboard mudou", replace: "if false then raise exception 'conflito de edição: o dashboard mudou" },
  { name: 'permissão: configurações abertas ao gestor', file: 'bi_misc', find: "create function public.bi_update_settings(p_org uuid, p_timezone text, p_date_format text, p_portal_name text, p_max_rows integer, p_max_file_mb integer, p_stale_days integer, p_retained integer, p_default_period text) returns void\nlanguage plpgsql security definer set search_path = '' as $$\nbegin\n  perform private.bi_guard(p_org, 'admin');", replace: "create function public.bi_update_settings(p_org uuid, p_timezone text, p_date_format text, p_portal_name text, p_max_rows integer, p_max_file_mb integer, p_stale_days integer, p_retained integer, p_default_period text) returns void\nlanguage plpgsql security definer set search_path = '' as $$\nbegin\n  perform private.bi_guard(p_org, 'manager');" },
  { name: 'permissão: analista cria meta', file: 'bi_misc', find: "declare m record; cols jsonb; f jsonb; out uuid;\nbegin\n  perform private.bi_guard(p_org, 'manager');", replace: "declare m record; cols jsonb; f jsonb; out uuid;\nbegin\n  perform private.bi_guard(p_org, 'analyst');" },
  { name: 'meta SQL: faixa invertida aceita', file: 'bi_misc', find: "if p_kind = 'range' and (p_target_high is null or p_target_high < p_target) then raise", replace: 'if false then raise' },
  { name: 'qualidade SQL: dataset desatualizado não marcado', file: 'bi_misc', find: "'stale', d.status = 'active' and (v.published_at is null or v.published_at < now() - make_interval(days => s.stale_days))", replace: "'stale', false" },
  { name: 'avisos SQL: aviso duplicado na mesma semana', file: 'bi_misc', find: "'stale:' || d.id || ':' || wk);", replace: "'stale:' || d.id || ':' || wk || clock_timestamp()::text);" },
  { name: 'permissão: acesso a dataset restrito concedido por gestor', file: 'bi_models', find: "perform private.bi_guard(p_org, 'admin');\n  if not exists (select 1 from public.datasets where id = p_dataset and organization_id = p_org) then raise exception 'dataset não encontrado' using errcode = 'P0002'; end if;\n  if p_grant then", replace: "perform private.bi_guard(p_org, 'manager');\n  if not exists (select 1 from public.datasets where id = p_dataset and organization_id = p_org) then raise exception 'dataset não encontrado' using errcode = 'P0002'; end if;\n  if p_grant then" },

  // ---------------------------------------------------------------- concorrência
  { name: 'concorrência: publicação do mesmo job sem trava', file: 'bi_import', suite: 'conc', find: "p_org for update;      -- serializa publicações do mesmo dataset\n  select * into j from public.import_jobs where id = p_job and organization_id = p_org for update;", replace: "p_org;      -- serializa publicações do mesmo dataset\n  select * into j from public.import_jobs where id = p_job and organization_id = p_org;" },
  { name: 'concorrência: duas importações no mesmo dataset', file: 'bi_schema', suite: 'conc', find: "create unique index import_jobs_one_running on public.import_jobs (dataset_id) where status = 'processing';", replace: '', extra: [{ file: 'bi_import', find: 'select * into ds from public.datasets where id = p_dataset and organization_id = p_org for update;', replace: 'select * into ds from public.datasets where id = p_dataset and organization_id = p_org;' }, { file: 'bi_schema', find: '  unique (dataset_id, version_number),', replace: '' }] },
  { name: 'concorrência: lotes sem trava do job', file: 'bi_import', suite: 'conc', nth: 1, find: 'select * into j from public.import_jobs where id = p_job and organization_id = p_org for update;', replace: 'select * into j from public.import_jobs where id = p_job and organization_id = p_org;' },
  { name: 'concorrência: salvar dashboard sem trava', file: 'bi_dashboards', suite: 'conc', nth: 1, find: 'select * into d from public.dashboards where id = p_id and organization_id = p_org for update;', replace: 'select * into d from public.dashboards where id = p_id and organization_id = p_org;' },
  { name: 'concorrência: publicar dashboard sem trava', file: 'bi_dashboards', suite: 'conc', nth: 2, find: 'select * into d from public.dashboards where id = p_id and organization_id = p_org for update;', replace: 'select * into d from public.dashboards where id = p_id and organization_id = p_org;' },
  { name: 'concorrência: versão de indicador sem trava', file: 'bi_models', suite: 'conc', find: 'select * into old from public.metric_definitions where id = p_id and organization_id = p_org for update;', replace: 'select * into old from public.metric_definitions where id = p_id and organization_id = p_org;' },
  { name: 'concorrência: nome de dataset repetido', file: 'bi_schema', suite: 'conc', find: "create unique index datasets_name_uniq on public.datasets (organization_id, lower(trim(name))) where status = 'active';", replace: '' },
];

const migDir = join(root, 'supabase', 'migrations');
const files = readdirSync(migDir).filter((f) => f.endsWith('.sql'));
const SCRIPT = { db: 'test-db.mjs', conc: 'test-concurrency.mjs' };

function runSuite(dir, suite) {
  return new Promise((resolve) => {
    const cmd = suite === 'unit'
      ? [join(dir, 'node_modules', 'vitest', 'vitest.mjs'), 'run', 'tests/unit/bi-import.test.ts', 'tests/unit/bi-metrics.test.ts', 'tests/unit/bi-widgets.test.ts']
      : [join(dir, 'scripts', SCRIPT[suite])];
    const p = spawn(process.execPath, cmd, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

function applyMutation(path, mutate) {
  const text = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
  const parts = text.split(mutate.find);
  const nth = mutate.nth ?? 1;
  if (parts.length < 2) throw new Error(`mutação sem alvo: ${mutate.name}`);
  if (parts.length > 2 && !mutate.nth) throw new Error(`mutação ambígua (${parts.length - 1} ocorrências): ${mutate.name}`);
  if (nth > parts.length - 1) throw new Error(`mutação sem a ocorrência ${nth}: ${mutate.name}`);
  writeFileSync(path, parts.slice(0, nth).join(mutate.find) + mutate.replace + parts.slice(nth).join(mutate.find));
}

function workspace(label, mutate, suite) {
  const dir = mkdtempSync(join(tmpdir(), `pack25-bi-mut-${label}-`));
  if (suite === 'unit') {
    for (const d of ['lib', 'tests', 'app', 'components']) cpSync(join(root, d), join(dir, d), { recursive: true });
    for (const f of ['vitest.config.ts', 'tsconfig.json', 'package.json']) cpSync(join(root, f), join(dir, f));
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction');
    if (mutate) applyMutation(join(dir, mutate.ts), mutate);
    return dir;
  }
  mkdirSync(join(dir, 'scripts'));
  for (const s of Object.values(SCRIPT)) cpSync(join(root, 'scripts', s), join(dir, 'scripts', s));
  cpSync(join(root, 'supabase'), join(dir, 'supabase'), { recursive: true });
  if (mutate) {
    const f = files.find((x) => x.includes(mutate.file));
    applyMutation(join(dir, 'supabase', 'migrations', f), mutate);
    for (const x of mutate.extra ?? []) applyMutation(join(dir, 'supabase', 'migrations', files.find((y) => y.includes(x.file))), { ...x, name: mutate.name });
  }
  return dir;
}

if (args.includes('--check')) {
  // só confere se cada mutação encontra o seu alvo (rápido; não roda suítes)
  let bad = 0;
  for (const m of M) {
    const path = m.ts ? join(root, m.ts) : join(migDir, files.find((x) => x.includes(m.file)) ?? '');
    const parts = readFileSync(path, 'utf8').replaceAll('\r\n', '\n').split(m.find);
    const n = parts.length - 1;
    const ok = n >= 1 && (m.nth ? m.nth <= n : n === 1);
    if (!ok) { bad++; console.log(`SEM ALVO ÚNICO (${n} ocorrências): ${m.name}`); }
  }
  console.log(bad ? `${bad} mutação(ões) com alvo inválido` : `${M.length} mutações com alvo válido`);
  process.exit(bad ? 1 : 0);
}

const suitesNeeded = new Set(M.filter((m) => !only || m.name.includes(only)).map((m) => m.suite ?? (m.ts ? 'unit' : 'db')));
for (const suite of suitesNeeded) {
  const base = workspace(`base-${suite}`, null, suite);
  const baseline = await runSuite(base, suite);
  rmSync(base, { recursive: true, force: true });
  if (baseline.code !== 0) {
    console.error(`A suíte «${suite}» sem mutação já reprova; corrija antes.\n` + baseline.out.slice(-1500));
    process.exit(2);
  }
}

const todo = M.filter((m) => !only || m.name.includes(only));
const survived = [];
const broken = [];
let next = 0;
async function worker() {
  while (next < todo.length) {
    const m = todo[next++];
    const suite = m.suite ?? (m.ts ? 'unit' : 'db');
    let dir;
    try {
      dir = workspace(String(next), m, suite);
    } catch (e) {
      console.log(`SEM ALVO    ${m.name} — ${e.message}`);
      broken.push(m.name);
      continue;
    }
    const r = await runSuite(dir, suite);
    rmSync(dir, { recursive: true, force: true });
    const killed = r.code !== 0;
    console.log(`${killed ? 'MORTA     ' : 'SOBREVIVEU '} ${m.name}`);
    if (!killed) survived.push(m.name);
  }
}
await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
console.log(`\n${todo.length - survived.length - broken.length}/${todo.length} mutações reprovadas pela suíte.`);
if (broken.length) console.error('Mutações sem alvo (o texto mudou):\n- ' + broken.join('\n- '));
if (survived.length) console.error('Sobreviveram:\n- ' + survived.join('\n- '));
if (survived.length || broken.length) process.exit(1);
