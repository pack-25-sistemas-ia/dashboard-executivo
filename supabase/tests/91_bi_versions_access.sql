-- Atualização de datasets: acréscimo com chave, substituição com impacto, retenção, falha que preserva a versão ativa,
-- importação parcial controlada, dataset restrito e limpeza de importações abandonadas.
-- Fixture mínima «Pedidos»: c1 pedido (texto, chave), c2 data, c3 valor (moeda), c4 região (texto).

\set as_oa 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"oa@t.invalid"}'', true); set local role authenticated;'
\set as_ma 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"ma@t.invalid"}'', true); set local role authenticated;'
\set as_na 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"na@t.invalid"}'', true); set local role authenticated;'
\set as_va 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"va@t.invalid"}'', true); set local role authenticated;'
\set as_ob 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000b0","aal":"aal2","email":"ob@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.nrows(v uuid) returns bigint language sql security definer set search_path = '' as $$ select count(*) from public.dataset_rows where dataset_version_id = v $$;
create function test.audit_n(p_action text, p_entity text) returns bigint language sql security definer set search_path = '' as $$ select count(*) from public.audit_log where action = p_action and entity_id = p_entity $$;
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
-- Importa pedidos como o chamador corrente: rows = [[pedido, data, valor, região], ...]
create function test.prep(p_ds uuid, p_name text, p_hash text, p_mode text, p_rows jsonb, p_cols jsonb default null, p_invalid int default 0, p_policy text default 'reject_all') returns jsonb
language plpgsql as $$
declare org uuid := test.t('org'); r jsonb; cols jsonb; payload jsonb; n int := jsonb_array_length(p_rows);
begin
  cols := coalesce(p_cols, '[{"key":"c1","name":"Pedido","type":"string","semantic":"identifier","required":true,"dedupe":true,"position":0},
    {"key":"c2","name":"Data","type":"date","semantic":"time","position":1},{"key":"c3","name":"Valor","type":"currency","semantic":"measure","position":2},
    {"key":"c4","name":"Região","type":"string","semantic":"dimension","position":3}]'::jsonb);
  r := public.bi_begin_import(org, p_ds, p_name, 'pedidos.csv', p_hash, 'csv', p_mode, p_policy, cols, '{}', n + p_invalid);
  select jsonb_agg(jsonb_build_object('n', i + 1, 'k', x ->> 0, 'v', jsonb_strip_nulls(jsonb_build_object('c1', x ->> 0, 'c2', x ->> 1, 'c3', x ->> 2, 'c4', x ->> 3)))) into payload
    from jsonb_array_elements(p_rows) with ordinality t(x, i);
  perform public.bi_stage_rows(org, (r ->> 'job_id')::uuid, payload);
  perform public.bi_finish_import(org, (r ->> 'job_id')::uuid, n, p_invalid,
    case when p_invalid > 0 then '[{"row":3,"column":"c3","code":"invalid_number","message":"Número inválido.","value":"abc"},{"row":9,"column":"c2","code":"invalid_date","message":"Data inválida.","value":"31/02/2026"}]'::jsonb else '[]'::jsonb end);
  return r;
end $$;
create function test.load(p_ds uuid, p_name text, p_hash text, p_mode text, p_rows jsonb, p_cols jsonb default null, p_invalid int default 0, p_policy text default 'reject_all', p_ack boolean default false) returns jsonb
language plpgsql as $$
declare r jsonb := test.prep(p_ds, p_name, p_hash, p_mode, p_rows, p_cols, p_invalid, p_policy);
begin
  return r || public.bi_publish_import(test.t('org'), (r ->> 'job_id')::uuid, p_ack);
end $$;
create function test.sum(p_spec jsonb default '{}') returns text language sql as $$
  select (public.bi_run_query(test.t('org'), jsonb_build_object('dataset_id', test.t('ds'), 'measures', '[{"alias":"m0","agg":"sum","field":"c3"}]'::jsonb) || p_spec) -> 'rows' -> 0) ->> 'm0' $$;
create function test.cnt() returns text language sql as $$
  select (public.bi_run_query(test.t('org'), jsonb_build_object('dataset_id', test.t('ds'), 'measures', '[{"alias":"m0","agg":"count"}]'::jsonb)) -> 'rows' -> 0) ->> 'm0' $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'oa@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'ma@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 'na@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a3', 'va@t.invalid'), ('ffffffff-0000-4000-8000-0000000000b0', 'ob@t.invalid');

:as_oa
do $$
declare org uuid;
begin
  org := public.create_organization('BI Versões', 'bi-versoes');
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'viewer');
  perform set_config('t.org', org::text, true);
  raise notice 'PASS: bloco (1)';
end $$;
reset role;

-- ===================================================================== carga inicial e acréscimo com chave de deduplicação
:as_na
do $$
declare r jsonb; ds uuid;
begin
  r := test.load(null, 'Pedidos', repeat('1', 64), 'replace', '[["P1","2026-01-10","100","Sul"],["P2","2026-01-11","200","Norte"],["P3","2026-01-12","300","Sul"]]');
  ds := (r ->> 'dataset_id')::uuid;
  perform set_config('t.ds', ds::text, true); perform set_config('t.v1', r ->> 'version_id', true);
  assert test.cnt() = '3' and test.sum() = '600', 'carga inicial: 3 pedidos, soma 600';
  -- acréscimo: P3 já existe (ignorado e contado), P4 e P5 entram; as linhas da versão ativa acompanham
  r := test.load(ds, null, repeat('2', 64), 'append', '[["P3","2026-01-12","999","Sul"],["P4","2026-02-01","50","Norte"],["P5","2026-02-02","25.5","Sul"]]');
  perform set_config('t.v2', r ->> 'version_id', true);
  assert (r ->> 'row_count')::int = 5 and (r ->> 'skipped_existing')::int = 1, 'acréscimo: 5 linhas no total, 1 ignorada por chave repetida';
  assert test.cnt() = '5' and test.sum() = '675.5', 'o P3 duplicado (999) NÃO duplicou nem sobrescreveu: soma 100+200+300+50+25,5';
  assert (select status from public.dataset_versions where id = test.t('v1')) = 'superseded' and (select status from public.dataset_versions where id = test.t('v2')) = 'published', 'versão anterior fica superada, nova ativa';
  assert test.nrows(test.t('v1')) = 3, 'a versão anterior preserva suas linhas (política de retenção)';
  assert (select skipped_existing from public.import_jobs where id = (r ->> 'job_id')::uuid) = 1, 'o job registra o ignorado';
  -- o mesmo conteúdo de acréscimo não passa duas vezes
  assert test.errmsg(format($q$select test.load(%L, null, %L, 'append', '[["P6","2026-02-03","1","Sul"]]')$q$, ds, repeat('2', 64))) like '%mesmo conteúdo%', 'reimportar o mesmo arquivo é barrado';
  assert test.errmsg(format($q$select test.load(%L, null, %L, 'append', '[["P3","2026-02-03","1","Sul"]]', '[{"key":"c1","name":"Pedido","type":"decimal","required":true,"dedupe":true},{"key":"c3","name":"Valor","type":"currency"}]')$q$, ds, repeat('3', 64))) like '%não correspondem ao esquema%', 'acréscimo com colunas diferentes do esquema é recusado';
  assert (select current_version_id from public.datasets where id = ds) = test.t('v2') and test.cnt() = '5', 'a recusa preservou a versão ativa';
  -- duplicidade dentro do próprio lote
  assert test.errmsg(format($q$select test.load(%L, null, %L, 'append', '[["P9","2026-02-03","1","Sul"],["P9","2026-02-04","2","Sul"]]')$q$, ds, repeat('4', 64))) like '%chave de deduplicação repetida%', 'duas linhas com a mesma chave no mesmo arquivo: barradas';
  raise notice 'PASS: carga inicial e acréscimo com chave de deduplicação (2)';
end $$;
reset role;
-- falha no meio, como no app (chamadas separadas): a importação fica «em andamento»; cancelar limpa o staging e libera o dataset; a versão ativa nunca mudou
:as_na
do $$
declare ds uuid := test.t('ds'); org uuid := test.t('org'); r jsonb; j uuid; v uuid;
begin
  r := public.bi_begin_import(org, ds, null, 'parcial.csv', repeat('5', 64), 'csv', 'append', 'reject_all',
    '[{"key":"c1","name":"Pedido","type":"string","required":true,"dedupe":true},{"key":"c2","name":"Data","type":"date"},{"key":"c3","name":"Valor","type":"currency"},{"key":"c4","name":"Região","type":"string"}]', '{}', 3);
  j := (r ->> 'job_id')::uuid; v := (r ->> 'version_id')::uuid;
  perform public.bi_stage_rows(org, j, '[{"n":2,"k":"Y1","v":{"c1":"Y1","c3":"1"}}]');
  assert test.errmsg(format($q$select public.bi_begin_import(%L, %L, null, 'x.csv', %L, 'csv', 'replace', 'reject_all', '[{"key":"c1","name":"A","type":"string"}]', '{}', 2)$q$, org, ds, repeat('6', 64))) like '%importação em andamento%', 'enquanto há job aberto, outro não começa';
  assert test.errmsg(format($q$select public.bi_finish_import(%L, %L, 3, 0)$q$, org, j)) like '%envio incompleto%', 'o envio parou no meio: não fecha';
  assert test.errmsg(format($q$select public.bi_publish_import(%L, %L)$q$, org, j)) like '%não está pronta%', 'e não publica';
  assert test.cnt() = '5' and (select current_version_id from public.datasets where id = ds) = test.t('v2'), 'a versão ativa continua servindo os 5 pedidos';
  perform public.bi_fail_import(org, j, 'limpeza');
  assert test.nrows(v) = 0 and (select status from public.dataset_versions where id = v) = 'failed', 'cancelar remove o staging e registra a versão como falha';
  assert not exists (select 1 from public.import_jobs where dataset_id = ds and status = 'processing'), 'dataset liberado';
  assert (select current_version_id from public.datasets where id = ds) = test.t('v2') and test.cnt() = '5', 'versão ativa intacta depois da falha';
  raise notice 'PASS: carga inicial e acréscimo com chave de deduplicação (3)';
end $$;
reset role;

-- ===================================================================== acréscimo exige chave; sem chave só substituição
:as_na
do $$
declare r jsonb; ds uuid;
begin
  r := test.load(null, 'Sem chave', repeat('6', 64), 'replace', '[["Q1","2026-01-10","10","Sul"]]',
    '[{"key":"c1","name":"Pedido","type":"string","required":true,"dedupe":false,"position":0},{"key":"c2","name":"Data","type":"date","position":1},{"key":"c3","name":"Valor","type":"currency","position":2},{"key":"c4","name":"Região","type":"string","position":3}]');
  ds := (r ->> 'dataset_id')::uuid;
  assert test.errmsg(format($q$select test.load(%L, null, %L, 'append', '[["Q2","2026-01-11","10","Sul"]]', '[{"key":"c1","name":"Pedido","type":"string","dedupe":false},{"key":"c2","name":"Data","type":"date"},{"key":"c3","name":"Valor","type":"currency"},{"key":"c4","name":"Região","type":"string"}]')$q$, ds, repeat('7', 64))) like '%chave de deduplicação%', 'sem chave configurada não há acréscimo (evita duplicar na reimportação)';
  raise notice 'PASS: acréscimo exige chave; sem chave só substituição (4)';
end $$;
reset role;

-- ===================================================================== substituição que remove coluna: impacto explícito
:as_na
do $$
declare ds uuid := test.t('ds'); org uuid := test.t('org'); m jsonb; mid uuid; imp jsonb; r jsonb; cols2 jsonb;
begin
  m := public.bi_save_metric(org, null, ds, 'Faturamento', null, 'aggregation', 'sum', 'c3', null, '[]', 'currency', 'R$');
  mid := (m ->> 'id')::uuid;
  perform set_config('t.mid', mid::text, true);
  assert (m ->> 'version')::int = 1, 'métrica criada na versão 1';
  cols2 := '[{"key":"c1","name":"Pedido","type":"string","required":true,"dedupe":true,"position":0},{"key":"c2","name":"Data","type":"date","position":1},{"key":"c4","name":"Região","type":"string","position":2}]';
  imp := public.bi_import_impact(org, ds, cols2);
  assert jsonb_array_length(imp) = 1 and imp -> 0 ->> 'kind' = 'métrica' and imp -> 0 ->> 'column' = 'Valor' and imp -> 0 ->> 'reason' = 'coluna removida', 'o impacto aponta a métrica que usa a coluna removida';
  assert jsonb_array_length(public.bi_import_impact(org, ds, '[{"key":"c1","name":"Pedido","type":"string","dedupe":true},{"key":"c2","name":"Data","type":"date"},{"key":"c3","name":"Valor","type":"integer"},{"key":"c4","name":"Região","type":"string"}]')) = 1, 'mudança de tipo também é impacto';
  assert jsonb_array_length(public.bi_import_impact(org, ds, '[{"key":"c1","name":"Pedido","type":"string"},{"key":"c2","name":"Data","type":"date"},{"key":"c3","name":"Valor","type":"currency"},{"key":"c4","name":"Região","type":"string"},{"key":"c5","name":"Nova","type":"string"}]')) = 0, 'coluna nova não causa impacto';
  r := test.prep(ds, null, repeat('8', 64), 'replace', '[["Z1","2026-03-01",null,"Sul"],["Z2","2026-03-02",null,"Norte"]]', cols2);
  assert test.errmsg(format($q$select public.bi_publish_import(%L, %L)$q$, org, (r ->> 'job_id'))) like '%afeta 1 item%confirme o impacto%', 'sem confirmar o impacto a substituição não publica';
  assert (select current_version_id from public.datasets where id = ds) = test.t('v2') and test.cnt() = '5', 'a recusa preservou a versão ativa';
  assert (select status from public.import_jobs where id = (r ->> 'job_id')::uuid) = 'ready', 'a importação continua pronta, aguardando a decisão';
  r := public.bi_publish_import(org, (r ->> 'job_id')::uuid, true);
  assert (r ->> 'row_count')::int = 2 and jsonb_array_length(r -> 'impact') = 1 and (r ->> 'metrics_changed')::int = 1, 'com confirmação publica e relata 1 métrica alterada';
  assert (select status from public.metric_definitions where id = mid) = 'invalid' and (select invalid_reason from public.metric_definitions where id = mid) like '%coluna usada não existe%', 'a métrica fica INVÁLIDA com o motivo';
  assert exists (select 1 from public.bi_notifications where type = 'metric_invalid' and user_id = 'ffffffff-0000-4000-8000-0000000000a2'), 'a equipe foi avisada';
  assert test.errmsg(format($q$select test.sum()$q$)) like '%coluna inválida%', 'consultar a coluna removida falha com clareza (nada de dado velho)';
  raise notice 'PASS: substituição que remove coluna: impacto explícito (5)';
end $$;
reset role;

-- ===================================================================== retenção explícita de versões
:as_oa
do $$
begin
  perform public.bi_update_settings(test.t('org'), 'America/Sao_Paulo', 'DD/MM/YYYY', null, 50000, 20, 7, 2, 'last_30');
  assert (select retained_versions from public.bi_settings where organization_id = test.t('org')) = 2, 'administrador configurou retenção = 2';
  raise notice 'PASS: retenção explícita de versões (6)';
end $$;
reset role;
:as_na
do $$
declare ds uuid := test.t('ds'); r jsonb; cols jsonb; vers uuid[] := '{}';
begin
  cols := '[{"key":"c1","name":"Pedido","type":"string","required":true,"dedupe":true,"position":0},{"key":"c2","name":"Data","type":"date","position":1},{"key":"c3","name":"Valor","type":"currency","position":2},{"key":"c4","name":"Região","type":"string","position":3}]';
  r := test.load(ds, null, repeat('a', 64), 'replace', '[["R1","2026-04-01","1","Sul"]]', cols, 0, 'reject_all', true);
  r := test.load(ds, null, repeat('b', 64), 'replace', '[["R2","2026-04-02","2","Sul"]]', cols, 0, 'reject_all', true);
  r := test.load(ds, null, repeat('c', 64), 'replace', '[["R3","2026-04-03","3","Sul"],["R4","2026-04-04","4","Sul"]]', cols, 0, 'reject_all', true);
  assert test.cnt() = '2' and test.sum() = '7', 'versão ativa tem as 2 linhas mais novas';
  -- mantém a ativa + 1 anterior com linhas; as mais antigas perdem as linhas mas mantêm metadados
  assert (select count(*) from public.dataset_versions where dataset_id = ds and rows_purged) >= 2, 'versões antigas tiveram as linhas removidas pela retenção';
  assert (select count(*) from public.dataset_versions where dataset_id = ds and not rows_purged and status = 'superseded') = 1, 'fica 1 versão anterior com linhas (retenção = 2 contando a ativa)';
  assert (select count(*) from public.dataset_versions where dataset_id = ds) >= 6, 'nenhum registro de versão foi apagado (histórico de esquema, origem e contagens preservado)';
  assert (select row_count from public.dataset_versions where id = test.t('v1')) = 3 and (select stats_json ->> 'rows' from public.dataset_versions where id = test.t('v1')) = '3', 'metadados e estatísticas da versão antiga continuam';
  assert test.nrows(test.t('v1')) = 0, 'a versão 1 não tem mais linhas';
  assert test.audit_n('import_published', ds::text) >= 5, 'cada publicação foi auditada';
  raise notice 'PASS: retenção explícita de versões (7)';
end $$;
reset role;

-- ===================================================================== importação parcial controlada (linhas inválidas)
:as_na
do $$
declare org uuid := test.t('org'); ds uuid := test.t('ds'); r jsonb; job uuid; cols jsonb;
begin
  cols := '[{"key":"c1","name":"Pedido","type":"string","required":true,"dedupe":true,"position":0},{"key":"c2","name":"Data","type":"date","position":1},{"key":"c3","name":"Valor","type":"currency","position":2},{"key":"c4","name":"Região","type":"string","position":3}]';
  -- política padrão: com linha inválida, NADA é publicado
  r := test.prep(ds, null, repeat('d', 64), 'replace', '[["S1","2026-05-01","10","Sul"]]', cols, 2, 'reject_all');
  assert test.errmsg(format($q$select public.bi_publish_import(%L, %L, true)$q$, org, (r ->> 'job_id'))) like '%2 linha(s) com erro%', 'reject_all: linha inválida impede a publicação';
  perform public.bi_fail_import(org, (r ->> 'job_id')::uuid, 'revisão');
  assert test.cnt() = '2', 'versão ativa preservada';
  -- skip_invalid: publica só as válidas e mantém o relatório de erros por linha
  r := test.load(ds, null, repeat('e', 64), 'replace', '[["S1","2026-05-01","10","Sul"],["S2","2026-05-02","20","Sul"]]', cols, 2, 'skip_invalid', true);
  job := (r ->> 'job_id')::uuid;
  assert (r ->> 'row_count')::int = 2 and (select invalid_rows from public.import_jobs where id = job) = 2 and (select total_rows from public.import_jobs where id = job) = 4, 'publicou 2 válidas; o job registra 4 no arquivo e 2 rejeitadas';
  assert (select count(*) from public.import_row_errors where import_job_id = job) = 2, 'os erros por linha foram guardados';
  assert (select error_message from public.import_row_errors where import_job_id = job and row_number = 3) = 'Número inválido.' and (select rejected_value from public.import_row_errors where import_job_id = job and row_number = 3) = 'abc', 'erro com linha, coluna, motivo e valor rejeitado';
  assert test.errmsg(format($q$update public.import_row_errors set error_message = 'x' where import_job_id = %L$q$, job)) like '%permission denied%', 'usuário não altera erros';
  assert (select (stats_json ->> 'rejected')::int from public.dataset_versions where id = (r ->> 'version_id')::uuid) = 2, 'a versão guarda o nº de linhas rejeitadas';
  raise notice 'PASS: importação parcial controlada (linhas inválidas) (8)';
end $$;
reset role;

-- ===================================================================== dataset restrito
:as_oa
do $$
declare org uuid := test.t('org'); rid uuid;
begin
  rid := public.bi_create_dataset(org, 'Folha de pagamento', 'sensível', true);
  perform set_config('t.rds', rid::text, true);
  assert (select restricted from public.datasets where id = rid), 'dataset restrito criado pelo administrador';
  raise notice 'PASS: dataset restrito (9)';
end $$;
reset role;
:as_na
do $$
declare org uuid := test.t('org'); rid uuid := test.t('rds');
begin
  assert (select count(*) from public.datasets where id = rid) = 0, 'analista sem acesso nem enxerga o dataset restrito';
  assert test.errmsg(format($q$select public.bi_begin_import(%L, %L, null, 'f.csv', %L, 'csv', 'replace', 'reject_all', '[{"key":"c1","name":"A","type":"string"}]', '{}', 1)$q$, org, rid, repeat('f', 64))) like '%sem permissão%', 'e não importa nele';
  assert test.errmsg(format($q$select public.bi_create_dataset(%L, 'Outro restrito', null, true)$q$, org)) like '%só o administrador%', 'analista não cria dataset restrito';
  assert test.errmsg(format($q$select public.bi_update_dataset(%L, %L, 'x', null, false)$q$, org, rid)) like '%sem permissão%', 'nem altera';
  raise notice 'PASS: dataset restrito (10)';
end $$;
reset role;
:as_ma
do $$ begin
  assert (select count(*) from public.datasets where id = test.t('rds')) = 0, 'gestor sem acesso também não vê (só o administrador ou quem foi autorizado)';
  assert test.errmsg(format($q$select public.bi_set_dataset_access(%L, %L, 'ffffffff-0000-4000-8000-0000000000a2', true)$q$, test.t('org'), test.t('rds'))) like '%sem permissão%', 'gestor não concede acesso';
  raise notice 'PASS: dataset restrito (11)';
end $$;
reset role;
:as_oa
do $$ begin
  perform public.bi_set_dataset_access(test.t('org'), test.t('rds'), 'ffffffff-0000-4000-8000-0000000000a2', true);
  assert test.errmsg(format($q$select public.bi_set_dataset_access(%L, %L, 'ffffffff-0000-4000-8000-0000000000b0', true)$q$, test.t('org'), test.t('rds'))) like '%não faz parte da empresa%', 'só concede a membros da empresa';
  raise notice 'PASS: dataset restrito (12)';
end $$;
reset role;
:as_na
do $$
declare ds_old uuid := test.t('ds');
begin
  assert (select count(*) from public.datasets where id = test.t('rds')) = 1, 'com autorização explícita o analista passa a ver';
  perform set_config('t.ds', test.t('rds')::text, true);
  perform test.load(test.t('rds'), null, repeat('f', 64), 'replace', '[["F1","2026-01-31","5000","RH"]]');
  assert test.cnt() = '1', 'e consegue importar e consultar';
  perform set_config('t.ds', ds_old::text, true);
  raise notice 'PASS: dataset restrito (13)';
end $$;
reset role;
:as_oa
do $$ begin
  perform public.bi_set_dataset_access(test.t('org'), test.t('rds'), 'ffffffff-0000-4000-8000-0000000000a2', false);
  raise notice 'PASS: dataset restrito (14)';
end $$;
reset role;
:as_na
do $$ begin
  assert (select count(*) from public.datasets where id = test.t('rds')) = 0, 'revogado: o efeito é imediato';
  assert test.errmsg(format($q$select public.bi_run_query(%L, jsonb_build_object('dataset_id', %L, 'measures', '[{"alias":"m0","agg":"count"}]'::jsonb))$q$, test.t('org'), test.t('rds'))) like '%sem permissão%', 'e a consulta passa a ser recusada';
  raise notice 'PASS: dataset restrito (15)';
end $$;
reset role;

-- ===================================================================== importação abandonada é limpa na próxima tentativa
:as_na
do $$
declare org uuid := test.t('org'); ds uuid := test.t('ds'); r jsonb; j uuid; v uuid;
begin
  r := public.bi_begin_import(org, ds, null, 'abandonada.csv', repeat('0', 64), 'csv', 'replace', 'reject_all',
    '[{"key":"c1","name":"Pedido","type":"string","dedupe":true},{"key":"c2","name":"Data","type":"date"},{"key":"c3","name":"Valor","type":"currency"},{"key":"c4","name":"Região","type":"string"}]', '{}', 5);
  j := (r ->> 'job_id')::uuid; v := (r ->> 'version_id')::uuid;
  perform public.bi_stage_rows(org, j, '[{"n":2,"k":"A1","v":{"c1":"A1"}}]');
  perform set_config('t.stale_job', j::text, true); perform set_config('t.stale_ver', v::text, true);
  raise notice 'PASS: importação abandonada é limpa na próxima tentativa (16)';
end $$;
reset role;
select test.sql(format('update public.import_jobs set created_at = now() - interval ''2 hours'' where id = %L', current_setting('t.stale_job')));
:as_na
do $$
declare org uuid := test.t('org'); ds uuid := test.t('ds'); r jsonb;
begin
  r := public.bi_begin_import(org, ds, null, 'nova.csv', repeat('1', 63) || '0', 'csv', 'replace', 'reject_all',
    '[{"key":"c1","name":"Pedido","type":"string","dedupe":true},{"key":"c2","name":"Data","type":"date"},{"key":"c3","name":"Valor","type":"currency"},{"key":"c4","name":"Região","type":"string"}]', '{}', 1);
  assert (select status from public.import_jobs where id = test.t('stale_job')) = 'failed' and (select error_message from public.import_jobs where id = test.t('stale_job')) like '%abandonada%', 'job antigo foi marcado como falho';
  assert test.nrows(test.t('stale_ver')) = 0 and (select status from public.dataset_versions where id = test.t('stale_ver')) = 'failed', 'e as linhas de staging foram removidas';
  perform public.bi_fail_import(org, (r ->> 'job_id')::uuid, 'fim do teste');
  raise notice 'PASS: importação abandonada é limpa na próxima tentativa (17)';
end $$;
reset role;

rollback;
select 'PASS 91_bi_versions_access' as result;
