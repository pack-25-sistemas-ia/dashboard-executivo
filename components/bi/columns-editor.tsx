'use client';

import { useState } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import { Input, Select } from '@/components/ui/primitives';
import { updateColumns } from '@/lib/bi/actions/datasets';
import { SEMANTIC_LABELS } from '@/lib/bi/labels';
import { typeLabel, type DataType } from '@/lib/bi/engine';
import { useBiAction } from './use-bi-action';

export type ColRow = { key: string; name: string; type: DataType; semantic: string; description: string; dedupe: boolean; nulls: number | null };

/** Rótulos, descrição e papel das colunas da versão ativa. Tipo e chave não mudam aqui (isso é uma nova importação). */
export function ColumnsEditor({ datasetId, columns, rows, canEdit }: { datasetId: string; columns: ColRow[]; rows: number; canEdit: boolean }) {
  const [state, action, ref] = useBiAction(updateColumns, { reset: false });
  const [cols, setCols] = useState(columns);
  const upd = (i: number, p: Partial<ColRow>) => setCols((cs) => cs.map((c, j) => (j === i ? { ...c, ...p } : c)));
  return (
    <form ref={ref} action={action} noValidate>
      <input type="hidden" name="dataset_id" value={datasetId} />
      <input type="hidden" name="columns" value={JSON.stringify(cols.map((c) => ({ key: c.key, name: c.name, semantic: c.semantic === 'ignore' ? 'dimension' : c.semantic, description: c.description })))} />
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[760px] text-sm"><caption className="sr-only">Colunas do dataset</caption>
          <thead><tr className="text-left text-xs uppercase tracking-wide text-muted"><th scope="col" className="px-3 py-2">Nome</th><th scope="col" className="px-3 py-2">Tipo</th><th scope="col" className="px-3 py-2">Papel</th><th scope="col" className="px-3 py-2">Vazios</th><th scope="col" className="px-3 py-2">Descrição</th></tr></thead>
          <tbody>{cols.map((c, i) => (
            <tr key={c.key} className="border-t border-border">
              <td className="px-3 py-2">{canEdit ? <Input aria-label={`Nome da coluna ${c.name}`} value={c.name} maxLength={80} onChange={(e) => upd(i, { name: e.target.value })} /> : c.name}{c.dedupe ? <span className="ml-1 text-xs text-muted">(chave)</span> : null}</td>
              <td className="px-3 py-2">{typeLabel(c.type)}</td>
              <td className="px-3 py-2">{canEdit ? <Select aria-label={`Papel da coluna ${c.name}`} value={c.semantic} onChange={(e) => upd(i, { semantic: e.target.value })}>{['dimension', 'measure', 'time', 'identifier'].map((s) => <option key={s} value={s}>{SEMANTIC_LABELS[s]}</option>)}</Select> : SEMANTIC_LABELS[c.semantic]}</td>
              <td className="px-3 py-2 tabular-nums">{c.nulls === null ? '—' : `${c.nulls.toLocaleString('pt-BR')}${rows ? ` (${((c.nulls / rows) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)` : ''}`}</td>
              <td className="px-3 py-2">{canEdit ? <Input aria-label={`Descrição da coluna ${c.name}`} value={c.description} maxLength={300} onChange={(e) => upd(i, { description: e.target.value })} /> : c.description}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {canEdit ? <div className="mt-3 flex items-center gap-3"><SubmitButton pendingText="Salvando…">Salvar rótulos e papéis</SubmitButton><FormMessage state={state} /></div> : null}
    </form>
  );
}
