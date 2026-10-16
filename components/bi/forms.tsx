'use client';

import { shareDashboard, createDashboard } from '@/lib/bi/actions/dashboards';
import { createDataset, updateDataset } from '@/lib/bi/actions/datasets';
import { saveDimension } from '@/lib/bi/actions/models';
import { saveGoal, saveView, setGoalPeriod, updateSettings } from '@/lib/bi/actions/misc';
import { GOAL_LABEL, PRESETS, PRESET_LABEL } from '@/lib/bi/engine';
import { PERMISSION_LABELS } from '@/lib/bi/labels';
import type { BiSettings } from '@/lib/bi/page';
import { BiForm, CheckF, SelectF, TextF } from './fields';
import type { Opt } from './bits';

// Formulários dos Server Components: as funções de renderização dos campos ficam aqui, no cliente (não atravessam a fronteira servidor→cliente).

export function DatasetCreateForm({ canRestrict }: { canRestrict: boolean }) {
  return (
    <BiForm action={createDataset} submit="Criar dataset" className="grid gap-4 sm:grid-cols-2">
      {(f) => (<><TextF f={f} name="name" label="Nome" required max={80} /><TextF f={f} name="description" label="Descrição (opcional)" max={500} />{canRestrict ? <CheckF f={f} name="restricted" label="Dataset restrito (só administradores e pessoas autorizadas veem os dados)" /> : null}</>)}
    </BiForm>
  );
}
export function DatasetEditForm({ id, name, description, restricted, canRestrict }: { id: string; name: string; description: string | null; restricted: boolean; canRestrict: boolean }) {
  return (
    <BiForm action={updateDataset} submit="Salvar" reset={false} className="grid gap-3" hidden={{ id }}>
      {(f) => (<><TextF f={f} name="name" label="Nome" def={name} required max={80} /><TextF f={f} name="description" label="Descrição" def={description} max={500} />{canRestrict ? <CheckF f={f} name="restricted" label="Dataset restrito" def={restricted} /> : null}</>)}
    </BiForm>
  );
}
export function DimensionForm({ datasetId, columns }: { datasetId: string; columns: Opt[] }) {
  return (
    <BiForm action={saveDimension} submit="Salvar dimensão" className="grid gap-3" hidden={{ dataset_id: datasetId }}>
      {(f) => (<><TextF f={f} name="name" label="Nome" required max={80} /><SelectF f={f} name="column_key" label="Coluna" opts={columns} /><SelectF f={f} name="dimension_type" label="Tipo" def="category" opts={[{ value: 'category', label: 'Categoria' }, { value: 'time', label: 'Tempo (coluna de data)' }]} /></>)}
    </BiForm>
  );
}
export function DashboardCreateForm() {
  return (
    <BiForm action={createDashboard} submit="Criar e abrir o editor" className="grid gap-4 sm:grid-cols-2">
      {(f) => (<><TextF f={f} name="name" label="Nome" required max={80} /><TextF f={f} name="description" label="Descrição (opcional)" max={500} /></>)}
    </BiForm>
  );
}
export function SaveViewForm({ datasetId, filters, columns, sorting }: { datasetId: string; filters: string; columns: string; sorting: string }) {
  return (
    <BiForm action={saveView} submit="Salvar visão" className="grid gap-3" hidden={{ dataset_id: datasetId, filters, columns, sorting }}>
      {(f) => <TextF f={f} name="name" label="Nome da visão" required max={80} />}
    </BiForm>
  );
}
export function GoalForm({ metrics, members }: { metrics: Opt[]; members: Opt[] }) {
  return (
    <BiForm action={saveGoal} submit="Criar meta" className="grid gap-4 sm:grid-cols-3">
      {(f) => (
        <>
          <TextF f={f} name="name" label="Nome" required max={80} />
          <SelectF f={f} name="metric_id" label="Indicador" opts={metrics} placeholder="Escolha…" required />
          <SelectF f={f} name="kind" label="Direção" def="min" opts={Object.entries(GOAL_LABEL).map(([value, label]) => ({ value, label }))} />
          <SelectF f={f} name="period_type" label="Período" def="month" opts={[{ value: 'month', label: 'Mensal' }, { value: 'quarter', label: 'Trimestral' }, { value: 'year', label: 'Anual' }, { value: 'custom', label: 'Personalizado (defina o alvo do período abaixo)' }]} />
          <TextF f={f} name="target" label="Valor-alvo (ou % em crescimento/redução)" required inputMode="decimal" placeholder="100000" />
          <TextF f={f} name="target_high" label="Limite superior (só faixa)" inputMode="decimal" />
          <TextF f={f} name="warn_pct" label="«Atenção» abaixo de (% do alvo)" def="80" inputMode="decimal" />
          <SelectF f={f} name="comparison" label="Comparar com (crescimento/redução)" def="previous_period" opts={[{ value: 'previous_period', label: 'Período anterior' }, { value: 'previous_month', label: 'Mês anterior' }, { value: 'previous_year', label: 'Ano anterior' }]} />
          <SelectF f={f} name="owner_id" label="Responsável" placeholder="Eu mesmo" opts={members} />
        </>
      )}
    </BiForm>
  );
}
export function GoalPeriodForm({ goals }: { goals: Opt[] }) {
  return (
    <BiForm action={setGoalPeriod} submit="Salvar alvo do período" className="grid gap-4 sm:grid-cols-4">
      {(f) => (<><SelectF f={f} name="goal_id" label="Meta" opts={goals} /><TextF f={f} name="start" label="De" type="date" required /><TextF f={f} name="end" label="Até" type="date" required /><TextF f={f} name="target" label="Alvo do período" required inputMode="decimal" /></>)}
    </BiForm>
  );
}
export function ShareForm({ dashboards, members, preset }: { dashboards: Opt[]; members: Opt[]; preset: string }) {
  return (
    <BiForm action={shareDashboard} submit="Conceder acesso" className="grid gap-4 sm:grid-cols-3">
      {(f) => (<><SelectF f={f} name="dashboard_id" label="Dashboard" def={preset} placeholder="Escolha…" required opts={dashboards} /><SelectF f={f} name="user_id" label="Pessoa" placeholder="Escolha…" required opts={members} /><SelectF f={f} name="level" label="Permissão" def="view" opts={Object.entries(PERMISSION_LABELS).map(([value, label]) => ({ value, label }))} /></>)}
    </BiForm>
  );
}
const ZONES = ['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Fortaleza', 'America/Bahia', 'America/Belem', 'America/Recife', 'America/Rio_Branco', 'America/Noronha', 'UTC'];
export function SettingsForm({ s }: { s: BiSettings }) {
  return (
    <BiForm action={updateSettings} submit="Salvar configurações" reset={false} className="grid gap-4 sm:grid-cols-3">
      {(f) => (
        <>
          <SelectF f={f} name="timezone" label="Fuso horário da empresa" def={s.timezone} opts={ZONES.map((z) => ({ value: z, label: z }))} hint="Define «hoje», os períodos e o dia civil de colunas com hora." />
          <SelectF f={f} name="date_format" label="Formato de data nas telas" def={s.date_format} opts={[{ value: 'DD/MM/YYYY', label: 'DD/MM/AAAA' }, { value: 'YYYY-MM-DD', label: 'AAAA-MM-DD' }]} />
          <TextF f={f} name="portal_name" label="Nome do portal" def={s.portal_name} max={60} hint="Aparece no menu lateral." />
          <TextF f={f} name="max_rows" label="Máximo de linhas por dataset" def={String(s.max_rows)} inputMode="numeric" hint="Entre 1.000 e 50.000 (meta inicial de engenharia; medida nos testes)." />
          <TextF f={f} name="max_file_mb" label="Tamanho máximo do arquivo (MB)" def={String(s.max_file_mb)} inputMode="numeric" hint="Entre 1 e 20." />
          <TextF f={f} name="stale_days" label="Dataset desatualizado após (dias)" def={String(s.stale_days)} inputMode="numeric" />
          <TextF f={f} name="retained_versions" label="Versões com linhas guardadas" def={String(s.retained_versions)} inputMode="numeric" hint="Entre 2 e 20. As mais antigas perdem as linhas, mas mantêm esquema, contagens e histórico." />
          <SelectF f={f} name="default_period" label="Período padrão de novos dashboards" def={s.default_period} opts={PRESETS.filter((x) => x !== 'custom').map((x) => ({ value: x, label: PRESET_LABEL[x] }))} />
        </>
      )}
    </BiForm>
  );
}
