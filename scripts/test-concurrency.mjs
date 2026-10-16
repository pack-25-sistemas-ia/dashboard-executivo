#!/usr/bin/env node
// Concorrência REAL: várias sessões psql simultâneas contra o mesmo banco (dados confirmados, sem rollback).
// Prova: o mesmo job de importação é publicado uma única vez; só uma importação por dataset fica em andamento; lotes paralelos não perdem nem duplicam linhas;
// quem consulta durante uma publicação vê a versão antiga INTEIRA ou a nova INTEIRA (nunca mistura); salvamentos simultâneos de dashboard com a mesma versão
// têm um vencedor só; versões de métrica e de dashboard saem numeradas sem buracos nem repetição.
// Uso: node scripts/test-concurrency.mjs   (requer Docker; banco descartável, sem porta publicada)
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbDir = join(root, 'supabase');
const name = `pack25-bi-conc-${randomBytes(4).toString('hex')}`;
const IMAGE = process.env.PG_TEST_IMAGE ?? 'postgres:17-alpine';
const OWNER = 'ffffffff-0000-4000-8000-0000000000a0';
const docker = (a, o = {}) => spawnSync('docker', a, { encoding: 'utf8', ...o });

// «Largada sincronizada»: depois de armGun(), toda chamada espera um alvo comum (advisory lock) liberado só quando o canhão termina;
// assim as sessões entram no motor AO MESMO TEMPO, não uma depois da outra.
const GUN_KEY = 7777009;
const GUN_MS = 3500;
let gunOn = false;
function psql(sql, { asOwner = false } = {}) {
  const wrapped = asOwner
    ? `begin; select set_config('request.jwt.claims', '{"sub":"${OWNER}","aal":"aal2","email":"oa@t.invalid"}', true); set local role authenticated; ${gunOn ? `select pg_advisory_xact_lock_shared(${GUN_KEY});` : ''} ${sql}; commit`
    : sql;
  return new Promise((resolve) => {
    const p = spawn('docker', ['exec', '-i', name, 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'core'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
    p.stdin.end(wrapped);
  });
}
async function armGun() {
  gunOn = true;
  spawn('docker', ['exec', '-i', name, 'psql', '-X', '-q', '-t', '-A', '-U', 'postgres', '-d', 'core', '-c', `select pg_advisory_lock(${GUN_KEY}); select pg_sleep(${GUN_MS / 1000});`], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    const r = await psql("select count(*) from pg_locks where locktype = 'advisory' and granted and mode = 'ExclusiveLock'");
    if (r.out.trim() === '1') return;
    await new Promise((res) => setTimeout(res, 100));
  }
}
const one = async (sql, opts) => { const r = await psql(sql, opts); if (r.code !== 0) throw new Error(r.err); return r.out.split('\n').filter(Boolean).pop(); };
const fire = async (n, make) => { await armGun(); return Promise.all(Array.from({ length: n }, (_, k) => make(k))); };
const lastLine = (r) => r.out.split('\n').filter(Boolean).pop();
const oks = (rs) => rs.filter((r) => r.code === 0).length;

let failed = 0;
const check = (cond, label) => { console.log(`  ${cond ? 'PASS' : 'FALHOU'}: ${label}`); if (!cond) failed++; };

try {
  if (docker(['version', '--format', '{{.Server.Version}}']).status !== 0) throw new Error('Docker indisponível');
  const run = docker(['run', '-d', '--rm', '--name', name, '-e', `POSTGRES_PASSWORD=${randomBytes(16).toString('hex')}`, '-e', 'POSTGRES_DB=core', IMAGE, '-c', 'max_connections=200']);
  if (run.status !== 0) throw new Error(run.stderr);
  for (let i = 0; i < 60; i++) {
    if (docker(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'core']).status === 0) break;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)']);
  }
  for (const f of ['tests/00_harness.sql', ...readdirSync(join(dbDir, 'migrations')).sort().map((x) => `migrations/${x}`)]) {
    const r = await psql(readFileSync(join(dbDir, f), 'utf8'));
    if (r.code !== 0) throw new Error(`${f}: ${r.err}`);
  }
  await psql(`insert into auth.users (id, email) values ('${OWNER}', 'oa@t.invalid')`);
  const org = await one(`select public.create_organization('Empresa Concorrência', 'empresa-conc-bi')`, { asOwner: true });
  const COLS = '[{"key":"c1","name":"Id","type":"string","required":true,"dedupe":true,"position":0},{"key":"c2","name":"Data","type":"date","position":1},{"key":"c3","name":"Valor","type":"currency","position":2}]';
  const rowsJson = (prefix, n, value) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ n: i + 2, k: `${prefix}${i}`, v: { c1: `${prefix}${i}`, c2: '2026-03-01', c3: String(value) } })));
  const hash = (c) => c.repeat(64);
  const begin = (ds, h, total, mode = 'replace', name = null) => psql(`select public.bi_begin_import('${org}', ${ds ? `'${ds}'` : 'null'}, ${name ? `'${name}'` : 'null'}, 'x.csv', '${h}', 'csv', '${mode}', 'reject_all', '${COLS}'::jsonb, '{}', ${total})`, { asOwner: true });
  const jf = (r) => JSON.parse(lastLine(r));
  // importa (sem publicar) um conjunto completo de linhas, em passos separados como o app
  const load = async (ds, h, prefix, n, value, name = null) => {
    const b = jf(await begin(ds, h, n, 'replace', name));
    await one(`select public.bi_stage_rows('${org}', '${b.job_id}', '${rowsJson(prefix, n, value)}'::jsonb)`, { asOwner: true });
    await one(`select public.bi_finish_import('${org}', '${b.job_id}', ${n}, 0)`, { asOwner: true });
    return b;
  };

  // 1) publicar o MESMO job pronto em 8 sessões: uma publicação, uma versão ativa, linhas corretas
  const b1 = await load(null, hash('1'), 'a', 200, 10, 'Vendas concorrentes');
  const ds = b1.dataset_id;
  const r1 = await fire(8, () => psql(`select public.bi_publish_import('${org}', '${b1.job_id}')`, { asOwner: true }));
  check(oks(r1) === 1, `8 publicações simultâneas do mesmo job: só 1 vale (valeram ${oks(r1)})`);
  check(r1.filter((r) => r.code !== 0).every((r) => /já publicada/.test(r.err)), 'as demais falham por «importação já publicada» (a trava do dataset serializa)');
  check(Number(await one(`select row_count from public.dataset_versions where id = (select current_version_id from public.datasets where id = '${ds}')`)) === 200
    && Number(await one(`select count(*) from public.dataset_rows where dataset_version_id = '${b1.version_id}'`)) === 200, 'a versão ativa tem exatamente 200 linhas (sem duplicar)');
  check(Number(await one(`select count(*) from public.dataset_versions where dataset_id = '${ds}' and status = 'published'`)) === 1, 'exatamente uma versão publicada');

  // 2) só uma importação em andamento por dataset: 6 inícios simultâneos → 1 entra
  const r2 = await fire(6, (k) => begin(ds, hash(String(k + 2)), 10));
  check(oks(r2) === 1 && r2.filter((r) => r.code !== 0).every((r) => /importação em andamento|import_jobs_one_running|duplicate key/.test(r.err)), `6 inícios simultâneos de importação no mesmo dataset: só 1 entra (entraram ${oks(r2)})`);
  const open = jf(r2.find((r) => r.code === 0));
  await one(`select public.bi_fail_import('${org}', '${open.job_id}', 'fim do cenário 2')`, { asOwner: true });

  // 3) leitores durante a troca de versão: cada resposta é a versão 1 INTEIRA (200 linhas = 2.000) ou a 2 INTEIRA (300 linhas = 6.000) — nunca mistura
  const b3 = await load(ds, hash('b'), 'b', 300, 20);
  const spec = JSON.stringify({ dataset_id: ds, measures: [{ alias: 'm0', agg: 'sum', field: 'c3' }, { alias: 'm1', agg: 'count' }] });
  const reader = `select ((public.bi_run_query('${org}', '${spec}'::jsonb) -> 'rows') -> 0)::text`;
  await armGun();
  const pub = psql(`select public.bi_publish_import('${org}', '${b3.job_id}', true)`, { asOwner: true });
  const reads = await Promise.all(Array.from({ length: 30 }, () => psql(reader, { asOwner: true })));
  const pr = await pub;
  const seen = new Set(reads.filter((r) => r.code === 0).map((r) => { const o = JSON.parse(lastLine(r)); return `${o.m0}/${o.m1}`; }));
  check(pr.code === 0 && reads.every((r) => r.code === 0), 'a publicação e as 30 leituras simultâneas terminaram sem erro');
  check([...seen].every((x) => x === '2000/200' || x === '6000/300'), `toda leitura viu a versão 1 inteira ou a versão 2 inteira (vistas: ${[...seen].join(' | ')})`);
  check(Number(await one(`select row_count from public.dataset_versions where id = '${b3.version_id}'`)) === 300, 'a nova versão ficou ativa com 300 linhas');

  // 4) lotes paralelos no mesmo job: 4 sessões enviando lotes diferentes → total correto, sem duplicar
  const b4 = jf(await begin(ds, hash('c'), 300));
  const r4 = await fire(4, (k) => psql(`select public.bi_stage_rows('${org}', '${b4.job_id}', '${rowsJson('c' + k + '_', 100, 5)}'::jsonb)`, { asOwner: true }));
  check(oks(r4) === 3 && r4.filter((r) => r.code !== 0).every((r) => /mais linhas do que o declarado/.test(r.err)), `4 lotes simultâneos de 100 linhas para um arquivo de 300: exatamente 3 entram e o 4º é recusado (entraram ${oks(r4)})`);
  check(Number(await one(`select count(*) from public.dataset_rows where dataset_version_id = '${b4.version_id}'`)) === 300, 'e o staging tem exatamente 300 linhas (a contagem declarada não foi ultrapassada)');
  const r4b = await fire(3, () => psql(`select public.bi_stage_rows('${org}', '${b4.job_id}', '${rowsJson('extra', 5, 1)}'::jsonb)`, { asOwner: true }));
  check(oks(r4b) === 0, 'passar do total declarado é recusado mesmo em paralelo (nenhum lote extra entrou)');
  await one(`select public.bi_fail_import('${org}', '${b4.job_id}', 'fim do cenário 4')`, { asOwner: true });

  // 5) dashboard: 6 salvamentos com a MESMA versão esperada → 1 vencedor; os demais recebem conflito de edição
  const d = await one(`select public.bi_create_dashboard('${org}', 'Dashboard concorrente')`, { asOwner: true });
  const widget = (t) => JSON.stringify([{ widget_type: 'text', title: t, display_json: { text: t }, layout_json: { lg: { x: 0, y: 0, w: 4, h: 2 } } }]);
  const r5 = await fire(6, (k) => psql(`select public.bi_save_dashboard('${org}', '${d}', 1, 'Dashboard concorrente', 'v${k}', 'last_30', 'previous_period', 'same_days', '${widget('W' + k)}'::jsonb, '[]')`, { asOwner: true }));
  check(oks(r5) === 1 && r5.filter((r) => r.code !== 0).every((r) => /conflito de edição/.test(r.err)), `6 salvamentos com a mesma versão: 1 vence, 5 recebem «conflito de edição» (venceram ${oks(r5)})`);
  check(Number(await one(`select row_version from public.dashboards where id = '${d}'`)) === 2 && Number(await one(`select count(*) from public.dashboard_widgets where dashboard_id = '${d}'`)) === 1, 'versão final = 2 e exatamente 1 widget (nada foi sobrescrito em silêncio nem duplicado)');
  const w = await one(`select title from public.dashboard_widgets where dashboard_id = '${d}'`);
  const desc = await one(`select description from public.dashboards where id = '${d}'`);
  check(w.replace('W', '') === desc.replace('v', ''), 'o título do widget e a descrição vêm do MESMO vencedor (gravação atômica)');

  // 6) publicação simultânea do dashboard → versões sem buracos
  await one(`select public.bi_save_dashboard('${org}', '${d}', 2, 'Dashboard concorrente', 'final', 'last_30', 'previous_period', 'same_days', '${widget('Final')}'::jsonb, '[]')`, { asOwner: true });
  const r6 = await fire(6, () => psql(`select public.bi_publish_dashboard('${org}', '${d}', 'private')`, { asOwner: true }));
  const nums6 = (await one(`select string_agg(version_number::text, ',' order by version_number) from public.dashboard_versions where dashboard_id = '${d}'`)).split(',').map(Number);
  check(oks(r6) === 6 && nums6.every((n, i) => n === i + 1), `6 publicações simultâneas do dashboard: versões 1..6 sem buracos (obtido ${nums6.join(',')})`);

  // 7) métricas: 6 alterações simultâneas → numeração contínua
  const m = JSON.parse(await one(`select public.bi_save_metric('${org}', null, '${ds}', 'Faturamento', null, 'aggregation', 'sum', 'c3', null, '[]', 'currency', null)`, { asOwner: true }));
  const r7 = await fire(6, (k) => psql(`select public.bi_save_metric('${org}', '${m.id}', '${ds}', 'Faturamento', 'rev ${k}', 'aggregation', 'sum', 'c3', null, '[]', 'currency', null)`, { asOwner: true }));
  const nums7 = (await one(`select string_agg(version_number::text, ',' order by version_number) from public.metric_versions where metric_id = '${m.id}'`)).split(',').map(Number);
  check(oks(r7) === 6 && nums7.every((n, i) => n === i + 1) && nums7.length === 7, `6 alterações simultâneas de métrica: versões 1..7 sem buracos (obtido ${nums7.join(',')})`);

  // 8) criação simultânea do mesmo nome → um só
  const r8 = await fire(6, () => psql(`select public.bi_create_dataset('${org}', 'Nome repetido')`, { asOwner: true }));
  check(oks(r8) === 1, `6 criações simultâneas do mesmo nome de dataset: só 1 (criou ${oks(r8)})`);
  const r8b = await fire(6, () => psql(`select public.bi_create_dashboard('${org}', 'Painel repetido')`, { asOwner: true }));
  check(oks(r8b) === 1, `6 criações simultâneas do mesmo nome de dashboard: só 1 (criou ${oks(r8b)})`);

  // 9) acréscimo com chaves já existentes: nenhuma chave duplicada na versão final, publicação única
  const base = await load(null, hash('d'), 'k', 50, 1, 'Acréscimos');
  await one(`select public.bi_publish_import('${org}', '${base.job_id}')`, { asOwner: true });
  const ds9 = base.dataset_id;
  const b9 = jf(await begin(ds9, hash('e'), 60, 'append'));
  await one(`select public.bi_stage_rows('${org}', '${b9.job_id}', '${rowsJson('k', 60, 2)}'::jsonb)`, { asOwner: true });
  await one(`select public.bi_finish_import('${org}', '${b9.job_id}', 60, 0)`, { asOwner: true });
  const pa1 = await fire(4, () => psql(`select public.bi_publish_import('${org}', '${b9.job_id}')`, { asOwner: true }));
  check(oks(pa1) === 1, '4 publicações simultâneas do acréscimo: só 1 vale');
  check(Number(await one(`select row_count from public.dataset_versions where id = (select current_version_id from public.datasets where id = '${ds9}')`)) === 60 && Number(await one(`select skipped_existing from public.import_jobs where id = '${b9.job_id}'`)) === 50, 'acréscimo: 60 linhas ativas e 50 ignoradas por chave repetida');
  check(Number(await one(`select count(*) from (select row_key from public.dataset_rows where dataset_version_id = (select current_version_id from public.datasets where id = '${ds9}') group by row_key having count(*) > 1) x`)) === 0, 'nenhuma chave de deduplicação repetida na versão ativa');

  // consistência final
  check(Number(await one(`select count(*) from public.datasets d where (select count(*) from public.dataset_versions v where v.dataset_id = d.id and v.status = 'published') > 1`)) === 0, 'nenhum dataset tem duas versões publicadas');
  check(Number(await one(`select count(*) from public.datasets d join public.dataset_versions v on v.id = d.current_version_id where v.status <> 'published'`)) === 0, 'toda versão ativa está publicada');
  check(Number(await one(`select count(*) from public.import_jobs where status = 'processing'`)) === 0, 'nenhuma importação ficou presa em andamento');
  check(Number(await one(`select count(*) from pg_stat_activity where wait_event_type = 'Lock' and datname = 'core'`)) === 0, 'nenhuma sessão ficou presa em trava (sem impasse)');
} catch (e) {
  console.error(String(e.message ?? e));
  failed++;
} finally {
  docker(['rm', '-f', name]);
}
console.log(failed ? `CONCORRÊNCIA: ${failed} FALHA(S)` : 'CONCORRÊNCIA: TODOS OS TESTES PASSARAM');
process.exit(failed ? 1 : 0);
