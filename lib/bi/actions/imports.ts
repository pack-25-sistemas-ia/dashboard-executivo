'use server';

import { createHash } from 'node:crypto';
import { fail, succeed, type ActionState } from '@/lib/actions/result';
import {
  FileError, IMPORT_LIMITS, buildColumns, duplicateHeaders, ingest, inferColumn, readImportFile, type ColumnDef, type DataType, type RawCell, type SemanticType,
} from '../engine';
import { bustBi, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';
import { loadColumns, loadDataset, type ColumnRow } from '../data';
import { importRunSchema, publishImportSchema, uuid } from '../schemas';
import { z } from 'zod';

// Importação: o servidor lê o arquivo (formato pelo CONTEÚDO), tipa cada célula e envia ao banco em lotes; o banco revalida tudo.
// Nada fica visível até «Confirmar e publicar» (publicação atômica). O arquivo original NÃO é guardado (só hash, nome e contagens).

export type PreviewColumn = { src: number; name: string; type: DataType; semantic: SemanticType; required: boolean; locale: 'br' | 'us'; dedupe: boolean; existingKey: string | null; warning: string | null; nonEmpty: number };
export type ImportPreview = {
  fileName: string; hash: string; kind: 'csv' | 'xlsx'; sheets: Array<{ name: string; hidden: boolean }>; sheet: string | null; headers: string[]; sample: string[][]; totalRows: number; notes: string[];
  columns: PreviewColumn[]; existing: Array<{ key: string; name: string; type: DataType; dedupe: boolean }> | null; duplicateHeaders: string[];
};
export type PreviewResult = ActionState & { preview?: ImportPreview };
export type RunResult = ActionState & {
  summary?: { jobId: string; datasetId: string; versionNumber: number; total: number; valid: number; invalid: number; duplicates: number; errors: Array<{ row: number; column: string; message: string; value: string | null }>; errorsTruncated: boolean; notes: string[]; impact: Array<{ kind: string; name: string; column: string; reason: string }>; mode: string; invalidPolicy: string };
};

const cellText = (c: RawCell): string => (c === null ? '' : c.t === 'b' ? (c.v ? 'sim' : 'não') : c.v.length > 80 ? `${c.v.slice(0, 77)}…` : c.v);
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function readFormFile(fd: FormData): Promise<{ bytes: Uint8Array; name: string } | { error: string }> {
  const f = fd.get('file');
  if (!(f instanceof File) || f.size === 0) return { error: 'Escolha um arquivo CSV ou XLSX.' };
  if (f.size > IMPORT_LIMITS.fileBytes) return { error: `O arquivo passa de ${IMPORT_LIMITS.fileBytes / 1024 / 1024} MB (limite do MVP).` };
  return { bytes: new Uint8Array(await f.arrayBuffer()), name: f.name.slice(0, 200) };
}

export async function previewFile(_: PreviewResult, fd: FormData): Promise<PreviewResult> {
  const dsRaw = String(fd.get('dataset_id') ?? '');
  const sheet = String(fd.get('sheet') ?? '') || undefined;
  const ds = dsRaw ? uuid.safeParse(dsRaw) : null;
  if (ds && !ds.success) return fail('Dataset inválido.');
  return guarded('operator', 'previewFile', async (ctx) => {
    const file = await readFormFile(fd);
    if ('error' in file) return fail(file.error);
    let existing: ColumnRow[] | null = null;
    if (ds?.success) {
      const d = await loadDataset(ctx, ds.data);
      if (!d) return fail('Dataset não encontrado ou sem permissão.');
      existing = await loadColumns(ctx, d.current_version_id);
    }
    try {
      const r = readImportFile(file.bytes, file.name, sheet);
      const hash = createHash('sha256').update(file.bytes).digest('hex');
      const sample = r.rows.slice(0, 500);
      const inferences = r.headers.map((_h, i) => inferColumn(sample.map((row) => row[i] ?? null)));
      const cols = buildColumns(r.headers, inferences);
      const byName = new Map((existing ?? []).map((c) => [norm(c.display_name), c]));
      const columns: PreviewColumn[] = cols.map((c, i) => {
        const match = byName.get(norm(r.headers[i] ?? ''));
        return {
          src: i, name: match?.display_name ?? c.name, type: match?.data_type ?? c.type, semantic: match?.semantic_type ?? c.semantic, required: match ? !match.nullable : false, locale: match?.locale ?? c.locale,
          dedupe: match?.dedupe ?? false, existingKey: match?.column_key ?? null, warning: inferences[i]?.warning ?? null, nonEmpty: inferences[i]?.nonEmpty ?? 0,
        };
      });
      return { ok: true, preview: {
        fileName: file.name, hash, kind: r.kind, sheets: r.sheets, sheet: r.sheet, headers: r.headers, sample: r.rows.slice(0, 12).map((row) => row.map(cellText)), totalRows: r.rows.length, notes: r.notes, columns,
        existing: existing ? existing.map((c) => ({ key: c.column_key, name: c.display_name, type: c.data_type, dedupe: c.dedupe })) : null, duplicateHeaders: duplicateHeaders(r.headers),
      } };
    } catch (e) {
      if (e instanceof FileError) return fail(e.message);
      throw e;
    }
  });
}

type Cfg = z.infer<typeof importRunSchema>;

export async function runImport(_: RunResult, fd: FormData): Promise<RunResult> {
  let cfg: Cfg;
  try {
    const parsed = importRunSchema.safeParse(JSON.parse(String(fd.get('config') ?? '{}')));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Configuração da importação inválida.');
    cfg = parsed.data;
  } catch { return fail('Configuração da importação inválida.'); }
  return guarded('operator', 'runImport', async (ctx, org) => {
    const file = await readFormFile(fd);
    if ('error' in file) return fail(file.error);
    const { data: st } = await ctx.supabase.from('bi_settings').select('timezone').eq('organization_id', org).maybeSingle();
    const tz = (st as { timezone?: string } | null)?.timezone ?? 'America/Sao_Paulo';
    let parsedFile;
    try { parsedFile = readImportFile(file.bytes, file.name, cfg.sheet ?? undefined); } catch (e) { return fail(e instanceof FileError ? e.message : 'Não foi possível ler o arquivo.'); }
    const hash = createHash('sha256').update(file.bytes).digest('hex');

    // «novo dataset» com o nome de um dataset ainda VAZIO (ex.: tentativa anterior cancelada): reaproveita em vez de recusar
    if (!cfg.dataset_id && cfg.new_name) {
      const { data: empty } = await ctx.supabase.from('datasets').select('id').eq('organization_id', org).eq('status', 'active').is('current_version_id', null).ilike('name', cfg.new_name.replace(/[%_\\]/g, ' ').trim()).limit(1).maybeSingle();
      if (empty) cfg = { ...cfg, dataset_id: (empty as { id: string }).id, new_name: null };
    }
    // esquema do destino
    let existing: ColumnRow[] = [];
    if (cfg.dataset_id) {
      const d = await loadDataset(ctx, cfg.dataset_id);
      if (!d) return fail('Dataset não encontrado ou sem permissão.');
      existing = await loadColumns(ctx, d.current_version_id);
    }
    const used = new Set(existing.map((c) => c.column_key));
    let next = 1;
    const newKey = () => { while (used.has(`c${next}`)) next++; used.add(`c${next}`); return `c${next}`; };

    const cols: ColumnDef[] = [];
    const source: (number | null)[] = [];
    const usedKeys = new Set<string>();
    if (cfg.mode === 'append') {
      if (!existing.length) return fail('Não há dados para acrescentar: faça a carga inicial.');
      for (const e of existing) {
        const m = cfg.columns.find((c) => c.existingKey === e.column_key && !c.ignore && c.src !== null);
        cols.push({ key: e.column_key, name: e.display_name, type: e.data_type, semantic: e.semantic_type, required: !e.nullable, locale: e.locale, dedupe: e.dedupe });
        source.push(m ? m.src : null);
      }
    } else {
      for (const c of cfg.columns) {
        if (c.ignore || c.src === null) continue;
        if (c.src >= parsedFile.headers.length) return fail('Coluna do arquivo inexistente no mapeamento.');
        let key = c.existingKey && existing.some((e) => e.column_key === c.existingKey) ? c.existingKey : newKey();
        if (usedKeys.has(key)) key = newKey();
        usedKeys.add(key);
        cols.push({ key, name: c.name, type: c.type, semantic: c.semantic === 'ignore' ? 'dimension' : c.semantic, required: c.required, locale: c.locale, dedupe: c.dedupe });
        source.push(c.src);
      }
      if (!cols.length) return fail('Mapeie ao menos uma coluna.');
      const names = cols.map((c) => c.name.toLowerCase());
      if (new Set(names).size !== names.length) return fail('Há nomes de coluna repetidos no mapeamento. Renomeie para continuar.');
    }
    if (cfg.mode === 'append' && !cols.some((c) => c.dedupe)) return fail('O dataset não tem chave de deduplicação: use a substituição integral com uma chave definida.');

    const res = ingest(parsedFile.rows, cols, source, tz);
    const colName = new Map(cols.map((c) => [c.key, c.name]));
    const columnsPayload = cols.map((c, i) => ({ key: c.key, name: c.name, type: c.type, semantic: c.semantic, required: c.required, locale: c.locale, dedupe: c.dedupe, position: i }));
    const mapping = { file: file.name, sheet: parsedFile.sheet, columns: cols.map((c, i) => ({ key: c.key, name: c.name, src: source[i] ?? null })) };
    const { data: b, error: be } = await ctx.supabase.rpc('bi_begin_import', {
      p_org: org, p_dataset: cfg.dataset_id, p_new_name: cfg.dataset_id ? null : cfg.new_name, p_file_name: file.name, p_file_hash: hash, p_file_type: parsedFile.kind, p_mode: cfg.mode,
      p_invalid_policy: cfg.invalid_policy, p_columns: columnsPayload, p_mapping: mapping, p_total_rows: parsedFile.rows.length, p_notes: parsedFile.notes.slice(0, 20),
    });
    if (be) return fail(dbMessage(be, /mesmo conteúdo/.test(be.message ?? '') ? undefined : 'Já existe um dataset com este nome.'));
    const begin = b as { job_id: string; dataset_id: string; version_number: number };
    try {
      for (let i = 0; i < res.valid.length; i += 1000) {
        const batch = res.valid.slice(i, i + 1000).map((r) => ({ n: r.rowNumber, k: r.rowKey, v: r.values }));
        const { error } = await ctx.supabase.rpc('bi_stage_rows', { p_org: org, p_job: begin.job_id, p_rows: batch });
        if (error) throw new Error(dbMessage(error));
      }
      const errors = res.errors.map((e) => ({ row: e.row, column: e.columnKey ?? '', code: e.code, message: e.message, value: e.value ?? null }));
      const { error: fe } = await ctx.supabase.rpc('bi_finish_import', { p_org: org, p_job: begin.job_id, p_valid: res.valid.length, p_invalid: res.invalidRows, p_errors: errors });
      if (fe) throw new Error(dbMessage(fe));
    } catch (e) {
      await ctx.supabase.rpc('bi_fail_import', { p_org: org, p_job: begin.job_id, p_message: 'Falha ao enviar as linhas ao banco.' });
      bustBi();
      return fail(e instanceof Error && e.message ? e.message : 'Não foi possível enviar as linhas. Nada foi publicado.');
    }
    let impact: NonNullable<RunResult['summary']>['impact'] = [];
    if (cfg.mode === 'replace' && cfg.dataset_id) {
      const { data: im } = await ctx.supabase.rpc('bi_import_impact', { p_org: org, p_dataset: cfg.dataset_id, p_columns: columnsPayload });
      impact = Array.isArray(im) ? (im as typeof impact) : [];
    }
    bustBi();
    return { ...succeed('Arquivo lido e validado. Nada foi publicado ainda.'), summary: {
      jobId: begin.job_id, datasetId: begin.dataset_id, versionNumber: begin.version_number, total: res.totalRows, valid: res.valid.length, invalid: res.invalidRows, duplicates: res.duplicateInFile, impact, mode: cfg.mode, invalidPolicy: cfg.invalid_policy,
      errors: res.errors.slice(0, 40).map((e) => ({ row: e.row, column: e.columnKey ? colName.get(e.columnKey) ?? e.columnKey : '—', message: e.message, value: e.value ?? null })), errorsTruncated: res.errorsTruncated || res.errors.length > 40, notes: parsedFile.notes,
    } };
  });
}

export async function publishImport(_: ActionState, fd: FormData): Promise<SaveResult> {
  const raw = formObject(fd);
  const p = parse(publishImportSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'publishImport', async (ctx, org) => {
    const { data, error } = await ctx.supabase.rpc('bi_publish_import', { p_org: org, p_job: p.data.id, p_ack_impact: p.data.ack });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustBi();
    const r = data as { row_count: number; skipped_existing: number; metrics_changed: number };
    const extra = `${r.skipped_existing ? ` ${r.skipped_existing} registro(s) já existiam e foram ignorados.` : ''}${r.metrics_changed ? ` ${r.metrics_changed} indicador(es) precisam de revisão.` : ''}`;
    const { data: j } = await ctx.supabase.from('import_jobs').select('dataset_id').eq('id', p.data.id).maybeSingle();
    return { ...succeed(`Importação publicada: ${r.row_count} linha(s) na versão ativa.${extra}`), redirectTo: `/datasets/${(j as { dataset_id: string } | null)?.dataset_id ?? ''}` };
  });
}

export async function cancelImport(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(z.object({ id: uuid }), raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'cancelImport', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('bi_fail_import', { p_org: org, p_job: p.data.id, p_message: 'Importação cancelada pelo usuário.' });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustBi();
    return succeed('Importação cancelada. A versão ativa do dataset não foi alterada.');
  });
}

