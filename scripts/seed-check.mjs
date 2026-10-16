#!/usr/bin/env node
// Aplica migrações + supabase/seed.sql num Postgres descartável (Docker) e mostra o ERRO COM CONTEXTO, sem precisar subir o Supabase inteiro.
// Depois do seed, confere invariantes dos dados de demonstração (contagens, estados, imutabilidade religada).
// Uso: node scripts/seed-check.mjs   (requer Docker; banco sem porta publicada)
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbDir = join(root, 'supabase');
const name = `pack25-bi-seed-${randomBytes(4).toString('hex')}`;
const docker = (a, o = {}) => spawnSync('docker', a, { encoding: 'utf8', ...o });
const psql = (sql, label) => {
  const r = docker(['exec', '-i', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-U', 'postgres', '-d', 'core'], { input: sql });
  if (r.status !== 0) { console.error(`FALHOU em ${label}:\n${r.stderr}`); return null; }
  return r.stdout.trim();
};

let ok = false;
try {
  if (docker(['version', '--format', '{{.Server.Version}}']).status !== 0) throw new Error('Docker indisponível');
  const run = docker(['run', '-d', '--rm', '--name', name, '-e', `POSTGRES_PASSWORD=${randomBytes(16).toString('hex')}`, '-e', 'POSTGRES_DB=core', 'postgres:17-alpine']);
  if (run.status !== 0) throw new Error(run.stderr);
  for (let i = 0; i < 60; i++) {
    if (docker(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'core']).status === 0) break;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)']);
  }
  const files = ['tests/00_harness.sql', ...readdirSync(join(dbDir, 'migrations')).filter((f) => f.endsWith('.sql')).sort().map((f) => `migrations/${f}`)];
  // pgcrypto como no Supabase: schema «extensions» (o seed usa extensions.crypt)
  if (psql('create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions;', 'pgcrypto') === null) throw new Error('pgcrypto');
  // o harness tem um auth.users mínimo; o seed insere como no Supabase real: completa as colunas e a tabela de identidades
  const authExtra = ['instance_id uuid', 'aud text', 'role text', 'encrypted_password text', 'email_confirmed_at timestamptz', 'raw_app_meta_data jsonb', 'raw_user_meta_data jsonb', 'created_at timestamptz', 'updated_at timestamptz', 'confirmation_token text', 'email_change text', 'email_change_token_new text', 'recovery_token text'];
  const fixAuth = () => psql(authExtra.map((c) => `alter table auth.users add column if not exists ${c};`).join(' ') + ' create table if not exists auth.identities (id uuid primary key, user_id uuid, provider_id text, identity_data jsonb, provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);', 'auth');
  for (const f of files) { if (psql(readFileSync(join(dbDir, f), 'utf8'), f) === null) throw new Error(f); if (f === 'tests/00_harness.sql' && fixAuth() === null) throw new Error('auth'); }
  if (psql(readFileSync(join(dbDir, 'seed.sql'), 'utf8'), 'seed.sql') === null) throw new Error('seed');
  const q = (sql) => Number(psql(sql, sql.slice(0, 40)));
  const checks = [
    ['organização de demonstração', q("select count(*) from public.organizations where slug = 'horizonte'"), (n) => n === 1],
    ['datasets (3 abertos + 1 restrito)', q('select count(*) from public.datasets'), (n) => n === 4],
    ['dataset restrito', q('select count(*) from public.datasets where restricted'), (n) => n === 1],
    ['linhas de vendas na versão ativa', q("select row_count from public.dataset_versions v join public.datasets d on d.current_version_id = v.id where d.name = 'Vendas'"), (n) => n === 3600],
    ['linhas de despesas', q("select row_count from public.dataset_versions v join public.datasets d on d.current_version_id = v.id where d.name = 'Despesas'"), (n) => n === 700],
    ['linhas de atendimentos', q("select row_count from public.dataset_versions v join public.datasets d on d.current_version_id = v.id where d.name = 'Atendimentos'"), (n) => n === 1500],
    ['soma das linhas coincide com as contagens', q('select count(*) from public.dataset_rows'), (n) => n === 3600 + 700 + 1500 + 12],
    ['indicadores ativos', q("select count(*) from public.metric_definitions where status = 'active'"), (n) => n >= 9],
    ['dashboards (1 publicado para a empresa + 1 rascunho compartilhado)', q("select count(*) from public.dashboards where status in ('published', 'draft')"), (n) => n === 2],
    ['dashboard publicado visível à empresa', q("select count(*) from public.dashboards where status = 'published' and visibility = 'organization'"), (n) => n === 1],
    ['versão publicada do dashboard', q('select count(*) from public.dashboard_versions'), (n) => n === 1],
    ['widgets', q('select count(*) from public.dashboard_widgets'), (n) => n === 14],
    ['metas', q('select count(*) from public.goal_definitions'), (n) => n === 3],
    ['dataset desatualizado (despesas)', q("select count(*) from public.dataset_versions v join public.datasets d on d.current_version_id = v.id where d.name = 'Despesas' and v.published_at < now() - interval '10 days'"), (n) => n === 1],
    ['conjuntos marcados como demonstração', q("select count(*) from public.datasets where source_type = 'demo'"), (n) => n === 4],
    ['nenhuma importação presa', q("select count(*) from public.import_jobs where status <> 'published'"), (n) => n === 0],
    ['gatilhos de imutabilidade ligados', q("select count(*) from pg_trigger where tgname in ('rows_guard', 'version_guard', 'append_metric_versions', 'append_dashboard_versions') and tgenabled = 'O'"), (n) => n === 4],
  ];
  ok = true;
  for (const [label, n, test] of checks) { const pass = test(n); console.log(`  ${pass ? 'PASS' : 'FALHOU'}: ${label} (${n})`); if (!pass) ok = false; }
} catch (e) {
  console.error(String(e.message ?? e));
} finally {
  docker(['rm', '-f', name]);
}
console.log(ok ? 'SEED: OK' : 'SEED: FALHA');
process.exit(ok ? 0 : 1);
