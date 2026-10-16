'use server';

import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { bustBi, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';
import { accessSchema, columnsEditSchema, datasetEditSchema, datasetSchema, idSchema } from '../schemas';

export async function createDataset(_: ActionState, fd: FormData): Promise<SaveResult> {
  const raw = formObject(fd);
  const p = parse(datasetSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'createDataset', async (ctx, org) => {
    const { data, error } = await ctx.supabase.rpc('bi_create_dataset', { p_org: org, p_name: p.data.name, p_description: p.data.description, p_restricted: p.data.restricted });
    if (error) return fail(dbMessage(error, 'Já existe um dataset com este nome.'), undefined, raw);
    bustBi();
    return { ...succeed('Dataset criado. Agora importe um arquivo CSV ou XLSX.'), id: data as string, redirectTo: `/importacoes/nova?dataset=${data as string}` };
  });
}

export async function updateDataset(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(datasetEditSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'updateDataset', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('bi_update_dataset', { p_org: org, p_dataset: p.data.id, p_name: p.data.name, p_description: p.data.description, p_restricted: p.data.restricted });
    if (error) return fail(dbMessage(error, 'Já existe um dataset com este nome.'), undefined, raw);
    bustBi();
    return succeed('Dataset atualizado.');
  });
}

export async function archiveDataset(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(idSchema.extend({ restore: idSchema.shape.id.optional() }), { id: raw.id }, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'archiveDataset', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('bi_archive_dataset', { p_org: org, p_dataset: p.data.id, p_archive: raw.restore !== 'true' });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustBi();
    return succeed(raw.restore === 'true' ? 'Dataset restaurado.' : 'Dataset arquivado. Dashboards que o usam deixam de responder até a restauração.');
  });
}

export async function setDatasetAccess(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(accessSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('admin', 'setDatasetAccess', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('bi_set_dataset_access', { p_org: org, p_dataset: p.data.dataset_id, p_user: p.data.user_id, p_grant: p.data.grant });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustBi();
    return succeed(p.data.grant ? 'Acesso concedido ao dataset restrito.' : 'Acesso removido (vale já na próxima consulta).');
  });
}

export async function updateColumns(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(columnsEditSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'updateColumns', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('bi_update_columns', { p_org: org, p_dataset: p.data.dataset_id, p_columns: p.data.columns });
    if (error) return fail(dbMessage(error, 'Há nomes de coluna repetidos.'), undefined, raw);
    bustBi();
    return succeed('Rótulos e papéis das colunas atualizados.');
  });
}
