'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { Alert, Badge, Button, Input, Select } from '@/components/ui/primitives';
import { SEMANTIC_LABELS } from '@/lib/bi/labels';
import { DATA_TYPES, typeLabel, type DataType, type SemanticType } from '@/lib/bi/engine';
import { cancelImport, previewFile, publishImport, runImport, type ImportPreview, type PreviewColumn, type RunResult } from '@/lib/bi/actions/imports';
import { pushFlash } from './flash';

type DatasetOpt = { id: string; name: string; hasData: boolean };
type Col = PreviewColumn & { ignore: boolean };

const SEMANTICS: SemanticType[] = ['dimension', 'measure', 'time', 'identifier', 'ignore'];

export function ImportWizard({ datasets, initialDataset, maxMb }: { datasets: DatasetOpt[]; initialDataset: string | null; maxMb: number }) {
  const uid = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dataset, setDataset] = useState<string>(initialDataset ?? '');
  const [newName, setNewName] = useState('');
  const [mode, setMode] = useState<'replace' | 'append'>('replace');
  const [policy, setPolicy] = useState<'reject_all' | 'skip_invalid'>('reject_all');
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState<string>('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [cols, setCols] = useState<Col[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<RunResult['summary'] | null>(null);
  const [ack, setAck] = useState(false);

  const chosen = datasets.find((d) => d.id === dataset) ?? null;
  const isAppend = mode === 'append' && chosen?.hasData;

  function reset() { setPreview(null); setCols([]); setRun(null); setError(null); setAck(false); }

  function readPreview(selectedSheet?: string) {
    if (!file) { setError('Escolha um arquivo CSV ou XLSX.'); return; }
    if (file.size > maxMb * 1024 * 1024) { setError(`O arquivo passa de ${maxMb} MB (limite configurado).`); return; }
    setError(null); setRun(null);
    const fd = new FormData();
    fd.set('file', file);
    if (dataset) fd.set('dataset_id', dataset);
    if (selectedSheet) fd.set('sheet', selectedSheet);
    start(async () => {
      const r = await previewFile({}, fd);
      if (!r.ok || !r.preview) { setError(r.message ?? 'Não foi possível ler o arquivo.'); setPreview(null); return; }
      setPreview(r.preview);
      setSheet(r.preview.sheet ?? '');
      setCols(r.preview.columns.map((c) => ({ ...c, ignore: false })));
    });
  }

  function validate() {
    if (!file || !preview) return;
    if (!dataset && newName.trim().length < 1) { setError('Informe o nome do novo dataset.'); return; }
    setError(null);
    const fd = new FormData();
    fd.set('file', file);
    fd.set('config', JSON.stringify({
      dataset_id: dataset || null, new_name: dataset ? null : newName.trim(), mode: dataset ? mode : 'replace', invalid_policy: policy, sheet: sheet || null,
      columns: cols.map((c) => ({ src: c.src, existingKey: c.existingKey, name: c.name.trim() || `Coluna ${c.src + 1}`, type: c.type, semantic: c.semantic, required: c.required, locale: c.locale, dedupe: c.dedupe, ignore: c.ignore })),
    }));
    start(async () => {
      const r = await runImport({}, fd);
      if (!r.ok || !r.summary) { setError(r.message ?? 'Não foi possível validar o arquivo.'); return; }
      setRun(r.summary);
    });
  }

  function publish() {
    if (!run) return;
    const fd = new FormData();
    fd.set('id', run.jobId);
    if (ack) fd.set('ack', 'on');
    start(async () => {
      const r = await publishImport({}, fd);
      if (!r.ok) { setError(r.message ?? 'Não foi possível publicar.'); return; }
      if (r.message) pushFlash(r.message);
      router.push(r.redirectTo ?? '/datasets');
      router.refresh();
    });
  }
  function cancel() {
    if (!run) return;
    const fd = new FormData();
    fd.set('id', run.jobId);
    start(async () => {
      const r = await cancelImport({}, fd);
      if (r.message) pushFlash(r.message);
      setRun(null);
      router.refresh();
    });
  }

  const upd = (i: number, patch: Partial<Col>) => setCols((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const numeric = (t: DataType) => t === 'integer' || t === 'decimal' || t === 'currency' || t === 'percentage';
  const dupKeys = cols.filter((c) => c.dedupe && !c.ignore).length;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-4" aria-labelledby={`${uid}-dest`}>
        <h2 id={`${uid}-dest`} className="text-base font-semibold">1. Destino e arquivo</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${uid}-ds`} className="mb-1 block text-sm font-medium">Dataset de destino</label>
            <Select id={`${uid}-ds`} value={dataset} onChange={(e) => { setDataset(e.target.value); reset(); }}>
              <option value="">Novo dataset…</option>
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}{d.hasData ? '' : ' (vazio)'}</option>)}
            </Select>
          </div>
          {!dataset ? (
            <div>
              <label htmlFor={`${uid}-nm`} className="mb-1 block text-sm font-medium">Nome do novo dataset</label>
              <Input id={`${uid}-nm`} value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} placeholder="Ex.: Vendas 2026" />
            </div>
          ) : chosen?.hasData ? (
            <fieldset>
              <legend className="mb-1 block text-sm font-medium">O que fazer com os dados atuais?</legend>
              <label className="flex items-start gap-2 text-sm"><input type="radio" name={`${uid}-mode`} checked={mode === 'replace'} onChange={() => { setMode('replace'); reset(); }} className="mt-1" /> <span><strong>Substituir tudo</strong> pela nova versão (a anterior fica no histórico, conforme a retenção).</span></label>
              <label className="mt-1 flex items-start gap-2 text-sm"><input type="radio" name={`${uid}-mode`} checked={mode === 'append'} onChange={() => { setMode('append'); reset(); }} className="mt-1" /> <span><strong>Acrescentar novos registros</strong> usando a chave de deduplicação já definida (registros que já existem são ignorados e contados).</span></label>
            </fieldset>
          ) : null}
          <div className="sm:col-span-2">
            <label htmlFor={`${uid}-file`} className="mb-1 block text-sm font-medium">Arquivo (.csv ou .xlsx, até {maxMb} MB)</label>
            <Input id={`${uid}-file`} type="file" accept=".csv,.txt,.tsv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }} />
            <p className="mt-1 text-xs text-muted">O formato é conferido pelo conteúdo. Planilhas com macros e arquivos .xls antigos são recusados; fórmulas nunca são executadas (lemos só o valor já calculado). O arquivo original não é guardado.</p>
          </div>
        </div>
        <div className="mt-4"><Button type="button" onClick={() => readPreview()} disabled={pending || !file}>{pending && !preview ? 'Lendo…' : 'Ler arquivo e sugerir tipos'}</Button></div>
      </section>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {preview ? (
        <section className="rounded-lg border border-border bg-card p-4" aria-labelledby={`${uid}-map`}>
          <h2 id={`${uid}-map`} className="text-base font-semibold">2. Prévia e mapeamento de colunas</h2>
          <p className="mt-1 text-sm text-muted">{preview.fileName} · {preview.kind.toUpperCase()} · {preview.totalRows.toLocaleString('pt-BR')} linha(s) de dados · {preview.headers.length} coluna(s). As primeiras linhas aparecem abaixo exatamente como vieram do arquivo.</p>
          {preview.notes.map((n) => <p key={n} className="mt-1 text-xs text-muted" role="note">ℹ {n}</p>)}
          {preview.duplicateHeaders.length ? <p className="mt-1 text-xs text-warning" role="note">Cabeçalhos repetidos ({preview.duplicateHeaders.join(', ')}): renomeamos as colunas para não se confundirem.</p> : null}
          {preview.sheets.length > 1 ? (
            <div className="mt-3 max-w-xs">
              <label htmlFor={`${uid}-sheet`} className="mb-1 block text-sm font-medium">Aba da planilha</label>
              <Select id={`${uid}-sheet`} value={sheet} onChange={(e) => { setSheet(e.target.value); readPreview(e.target.value); }}>{preview.sheets.map((s) => <option key={s.name} value={s.name}>{s.name}{s.hidden ? ' (oculta)' : ''}</option>)}</Select>
            </div>
          ) : null}
          <div className="mt-3 overflow-x-auto rounded-md border border-border">
            <table className="w-full text-xs"><caption className="sr-only">Primeiras linhas do arquivo</caption>
              <thead><tr>{preview.headers.map((h, i) => <th key={i} scope="col" className="whitespace-nowrap px-2 py-1 text-left font-medium text-muted">{h || `(coluna ${i + 1})`}</th>)}</tr></thead>
              <tbody>{preview.sample.map((r, i) => <tr key={i} className="border-t border-border">{r.map((c, j) => <td key={j} className="whitespace-nowrap px-2 py-1">{c}</td>)}</tr>)}</tbody>
            </table>
          </div>

          {isAppend ? (
            <div className="mt-4">
              <p className="text-sm font-medium">Acréscimo: as colunas seguem o esquema do dataset.</p>
              <ul className="mt-2 space-y-1 text-sm">
                {(preview.existing ?? []).map((e) => {
                  const m = cols.find((c) => c.existingKey === e.key);
                  return <li key={e.key}>{e.name} <span className="text-muted">({typeLabel(e.type)}{e.dedupe ? ', chave' : ''})</span> ← {m ? <strong>{preview.headers[m.src]}</strong> : <Badge tone="warning">não encontrada no arquivo (ficará vazia)</Badge>}</li>;
                })}
              </ul>
              {!(preview.existing ?? []).some((e) => e.dedupe) ? <Alert tone="error">Este dataset não tem chave de deduplicação. Use «Substituir tudo» e marque a coluna-chave no mapeamento.</Alert> : null}
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm"><caption className="sr-only">Mapeamento das colunas</caption>
                <thead><tr className="text-left text-xs uppercase tracking-wide text-muted"><th scope="col" className="px-2 py-1">Coluna do arquivo</th><th scope="col" className="px-2 py-1">Nome</th><th scope="col" className="px-2 py-1">Tipo</th><th scope="col" className="px-2 py-1">Papel</th><th scope="col" className="px-2 py-1">Obrigatória</th><th scope="col" className="px-2 py-1">Chave</th></tr></thead>
                <tbody>
                  {cols.map((c, i) => (
                    <tr key={c.src} className={`border-t border-border ${c.ignore ? 'opacity-50' : ''}`}>
                      <td className="px-2 py-2 align-top"><span className="font-medium">{preview.headers[c.src] || `(coluna ${c.src + 1})`}</span>{c.existingKey ? <span className="ml-1 text-xs text-muted">↔ coluna existente</span> : null}{c.warning ? <p className="max-w-56 text-xs text-warning">{c.warning}</p> : null}</td>
                      <td className="px-2 py-2 align-top"><Input aria-label={`Nome da coluna ${i + 1}`} value={c.name} maxLength={80} onChange={(e) => upd(i, { name: e.target.value })} disabled={c.ignore} className="min-w-40" /></td>
                      <td className="px-2 py-2 align-top">
                        <Select aria-label={`Tipo da coluna ${i + 1}`} value={c.type} onChange={(e) => upd(i, { type: e.target.value as DataType })} disabled={c.ignore}>{DATA_TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}</Select>
                        {numeric(c.type) ? <Select aria-label={`Formato numérico da coluna ${i + 1}`} value={c.locale} onChange={(e) => upd(i, { locale: e.target.value as 'br' | 'us' })} disabled={c.ignore} className="mt-1"><option value="br">1.234,56 (brasileiro)</option><option value="us">1,234.56 (inglês)</option></Select> : null}
                      </td>
                      <td className="px-2 py-2 align-top"><Select aria-label={`Papel da coluna ${i + 1}`} value={c.ignore ? 'ignore' : c.semantic} onChange={(e) => (e.target.value === 'ignore' ? upd(i, { ignore: true }) : upd(i, { ignore: false, semantic: e.target.value as SemanticType }))}>{SEMANTICS.map((s) => <option key={s} value={s}>{SEMANTIC_LABELS[s]}</option>)}</Select></td>
                      <td className="px-2 py-2 align-top"><input type="checkbox" aria-label={`Coluna ${i + 1} obrigatória`} checked={c.required} onChange={(e) => upd(i, { required: e.target.checked })} disabled={c.ignore} className="size-4" /></td>
                      <td className="px-2 py-2 align-top"><input type="checkbox" aria-label={`Coluna ${i + 1} faz parte da chave de deduplicação`} checked={c.dedupe} onChange={(e) => upd(i, { dedupe: e.target.checked, required: e.target.checked ? true : c.required })} disabled={c.ignore || c.type === 'decimal'} className="size-4" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted">A <strong>chave</strong> (uma ou mais colunas) identifica cada registro e evita duplicidade em reimportações e acréscimos. {dupKeys === 0 ? 'Sem chave, só é possível substituir o dataset por inteiro.' : ''}</p>
            </div>
          )}

          <fieldset className="mt-4">
            <legend className="text-sm font-medium">Se houver linhas com erro…</legend>
            <label className="flex items-start gap-2 text-sm"><input type="radio" name={`${uid}-pol`} checked={policy === 'reject_all'} onChange={() => setPolicy('reject_all')} className="mt-1" /> <span><strong>Não publicar nada</strong> até o arquivo ser corrigido (recomendado).</span></label>
            <label className="mt-1 flex items-start gap-2 text-sm"><input type="radio" name={`${uid}-pol`} checked={policy === 'skip_invalid'} onChange={() => setPolicy('skip_invalid')} className="mt-1" /> <span><strong>Importar só as linhas válidas</strong> e guardar o relatório das rejeitadas (importação parcial controlada).</span></label>
          </fieldset>
          <div className="mt-4"><Button type="button" onClick={validate} disabled={pending}>{pending ? 'Validando…' : 'Validar arquivo (nada é publicado ainda)'}</Button></div>
        </section>
      ) : null}

      {run ? (
        <section className="rounded-lg border border-border bg-card p-4" aria-labelledby={`${uid}-res`}>
          <h2 id={`${uid}-res`} className="text-base font-semibold">3. Resultado da validação</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-4">
            <div><dt className="text-xs text-muted">Linhas no arquivo</dt><dd className="text-xl font-semibold tabular-nums" data-testid="imp-total">{run.total.toLocaleString('pt-BR')}</dd></div>
            <div><dt className="text-xs text-muted">Válidas</dt><dd className="text-xl font-semibold tabular-nums text-success" data-testid="imp-valid">{run.valid.toLocaleString('pt-BR')}</dd></div>
            <div><dt className="text-xs text-muted">Com erro</dt><dd className={`text-xl font-semibold tabular-nums ${run.invalid ? 'text-danger' : ''}`} data-testid="imp-invalid">{run.invalid.toLocaleString('pt-BR')}</dd></div>
            <div><dt className="text-xs text-muted">Repetidas no arquivo</dt><dd className="text-xl font-semibold tabular-nums">{run.duplicates.toLocaleString('pt-BR')}</dd></div>
          </dl>
          {run.errors.length ? (
            <div className="mt-4">
              <h3 className="text-sm font-semibold">Erros por linha{run.errorsTruncated ? ' (primeiros 40; o relatório completo tem até 1.000)' : ''}</h3>
              <div className="mt-2 overflow-x-auto rounded-md border border-border">
                <table className="w-full text-xs"><caption className="sr-only">Erros por linha</caption>
                  <thead><tr className="text-left text-muted"><th scope="col" className="px-2 py-1">Linha</th><th scope="col" className="px-2 py-1">Coluna</th><th scope="col" className="px-2 py-1">Motivo</th><th scope="col" className="px-2 py-1">Valor rejeitado</th></tr></thead>
                  <tbody>{run.errors.map((e, i) => <tr key={i} className="border-t border-border"><td className="px-2 py-1 tabular-nums">{e.row}</td><td className="px-2 py-1">{e.column}</td><td className="px-2 py-1">{e.message}</td><td className="px-2 py-1">{e.value ?? '—'}</td></tr>)}</tbody>
                </table>
              </div>
              <a className="mt-2 inline-block text-sm underline underline-offset-2" href={`/api/importacoes/${run.jobId}/erros`}>Baixar relatório de erros (CSV)</a>
            </div>
          ) : null}
          {run.impact.length ? (
            <Alert tone="warning">
              <p className="font-medium">Esta substituição afeta {run.impact.length} item(ns) existente(s):</p>
              <ul className="mt-1 list-disc pl-5 text-sm">{run.impact.map((x, i) => <li key={i}>{x.kind} «{x.name}» — coluna «{x.column}»: {x.reason}</li>)}</ul>
              <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="size-4" /> Entendo o impacto e quero publicar mesmo assim.</label>
            </Alert>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {run.valid === 0 ? <p className="text-sm text-danger">Nenhuma linha válida: nada para publicar. Corrija o arquivo e envie de novo.</p>
              : run.invalid > 0 && run.invalidPolicy === 'reject_all' ? <p className="text-sm text-danger">Há linhas com erro e você escolheu não publicar nada. Corrija o arquivo, ou volte e escolha importar só as válidas.</p>
              : <Button type="button" onClick={publish} disabled={pending || (run.impact.length > 0 && !ack)}>{pending ? 'Publicando…' : `Confirmar e publicar${run.mode === 'append' ? ' (acrescentar)' : ''}`}</Button>}
            <Button type="button" variant="secondary" onClick={cancel} disabled={pending}>Cancelar importação</Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
