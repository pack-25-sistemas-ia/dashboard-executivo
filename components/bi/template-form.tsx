'use client';

import { useState } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import { Alert, Input, Select } from '@/components/ui/primitives';
import { applyTemplate } from '@/lib/bi/actions/dashboards';
import { typeLabel, type DataType } from '@/lib/bi/engine';
import { TEMPLATES, planTemplate } from '@/lib/bi/templates';
import { useBiAction } from './use-bi-action';

export type TfDataset = { id: string; name: string; columns: Array<{ key: string; name: string; type: DataType }>; metrics: Array<{ id: string; name: string }> };

/** Cria um dashboard editável a partir de um modelo. Você aponta qual coluna faz cada papel; nada é associado só pelo nome parecido. */
export function TemplateForm({ datasets }: { datasets: TfDataset[] }) {
  const [state, action, ref] = useBiAction(applyTemplate, { reset: false });
  const [tpl, setTpl] = useState(TEMPLATES[0]!.key);
  const [dsId, setDsId] = useState(datasets[0]?.id ?? '');
  const [map, setMap] = useState<Record<string, string>>({});
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [metricIds, setMetricIds] = useState<string[]>([]);
  const [name, setName] = useState('');
  const spec = TEMPLATES.find((t) => t.key === tpl)!;
  const ds = datasets.find((d) => d.id === dsId);
  const plan = planTemplate(spec, map, extras);
  const exec = spec.key === 'executivo';
  return (
    <form ref={ref} action={action} noValidate className="space-y-4">
      <input type="hidden" name="template" value={tpl} /><input type="hidden" name="dataset_id" value={dsId} />
      <input type="hidden" name="mapping" value={JSON.stringify(map)} /><input type="hidden" name="extras" value={JSON.stringify(extras)} /><input type="hidden" name="metric_ids" value={JSON.stringify(metricIds)} />
      <fieldset><legend className="mb-2 text-sm font-medium">Modelo</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{TEMPLATES.map((t) => (
          <label key={t.key} className={`cursor-pointer rounded-lg border p-3 text-sm ${t.key === tpl ? 'border-primary ring-2 ring-primary' : 'border-border'}`}>
            <input type="radio" name="tpl-ui" className="sr-only" checked={t.key === tpl} onChange={() => { setTpl(t.key); setMap({}); setExtras({}); }} /><strong>{t.name}</strong><p className="mt-1 text-muted">{t.description}</p>
          </label>))}</div>
      </fieldset>
      {spec.disclaimer ? <Alert tone="info">{spec.disclaimer}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label htmlFor="tf-name" className="mb-1 block text-sm font-medium">Nome do dashboard</label><Input id="tf-name" name="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={spec.name} /></div>
        <div><label htmlFor="tf-ds" className="mb-1 block text-sm font-medium">Dataset</label><Select id="tf-ds" value={dsId} onChange={(e) => { setDsId(e.target.value); setMap({}); setMetricIds([]); }}>{datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
      </div>
      <fieldset><legend className="mb-2 text-sm font-medium">Qual coluna faz cada papel?</legend>
        <div className="grid gap-3 sm:grid-cols-2">{spec.roles.map((r) => {
          const opts = (ds?.columns ?? []).filter((c) => r.types.includes(c.type));
          return (
            <div key={r.key}><label htmlFor={`tf-${r.key}`} className="mb-1 block text-sm">{r.label}{r.required ? ' *' : ''}</label>
              <Select id={`tf-${r.key}`} value={map[r.key] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [r.key]: e.target.value }))}><option value="">{r.required ? 'Escolha…' : 'Não tenho / ignorar'}</option>{opts.map((c) => <option key={c.key} value={c.key}>{c.name} — {typeLabel(c.type)}</option>)}</Select>
              {r.hint ? <p className="mt-1 text-xs text-muted">{r.hint}</p> : null}
              {opts.length === 0 ? <p className="mt-1 text-xs text-warning">Nenhuma coluna de tipo compatível neste dataset.</p> : null}
            </div>);
        })}</div>
      </fieldset>
      {(spec.extras ?? []).filter((x) => x.requiredFor?.some((k) => map[k])).map((x) => (
        <div key={x.key}><label htmlFor={`tf-x-${x.key}`} className="mb-1 block text-sm font-medium">{x.label}</label><Input id={`tf-x-${x.key}`} value={extras[x.key] ?? ''} maxLength={100} onChange={(e) => setExtras((v) => ({ ...v, [x.key]: e.target.value }))} /></div>
      ))}
      {exec ? (
        <fieldset><legend className="mb-1 text-sm font-medium">Indicadores principais (até 8)</legend>
          {(ds?.metrics ?? []).length === 0 ? <p className="text-sm text-muted">Este dataset ainda não tem indicadores ativos.</p> : null}
          <ul className="space-y-1">{(ds?.metrics ?? []).map((m) => <li key={m.id}><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={metricIds.includes(m.id)} onChange={(e) => setMetricIds((x) => (e.target.checked ? [...x, m.id].slice(0, 8) : x.filter((i) => i !== m.id)))} /> {m.name}</label></li>)}</ul>
        </fieldset>
      ) : (
        <div className="text-sm">
          {plan.missingRequired.length ? <Alert tone="warning">Este modelo é incompatível com o dataset até você apontar: {plan.missingRequired.join(', ')}.</Alert>
            : <p className="text-muted">Será montado: {plan.widgets.length} widget(s) e {plan.metrics.length} indicador(es) (os que já existem com o mesmo nome são reaproveitados).{plan.skipped.length ? ` Ficam de fora por falta de campos: ${plan.skipped.join(', ')}.` : ''}</p>}
        </div>
      )}
      <div className="flex items-center gap-3"><SubmitButton pendingText="Montando…">Criar dashboard a partir do modelo</SubmitButton><FormMessage state={state} /></div>
    </form>
  );
}
