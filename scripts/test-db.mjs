#!/usr/bin/env node
// Executa a migração do Core + testes RLS num Postgres descartável em Docker.
// Sem porta publicada (acesso só via docker exec) e com senha aleatória por execução.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// No repositório-fonte o banco do Core fica em core/supabase; dentro de um sistema isolado, em supabase/.
const coreDir = existsSync(join(root, 'core', 'supabase')) ? join(root, 'core', 'supabase') : join(root, 'supabase');
const name = `pack25-core-test-${randomBytes(4).toString('hex')}`;
const IMAGE = process.env.PG_TEST_IMAGE ?? 'postgres:17-alpine';
const docker = (a, o = {}) => spawnSync('docker', a, { encoding: 'utf8', ...o });

function psql(sql, label) {
  const r = docker(['exec', '-i', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-q', '-U', 'postgres', '-d', 'core'], { input: sql });
  const notices = (r.stderr ?? '').split('\n').filter((l) => /PASS:|ERROR|FATAL|ASSERT|assertion/i.test(l));
  notices.forEach((l) => console.log('  ' + l.replace(/^.*?(PASS:|ERROR|FATAL)/, '$1')));
  if (r.status !== 0) {
    console.error(`FALHOU em ${label}:\n${r.stderr}`);
    return false;
  }
  return true;
}

let ok = false;
try {
  if (docker(['version', '--format', '{{.Server.Version}}']).status !== 0) throw new Error('Docker indisponível');
  const run = docker(['run', '-d', '--rm', '--name', name, '-e', `POSTGRES_PASSWORD=${randomBytes(16).toString('hex')}`, '-e', 'POSTGRES_DB=core', IMAGE]);
  if (run.status !== 0) throw new Error(run.stderr);
  for (let i = 0; i < 60; i++) {
    if (docker(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'core']).status === 0) break;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)']);
  }
  const files = [
    ...['tests/00_harness.sql'],
    ...readdirSync(join(coreDir, 'migrations')).sort().map((f) => `migrations/${f}`),
    ...readdirSync(join(coreDir, 'tests')).filter((f) => /^[1-9]\d_.*\.sql$/.test(f)).sort().map((f) => `tests/${f}`),
  ];
  ok = true;
  for (const f of files) {
    console.log(`> ${f}`);
    if (!psql(readFileSync(join(coreDir, f), 'utf8'), f)) { ok = false; break; }
  }
} catch (e) {
  console.error(String(e.message ?? e));
} finally {
  docker(['rm', '-f', name]);
}
console.log(ok ? 'CORE DB: TODOS OS TESTES PASSARAM' : 'CORE DB: FALHA');
process.exit(ok ? 0 : 1);
