-- Importação em etapas (begin → stage → finish → publish), versões, retenção, e o motor de consultas declarativas.
-- Fixture de VENDAS (10 linhas), valores conferidos à mão:
--   linha  data        canal  vendedor  valor    qtd  criado_em
--    1   2026-01-05   Loja   Ana       100,00    1
--    2   2026-01-20   Loja   Bia       250,50    2
--    3   2026-01-31   Site   Ana        80,00    1
--    4   2026-02-01   Site   Bia       120,00    3
--    5   2026-02-14   Loja   Ana       300,00    2
--    6   2026-02-28   Loja   Ana        50,25    1
--    7   2026-03-01   Site   Bia       400,00    4   2026-03-01T22:00:00-03:00 (UTC já é 02/03: o dia civil continua 01/03)
--    8   2026-03-15   Loja   Bia        (vazio)  1
--    9   2026-03-31   Site   Ana        99,99    1   2026-03-31T23:30:00-03:00 (UTC é 01/04: o dia civil continua 31/03)
--   10   2026-04-10   Loja   Ana        10,00    1
--  Soma = 1.410,74 (a linha 8 é vazia, não zero) · contagem de linhas = 10, de valores = 9 · média = 1.410,74 / 9 · mín 10,00 · máx 400,00
--  Loja = 710,75 (6 linhas) · Site = 699,99 (4 linhas) · jan = 430,50 · fev = 470,25 · mar = 499,99 · abr = 10,00 · vendedores distintos = 2

\set as_oa 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"oa@t.invalid"}'', true); set local role authenticated;'
\set as_ma 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"ma@t.invalid"}'', true); set local role authenticated;'
\set as_na 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"na@t.invalid"}'', true); set local role authenticated;'
\set as_va 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"va@t.invalid"}'', true); set local role authenticated;'
\set as_ob 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000b0","aal":"aal2","email":"ob@t.invalid"}'', true); set local role authenticated;'
\set as_anon 'select set_config(''request.jwt.claims'', ''{}'', true); set local role anon;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
-- consulta como o chamador corrente, devolvendo o primeiro valor de uma medida/dimensão (texto)
create function test.q(p_spec jsonb) returns jsonb language sql as $$ select public.bi_run_query(test.t('org'), p_spec || jsonb_build_object('dataset_id', test.t('ds'))) $$;
create function test.cell(p_spec jsonb, p_row int, p_col text) returns text language sql as $$ select (test.q(p_spec) -> 'rows' -> p_row) ->> p_col $$;
create function test.nrows(v uuid) returns bigint language sql security definer set search_path = '' as $$ select count(*) from public.dataset_rows where dataset_version_id = v $$;
create function test.audit_n(p_action text, p_entity text) returns bigint language sql security definer set search_path = '' as $$ select count(*) from public.audit_log where action = p_action and entity_id = p_entity $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'oa@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'ma@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 'na@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a3', 'va@t.invalid'), ('ffffffff-0000-4000-8000-0000000000b0', 'ob@t.invalid');

:as_oa
do $$
declare org uuid;
begin
  org := public.create_organization('BI A', 'bi-a');
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'viewer');
  perform set_config('t.org', org::text, true);
  assert exists (select 1 from public.bi_settings where organization_id = org), 'a empresa nasce com configurações de BI';
  assert (select max_rows from public.bi_settings where organization_id = org) = 50000 and (select timezone from public.bi_settings where organization_id = org) = 'America/Sao_Paulo', 'padrões: 50 mil linhas, fuso de São Paulo';
  raise notice 'PASS: bloco (1)';
end $$;
reset role;
:as_ob
do $$ begin perform set_config('t.orgb', public.create_organization('BI B', 'bi-b')::text, true); end $$;
reset role;

-- ===================================================================== permissões básicas e limites da importação
:as_va
do $$
declare org uuid := test.t('org');
begin
  assert test.errmsg(format($q$select public.bi_create_dataset(%L, 'Vendas')$q$, org)) like '%sem permissão%', 'visualizador não cria dataset';
  assert test.errmsg(format($q$select public.bi_begin_import(%L, null, 'Vendas', 'v.csv', %L, 'csv', 'replace', 'reject_all', '[]', '{}', 3)$q$, org, repeat('a', 64))) like '%sem permissão%', 'visualizador não importa';
  assert test.errmsg(format($q$select count(*) from public.dataset_rows$q$)) like '%permission denied%', 'dataset_rows não tem SELECT para ninguém';
  assert (select count(*) from public.datasets) = 0, 'visualizador não lê datasets';
  raise notice 'PASS: permissões básicas e limites da importação (2)';
end $$;
reset role;
:as_ob
do $$
declare org uuid := test.t('org');
begin
  assert test.errmsg(format($q$select public.bi_create_dataset(%L, 'Invasor')$q$, org)) like '%sem permissão%', 'outra empresa não cria dataset na empresa A';
  raise notice 'PASS: permissões básicas e limites da importação (3)';
end $$;
reset role;

:as_na
do $$
declare org uuid := test.t('org'); cols jsonb; r jsonb; ds uuid; job uuid; ver uuid;
begin
  cols := '[{"key":"c1","name":"Data","type":"date","semantic":"time","required":true,"dedupe":true,"position":0},
            {"key":"c2","name":"Canal","type":"string","semantic":"dimension","required":true,"dedupe":true,"position":1},
            {"key":"c3","name":"Valor","type":"currency","semantic":"measure","position":2},
            {"key":"c4","name":"Qtd","type":"integer","semantic":"measure","position":3},
            {"key":"c5","name":"Vendedor","type":"string","semantic":"dimension","required":true,"dedupe":true,"position":4},
            {"key":"c6","name":"Criado em","type":"timestamp","semantic":"time","position":5}]';
  perform set_config('t.cols', cols::text, true);
  -- limites e entradas inválidas
  assert test.errmsg(format($q$select public.bi_begin_import(%L, null, 'Vendas', 'v.csv', 'zz', 'csv', 'replace', 'reject_all', %L, '{}', 3)$q$, org, cols::text)) like '%identificação do arquivo%', 'hash inválido';
  assert test.errmsg(format($q$select public.bi_begin_import(%L, null, 'Vendas', 'v.csv', %L, 'csv', 'replace', 'reject_all', %L, '{}', 50001)$q$, org, repeat('a', 64), cols::text)) like '%de 1 a 50000 linhas%', 'mais linhas que o limite';
  assert test.errmsg(format($q$select public.bi_begin_import(%L, null, '', 'v.csv', %L, 'csv', 'replace', 'reject_all', %L, '{}', 3)$q$, org, repeat('a', 64), cols::text)) like '%nome do dataset%', 'nome vazio';
  assert test.errmsg(format($q$select public.bi_begin_import(%L, null, 'Vendas', 'v.csv', %L, 'csv', 'append', 'reject_all', %L, '{}', 3)$q$, org, repeat('a', 64), cols::text)) like '%carga inicial%', 'dataset novo não aceita acréscimo';
  assert test.errmsg(format($q$select public.bi_begin_import(%L, null, 'Vendas', 'v.csv', %L, 'csv', 'replace', 'reject_all', '[{"key":"c1; drop table x","name":"A","type":"string"}]', '{}', 3)$q$, org, repeat('a', 64))) like '%chave de coluna inválida%', 'chave de coluna maliciosa recusada';
  assert test.errmsg(format($q$select public.bi_begin_import(%L, null, 'Vendas', 'v.csv', %L, 'csv', 'replace', 'reject_all', '[{"key":"c1","name":"A","type":"text"}]', '{}', 3)$q$, org, repeat('a', 64))) like '%tipo de coluna inválido%', 'tipo inexistente recusado';
  assert test.errmsg(format($q$select public.bi_begin_import(%L, null, 'Vendas', 'v.csv', %L, 'csv', 'replace', 'reject_all', '[{"key":"c1","name":"A","type":"string"},{"key":"c2","name":"a","type":"string"}]', '{}', 3)$q$, org, repeat('a', 64))) like '%nome de coluna repetido%', 'nomes repetidos recusados';

  r := public.bi_begin_import(org, null, 'Vendas', 'vendas.csv', repeat('a', 64), 'csv', 'replace', 'reject_all', cols, '{"c1":"Data"}', 10);
  ds := (r ->> 'dataset_id')::uuid; job := (r ->> 'job_id')::uuid; ver := (r ->> 'version_id')::uuid;
  perform set_config('t.ds', ds::text, true); perform set_config('t.job', job::text, true); perform set_config('t.ver', ver::text, true);
  assert (r ->> 'version_number')::int = 1 and (r ->> 'created_dataset')::boolean, 'dataset novo, versão 1';
  assert (select status from public.dataset_versions where id = ver) = 'staging' and (select current_version_id from public.datasets where id = ds) is null, 'a versão nasce em staging e o dataset ainda não tem versão ativa';
  assert test.errmsg(format($q$select public.bi_begin_import(%L, %L, null, 'outro.csv', %L, 'csv', 'replace', 'reject_all', %L, '{}', 3)$q$, org, ds, repeat('b', 64), cols::text)) like '%importação em andamento%', 'só uma importação por vez no mesmo dataset';
  assert test.errmsg(format($q$select public.bi_create_dataset(%L, ' vendas ')$q$, org)) like '%já existe um dataset%', 'nome de dataset único (ignora caixa e espaços)';
  raise notice 'PASS: permissões básicas e limites da importação (4)';
end $$;
reset role;

-- ===================================================================== lotes: tipos, chaves, dono do job
:as_na
do $$
declare org uuid := test.t('org'); job uuid := test.t('job');
begin
  assert test.errmsg(format($q$select public.bi_stage_rows(%L, %L, '[{"n":2,"k":"a","v":{"c3":"abc"}}]')$q$, org, job)) like '%fora do tipo%', 'moeda inválida recusada pelo banco';
  assert test.errmsg(format($q$select public.bi_stage_rows(%L, %L, '[{"n":2,"k":"a","v":{"c1":"2026-02-30"}}]')$q$, org, job)) like '%fora do tipo%', 'data inexistente recusada';
  assert test.errmsg(format($q$select public.bi_stage_rows(%L, %L, '[{"n":2,"k":"a","v":{"c9":"x"}}]')$q$, org, job)) like '%fora do tipo%', 'coluna inexistente recusada';
  assert test.errmsg(format($q$select public.bi_stage_rows(%L, %L, '[{"n":2,"k":"a","v":{"c4":"1.5","c1":"2026-01-01","c2":"x","c5":"y"}}]')$q$, org, job)) like '%fora do tipo%', 'inteiro com casas recusado';
  assert test.errmsg(format($q$select public.bi_stage_rows(%L, %L, '[{"n":2,"k":"a","v":{"c1":"2026-01-01","c2":null,"c5":"y"}}]')$q$, org, job)) like '%campo obrigatório vazio%', 'campo obrigatório vazio recusado';
  assert test.errmsg(format($q$select public.bi_stage_rows(%L, %L, '[{"n":2,"k":"a","v":{"c1":"2026-01-01","c2":"x","c5":"y","c6":"01/01/2026 10:00"}}]')$q$, org, job)) like '%fora do tipo%', 'timestamp fora do formato canônico recusado';
  assert test.errmsg(format($q$select public.bi_stage_rows(%L, %L, '[{"n":2,"k":"a","v":{"c1":"2026-01-01","c2":"x","c5":"y","c2":"z"}}]')$q$, org, job)) is null, 'chave repetida no JSON vira a última (jsonb), sem erro';
  assert (select count(*) from public.import_jobs where id = job and processed_rows = 1) = 1, 'a linha válida foi para staging';
  raise notice 'PASS: lotes: tipos, chaves, dono do job (5)';
end $$;
reset role;
-- outra pessoa (mesmo papel) não alimenta o job alheio
:as_ma
do $$ begin
  assert test.errmsg(format($q$select public.bi_stage_rows(%L, %L, '[{"n":3,"k":"b","v":{"c1":"2026-01-01","c2":"x","c5":"y"}}]')$q$, test.t('org'), test.t('job'))) like '%sem permissão%', 'quem não abriu a importação não envia linhas';
  raise notice 'PASS: lotes: tipos, chaves, dono do job (6)';
end $$;
reset role;
:as_ob
do $$ begin
  assert test.errmsg(format($q$select public.bi_stage_rows(%L, %L, '[{"n":3,"k":"b","v":{"c1":"2026-01-01","c2":"x","c5":"y"}}]')$q$, test.t('orgb'), test.t('job'))) like '%sem permissão%', 'outra empresa não alcança o job (id manipulado)';
  assert test.errmsg(format($q$select public.bi_publish_import(%L, %L)$q$, test.t('org'), test.t('job'))) like '%sem permissão%', 'outra empresa não publica';
  raise notice 'PASS: lotes: tipos, chaves, dono do job (7)';
end $$;
reset role;

-- recomeça limpo: cancela (remove staging) e abre de novo
:as_na
do $$
declare org uuid := test.t('org'); ds uuid := test.t('ds'); job uuid := test.t('job'); r jsonb; rows_ jsonb;
begin
  perform public.bi_fail_import(org, job, 'teste de cancelamento');
  assert test.nrows(test.t('ver')) = 0, 'cancelar remove as linhas de staging';
  assert (select status from public.dataset_versions where id = test.t('ver')) = 'failed' and (select current_version_id from public.datasets where id = ds) is null, 'versão falha; nada publicado';
  assert test.errmsg(format($q$select public.bi_fail_import(%L, %L)$q$, org, job)) like '%já foi encerrada%', 'não cancela duas vezes';
  assert test.errmsg(format($q$select public.bi_stage_rows(%L, %L, '[]')$q$, org, job)) like '%não está em andamento%', 'job encerrado não recebe linhas';

  r := public.bi_begin_import(org, ds, null, 'vendas.csv', repeat('a', 64), 'csv', 'replace', 'reject_all', current_setting('t.cols')::jsonb, '{}', 10);
  perform set_config('t.job', r ->> 'job_id', true); perform set_config('t.ver', r ->> 'version_id', true);
  rows_ := '[
   {"n":2,"k":"2026-01-05|Loja|Ana","v":{"c1":"2026-01-05","c2":"Loja","c3":"100","c4":"1","c5":"Ana"}},
   {"n":3,"k":"2026-01-20|Loja|Bia","v":{"c1":"2026-01-20","c2":"Loja","c3":"250.5","c4":"2","c5":"Bia"}},
   {"n":4,"k":"2026-01-31|Site|Ana","v":{"c1":"2026-01-31","c2":"Site","c3":"80","c4":"1","c5":"Ana"}},
   {"n":5,"k":"2026-02-01|Site|Bia","v":{"c1":"2026-02-01","c2":"Site","c3":"120","c4":"3","c5":"Bia"}},
   {"n":6,"k":"2026-02-14|Loja|Ana","v":{"c1":"2026-02-14","c2":"Loja","c3":"300","c4":"2","c5":"Ana"}}]';
  assert public.bi_stage_rows(org, test.t('job'), rows_) = 5, 'primeiro lote: 5 linhas';
  assert test.errmsg(format($q$select public.bi_stage_rows(%L, %L, %L)$q$, org, test.t('job'), rows_::text)) like '%chave de deduplicação repetida%', 'linha repetida pela chave é barrada (reenvio do mesmo lote)';
  rows_ := '[
   {"n":7,"k":"2026-02-28|Loja|Ana","v":{"c1":"2026-02-28","c2":"Loja","c3":"50.25","c4":"1","c5":"Ana"}},
   {"n":8,"k":"2026-03-01|Site|Bia","v":{"c1":"2026-03-01","c2":"Site","c3":"400","c4":"4","c5":"Bia","c6":"2026-03-01T22:00:00-03:00"}},
   {"n":9,"k":"2026-03-15|Loja|Bia","v":{"c1":"2026-03-15","c2":"Loja","c3":null,"c4":"1","c5":"Bia"}},
   {"n":10,"k":"2026-03-31|Site|Ana","v":{"c1":"2026-03-31","c2":"Site","c3":"99.99","c4":"1","c5":"Ana","c6":"2026-03-31T23:30:00-03:00"}}]';
  assert public.bi_stage_rows(org, test.t('job'), rows_) = 9, 'segundo lote: 9 linhas';
  -- ainda falta uma linha: fechar com contagens que não batem com o que chegou é recusado (atualização parcial não publica)
  assert test.errmsg(format($q$select public.bi_finish_import(%L, %L, 10, 0)$q$, org, test.t('job'))) like '%envio incompleto%', 'envio incompleto não fecha';
  assert test.errmsg(format($q$select public.bi_finish_import(%L, %L, 9, 0)$q$, org, test.t('job'))) like '%contagens inconsistentes%', 'contagens que não somam o total do arquivo são recusadas';
  assert test.errmsg(format($q$select public.bi_publish_import(%L, %L)$q$, org, test.t('job'))) like '%não está pronta%', 'job não fechado não publica';
  assert test.errmsg(format($q$select public.bi_stage_rows(%L, %L, %L)$q$, org, test.t('job'),
    '[{"n":11,"k":"x1","v":{"c1":"2026-04-10","c2":"Loja","c5":"Ana"}},{"n":12,"k":"x2","v":{"c1":"2026-04-11","c2":"Loja","c5":"Ana"}}]')) like '%mais linhas do que o declarado%', 'não aceita mais linhas do que o declarado';
  rows_ := '[{"n":11,"k":"2026-04-10|Loja|Ana","v":{"c1":"2026-04-10","c2":"Loja","c3":"10","c4":"1","c5":"Ana"}}]';
  assert public.bi_stage_rows(org, test.t('job'), rows_) = 10, 'último lote: 10 linhas';
  r := public.bi_finish_import(org, test.t('job'), 10, 0);
  assert (r ->> 'valid_rows')::int = 10, 'fechamento confere 10 linhas válidas';
  raise notice 'PASS: lotes: tipos, chaves, dono do job (8)';
end $$;
reset role;

-- ===================================================================== publicação atômica
:as_na
do $$
declare org uuid := test.t('org'); ds uuid := test.t('ds'); r jsonb;
begin
  assert (select current_version_id from public.datasets where id = ds) is null, 'antes de publicar, nada ativo';
  assert test.errmsg(format($q$select public.bi_run_query(%L, jsonb_build_object('dataset_id', %L, 'measures', '[{"alias":"m0","agg":"count"}]'::jsonb))$q$, org, ds)) like '%ainda não tem dados publicados%', 'consulta antes da publicação é recusada com mensagem clara';
  r := public.bi_publish_import(org, test.t('job'));
  assert (r ->> 'row_count')::int = 10 and (r ->> 'skipped_existing')::int = 0, 'publicou 10 linhas';
  assert (select current_version_id from public.datasets where id = ds) = test.t('ver') and (select status from public.dataset_versions where id = test.t('ver')) = 'published', 'versão ativa';
  assert (select (stats_json -> 'nulls' ->> 'c3')::int from public.dataset_versions where id = test.t('ver')) = 1 and (select (stats_json -> 'nulls' ->> 'c1')::int from public.dataset_versions where id = test.t('ver')) = 0, 'estatística de vazios por coluna (c3 tem 1)';
  assert test.errmsg(format($q$select public.bi_publish_import(%L, %L)$q$, org, test.t('job'))) like '%já publicada%', 'não publica duas vezes';
  assert test.errmsg(format($q$select public.bi_begin_import(%L, %L, null, 'outro-nome.csv', %L, 'csv', 'replace', 'reject_all', %L, '{}', 3)$q$, org, ds, repeat('a', 64), current_setting('t.cols'))) like '%mesmo conteúdo%já foi importado%', 'o mesmo arquivo não é importado de novo';
  assert exists (select 1 from public.data_refresh_events where dataset_id = ds and status = 'completed' and refresh_type = 'initial'), 'evento de atualização registrado';
  assert test.audit_n('import_published', ds::text) > 0, 'publicação auditada';
  assert (select count(*) from public.bi_notifications where type = 'import_done' and user_id = 'ffffffff-0000-4000-8000-0000000000a2') = 1, 'quem importou foi avisado';
  assert test.errmsg(format($q$update public.dataset_versions set schema_json = '[]' where id = %L$q$, test.t('ver'))) like '%permission denied%', 'usuário não altera versão';
  raise notice 'PASS: publicação atômica (9)';
end $$;
reset role;
-- nem o dono do schema altera linhas publicadas ou apaga sem a rotina de retenção
do $$ begin
  assert test.errmsg(format($q$update public.dataset_rows set values_json = '{}' where dataset_version_id = %L$q$, test.t('ver'))) like '%não podem ser alteradas%', 'linhas importadas são imutáveis';
  assert test.errmsg(format($q$delete from public.dataset_rows where dataset_version_id = %L$q$, test.t('ver'))) like '%política de retenção%', 'linhas só saem pela retenção';
  assert test.errmsg(format($q$delete from public.dataset_versions where id = %L$q$, test.t('ver'))) like '%não pode ser apagado%', 'versões não são apagadas';
  assert test.errmsg(format($q$delete from public.datasets where id = %L$q$, test.t('ds'))) like '%não pode ser apagado%', 'datasets não são apagados (só arquivados)';
end $$;

-- ===================================================================== consultas declarativas (valores conferidos à mão)
:as_na
do $$
declare s jsonb; r jsonb;
begin
  s := '{"measures":[{"alias":"m0","agg":"sum","field":"c3"},{"alias":"m1","agg":"count"},{"alias":"m2","agg":"count","field":"c3"},{"alias":"m3","agg":"avg","field":"c3"},{"alias":"m4","agg":"min","field":"c3"},{"alias":"m5","agg":"max","field":"c3"},{"alias":"m6","agg":"count_distinct","field":"c5"}]}';
  r := test.q(s);
  assert (r -> 'rows' -> 0 ->> 'm0')::numeric = 1410.74, 'soma = 1.410,74 (a linha vazia não conta como zero)';
  assert (r -> 'rows' -> 0 ->> 'm1')::int = 10 and (r -> 'rows' -> 0 ->> 'm2')::int = 9, 'contagem de linhas = 10; de valores = 9';
  assert round((r -> 'rows' -> 0 ->> 'm3')::numeric, 6) = round(1410.74 / 9, 6), 'média = 1.410,74 ÷ 9 (a linha vazia fica fora do denominador)';
  assert (r -> 'rows' -> 0 ->> 'm4')::numeric = 10 and (r -> 'rows' -> 0 ->> 'm5')::numeric = 400 and (r -> 'rows' -> 0 ->> 'm6')::int = 2, 'mín 10, máx 400, 2 vendedores distintos';
  assert (r ->> 'truncated')::boolean = false and (r -> 'rows' -> 0 ->> 'm0') = '1410.74', 'valores voltam como TEXTO exato (sem float)';
  -- por canal
  r := test.q('{"measures":[{"alias":"m0","agg":"sum","field":"c3"}],"dimensions":[{"field":"c2"}],"order":[{"by":"m0","dir":"desc"}]}');
  assert (r -> 'rows' -> 0 ->> 'd0') = 'Loja' and (r -> 'rows' -> 0 ->> 'm0')::numeric = 710.75 and (r -> 'rows' -> 1 ->> 'd0') = 'Site' and (r -> 'rows' -> 1 ->> 'm0')::numeric = 699.99, 'Loja 710,75 · Site 699,99, ordenado por valor';
  -- por mês
  r := test.q('{"measures":[{"alias":"m0","agg":"sum","field":"c3"}],"dimensions":[{"field":"c1","grain":"month"}]}');
  assert jsonb_array_length(r -> 'rows') = 4 and (r -> 'rows' -> 0 ->> 'd0') = '2026-01-01' and (r -> 'rows' -> 0 ->> 'm0')::numeric = 430.5 and (r -> 'rows' -> 1 ->> 'm0')::numeric = 470.25
    and (r -> 'rows' -> 2 ->> 'm0')::numeric = 499.99 and (r -> 'rows' -> 3 ->> 'm0')::numeric = 10, 'jan 430,50 · fev 470,25 · mar 499,99 · abr 10,00';
  assert test.cell('{"measures":[{"alias":"m0","agg":"count"}],"dimensions":[{"field":"c1","grain":"year"}]}', 0, 'd0') = '2026-01-01', 'grão ano';
  assert test.cell('{"measures":[{"alias":"m0","agg":"count"}],"dimensions":[{"field":"c1","grain":"quarter"}],"order":[{"by":"d0","dir":"desc"}]}', 0, 'd0') = '2026-04-01', 'grão trimestre (abril abre o 2º trimestre)';
  -- período inclusivo nas duas pontas
  assert test.cell('{"measures":[{"alias":"m0","agg":"sum","field":"c3"}],"period":{"field":"c1","from":"2026-02-01","to":"2026-02-28"}}', 0, 'm0') = '470.25', 'fevereiro inteiro (01 e 28 inclusos) = 470,25';
  assert test.cell('{"measures":[{"alias":"m0","agg":"count"}],"period":{"field":"c1","from":"2026-01-31","to":"2026-01-31"}}', 0, 'm0') = '1', 'um único dia (31/01) tem 1 linha';
  assert test.cell('{"measures":[{"alias":"m0","agg":"count"}],"period":{"field":"c1","from":"2026-02-02","to":"2026-02-13"}}', 0, 'm0') = '0', 'período sem linhas conta 0';
  assert test.cell('{"measures":[{"alias":"m0","agg":"sum","field":"c3"}],"period":{"field":"c1","from":"2026-02-02","to":"2026-02-13"}}', 0, 'm0') is null, 'soma de nenhum registro é NULO (sem dados), não zero';
  -- timestamp: o período usa o dia civil no fuso da empresa
  assert test.cell('{"measures":[{"alias":"m0","agg":"count"}],"period":{"field":"c6","from":"2026-03-01","to":"2026-03-01"}}', 0, 'm0') = '1', 'timestamp 01/03 22:00 (-03) cai em 01/03 (em UTC já seria 02/03)';
  assert test.cell('{"measures":[{"alias":"m0","agg":"count"}],"period":{"field":"c6","from":"2026-04-01","to":"2026-04-30"}}', 0, 'm0') = '0', 'timestamp 31/03 23:30 (-03) NÃO cai em abril (em UTC seria 01/04)';
  assert test.cell('{"measures":[{"alias":"m0","agg":"count"}],"period":{"field":"c6","from":"2026-03-31","to":"2026-03-31"}}', 0, 'm0') = '1', 'timestamp 31/03 23:30 (-03) cai em 31/03';
  -- filtros
  assert test.cell('{"measures":[{"alias":"m0","agg":"count"}],"filters":[{"field":"c2","op":"eq","value":"Loja"}]}', 0, 'm0') = '6', 'canal = Loja: 6 linhas';
  assert test.cell('{"measures":[{"alias":"m0","agg":"count"}],"filters":[{"field":"c2","op":"neq","value":"Loja"}]}', 0, 'm0') = '4', 'canal ≠ Loja: 4 linhas';
  assert test.cell('{"measures":[{"alias":"m0","agg":"count"}],"filters":[{"field":"c2","op":"contains","value":"OJ"}]}', 0, 'm0') = '6', '«contém» ignora caixa';
  assert test.cell('{"measures":[{"alias":"m0","agg":"count"}],"filters":[{"field":"c2","op":"contains","value":"%"}]}', 0, 'm0') = '0', '«contém» trata % como caractere comum (sem curinga)';
  assert test.cell('{"measures":[{"alias":"m0","agg":"count"}],"filters":[{"field":"c2","op":"contains","value":"_"}]}', 0, 'm0') = '0', '«contém» trata _ como caractere comum';
  assert test.cell('{"measures":[{"alias":"m0","agg":"count"}],"filters":[{"field":"c5","op":"in","values":["Ana","Zé"]}]}', 0, 'm0') = '6', 'em lista (Ana, Zé): 6';
  assert test.cell('{"measures":[{"alias":"m0","agg":"count"}],"filters":[{"field":"c3","op":"gt","value":"100"}]}', 0, 'm0') = '4', 'valor > 100: 250,50 · 120 · 300 · 400 (o 100 exato fica de fora)';
  assert test.cell('{"measures":[{"alias":"m0","agg":"count"}],"filters":[{"field":"c3","op":"gte","value":"100"}]}', 0, 'm0') = '5', 'valor ≥ 100 inclui o 100 exato';
  assert test.cell('{"measures":[{"alias":"m0","agg":"count"}],"filters":[{"field":"c3","op":"between","value":"50.25","to":"100"}]}', 0, 'm0') = '4', 'entre 50,25 e 100 (inclusivo): 50,25 · 80 · 99,99 · 100';
  assert test.cell('{"measures":[{"alias":"m0","agg":"count"}],"filters":[{"field":"c3","op":"empty"}]}', 0, 'm0') = '1' and test.cell('{"measures":[{"alias":"m0","agg":"count"}],"filters":[{"field":"c3","op":"not_empty"}]}', 0, 'm0') = '9', 'vazio: 1 · preenchido: 9';
  assert test.cell('{"measures":[{"alias":"m0","agg":"sum","field":"c3"}],"filters":[{"field":"c3","op":"lt","value":"100"},{"field":"c2","op":"eq","value":"Site"}]}', 0, 'm0') = '179.99', 'filtros somam com E: Site com valor < 100 = 80 + 99,99';
  -- filtro dentro da medida (FILTER): participação de Loja no total na mesma consulta
  r := test.q('{"measures":[{"alias":"m0","agg":"sum","field":"c3","filters":[{"field":"c2","op":"eq","value":"Loja"}]},{"alias":"m1","agg":"sum","field":"c3"}]}');
  assert (r -> 'rows' -> 0 ->> 'm0')::numeric = 710.75 and (r -> 'rows' -> 0 ->> 'm1')::numeric = 1410.74, 'medida com filtro próprio (Loja) ao lado do total';
  -- limite e truncamento
  r := test.q('{"measures":[{"alias":"m0","agg":"count"}],"dimensions":[{"field":"c1"}],"limit":3}');
  assert jsonb_array_length(r -> 'rows') = 3 and (r ->> 'truncated')::boolean, 'limite 3 de 10 datas distintas: trunca e avisa';
  r := test.q('{"measures":[{"alias":"m0","agg":"count"}],"dimensions":[{"field":"c1"}],"limit":999999}');
  assert jsonb_array_length(r -> 'rows') = 10 and not (r ->> 'truncated')::boolean, 'limite exagerado é cortado no máximo permitido (1000)';
  -- filtros de valores (dropdown)
  assert public.bi_filter_values(test.t('org'), test.t('ds'), 'c2') = '["Loja", "Site"]'::jsonb, 'valores distintos do canal';
  assert test.errmsg(format($q$select public.bi_filter_values(%L, %L, 'c3')$q$, test.t('org'), test.t('ds'))) like '%só para texto%', 'lista de valores não vale para moeda';
  raise notice 'PASS: consultas declarativas (valores conferidos à mão) (10)';
end $$;
reset role;

-- ===================================================================== tentativas de injeção e consultas inválidas
:as_na
do $$
declare org uuid := test.t('org'); ds uuid := test.t('ds'); n int;
begin
  -- valor com aspas e SQL é só um literal: não casa com nada e nada acontece
  assert test.cell('{"measures":[{"alias":"m0","agg":"count"}],"filters":[{"field":"c2","op":"eq","value":"x'' or ''1''=''1"}]}', 0, 'm0') = '0', 'aspa no valor é literal (0 linhas), não SQL';
  assert test.cell('{"measures":[{"alias":"m0","agg":"count"}],"filters":[{"field":"c2","op":"eq","value":"Loja''; drop table public.datasets; --"}]}', 0, 'm0') = '0', 'tentativa de DROP vira texto';
  assert exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'datasets'), 'a tabela continua existindo';
  assert test.errmsg(format($q$select test.q('{"measures":[{"alias":"m0","agg":"sum","field":"c3; drop table x"}]}')$q$)) like '%coluna inválida%', 'identificador malicioso recusado';
  assert test.errmsg(format($q$select test.q('{"measures":[{"alias":"m0","agg":"sum","field":"Valor"}]}')$q$)) like '%coluna inválida%', 'nome de exibição não é identificador';
  assert test.errmsg(format($q$select test.q('{"measures":[{"alias":"m0","agg":"sum","field":"c99"}]}')$q$)) like '%coluna inválida%', 'coluna fora do catálogo recusada';
  assert test.errmsg(format($q$select test.q('{"measures":[{"alias":"m0) from x; --","agg":"count"}]}')$q$)) like '%apelido%', 'apelido malicioso recusado';
  assert test.errmsg(format($q$select test.q('{"measures":[{"alias":"m0","agg":"sum); drop","field":"c3"}]}')$q$)) like '%agregação inválida%', 'agregação fora da lista recusada';
  assert test.errmsg(format($q$select test.q('{"measures":[{"alias":"m0","agg":"sum","field":"c2"}]}')$q$)) like '%coluna numérica%', 'soma de texto recusada';
  assert test.errmsg(format($q$select test.q('{"measures":[{"alias":"m0","agg":"avg","field":"c1"}]}')$q$)) like '%coluna numérica%', 'média de data recusada';
  assert test.errmsg(format($q$select test.q('{"measures":[{"alias":"m0","agg":"sum"}]}')$q$)) like '%precisa de uma coluna%', 'soma sem coluna recusada';
  assert test.errmsg(format($q$select test.q('{"measures":[{"alias":"m0","agg":"count"}],"filters":[{"field":"c3","op":"contains","value":"1"}]}')$q$)) like '%só vale para texto%', '«contém» em número recusado';
  assert test.errmsg(format($q$select test.q('{"measures":[{"alias":"m0","agg":"count"}],"filters":[{"field":"c3","op":"gt","value":"1; select 1"}]}')$q$)) like '%valor numérico de filtro inválido%', 'número com SQL recusado';
  assert test.errmsg(format($q$select test.q('{"measures":[{"alias":"m0","agg":"count"}],"filters":[{"field":"c1","op":"eq","value":"2026-13-45"}]}')$q$)) like '%data de filtro inválida%', 'data inválida recusada';
  assert test.errmsg(format($q$select test.q('{"measures":[{"alias":"m0","agg":"count"}],"filters":[{"field":"c2","op":"drop","value":"x"}]}')$q$)) like '%operador de filtro inválido%', 'operador fora da lista recusado';
  assert test.errmsg(format($q$select test.q('{"measures":[{"alias":"m0","agg":"count"}],"filters":[{"field":"c2","op":"in","values":[]}]}')$q$)) like '%lista de valores inválida%', 'lista vazia recusada';
  assert test.errmsg(format($q$select test.q('{"measures":[{"alias":"m0","agg":"count"}],"period":{"field":"c2","from":"2026-01-01","to":"2026-01-31"}}')$q$)) like '%período precisa de uma coluna de data%', 'período em coluna de texto recusado';
  assert test.errmsg(format($q$select test.q('{"measures":[{"alias":"m0","agg":"count"}],"period":{"field":"c1","from":"2026-02-01","to":"2026-01-01"}}')$q$)) like '%período inválido%', 'período invertido recusado';
  assert test.errmsg(format($q$select test.q('{"measures":[{"alias":"m0","agg":"count"}],"dimensions":[{"field":"c2","grain":"month"}]}')$q$)) like '%granularidade inválida%', 'grão em coluna de texto recusado';
  assert test.errmsg(format($q$select test.q('{"measures":[{"alias":"m0","agg":"count"}],"dimensions":[{"field":"c1"},{"field":"c2"},{"field":"c5"}]}')$q$)) like '%no máximo 2 dimensões%', 'mais de 2 dimensões recusado';
  assert test.errmsg(format($q$select test.q('{"measures":[],"dimensions":[]}')$q$)) like '%1 a 12 medidas%', 'consulta sem medidas recusada';
  assert test.errmsg(format($q$select test.q('{"measures":[{"alias":"m0","agg":"count"}],"order":[{"by":"1; drop","dir":"asc"}]}')$q$)) like '%ordenação inválida%', 'ordenação maliciosa recusada';
  assert test.errmsg(format($q$select test.q('{"measures":[{"alias":"m0","agg":"count"}],"order":[{"by":"d0","dir":"asc"}]}')$q$)) like '%ordenação inválida%', 'ordenar por dimensão inexistente recusado';
  assert test.errmsg(format($q$select test.q('{"measures":[{"alias":"m0","agg":"count"},{"alias":"m0","agg":"count"}]}')$q$)) like '%apelido%', 'apelidos repetidos recusados';
  assert test.errmsg(format($q$select public.bi_run_query(%L, '{"dataset_id":"not-a-uuid","measures":[{"alias":"m0","agg":"count"}]}')$q$, org)) like '%consulta inválida%', 'dataset_id que não é uuid recusado';
  assert test.errmsg(format($q$select public.bi_run_query(%L, '[]')$q$, org)) like '%consulta inválida%', 'especificação que não é objeto recusada';
  raise notice 'PASS: tentativas de injeção e consultas inválidas (11)';
end $$;
reset role;

-- ===================================================================== isolamento e perfis nas consultas
:as_va
do $$ begin
  assert test.errmsg(format($q$select test.q('{"measures":[{"alias":"m0","agg":"count"}]}')$q$)) like '%sem permissão%', 'visualizador não faz consulta livre';
  assert test.errmsg(format($q$select public.bi_dataset_rows(%L, %L)$q$, test.t('org'), test.t('ds'))) like '%sem permissão%', 'visualizador não lê linhas';
  raise notice 'PASS: isolamento e perfis nas consultas (12)';
end $$;
reset role;
:as_ob
do $$ begin
  assert test.errmsg(format($q$select test.q('{"measures":[{"alias":"m0","agg":"count"}]}')$q$)) like '%sem permissão%', 'empresa B não consulta o dataset da empresa A (org correta, dataset alheio)';
  assert test.errmsg(format($q$select public.bi_run_query(%L, jsonb_build_object('dataset_id', %L, 'measures', '[{"alias":"m0","agg":"count"}]'::jsonb))$q$, test.t('orgb'), test.t('ds'))) like '%sem permissão%', 'empresa B não consulta com o id do dataset de A na própria org';
  assert (select count(*) from public.datasets) = 0 and (select count(*) from public.dataset_versions) = 0 and (select count(*) from public.import_jobs) = 0, 'empresa B não enxerga nada da empresa A';
  raise notice 'PASS: isolamento e perfis nas consultas (13)';
end $$;
reset role;
:as_anon
do $$ begin
  assert test.errmsg(format($q$select public.bi_run_query(%L, '{}')$q$, test.t('org'))) like '%permission denied%', 'anon não executa consultas';
  assert test.errmsg(format($q$select count(*) from public.datasets$q$)) like '%permission denied%', 'anon não lê datasets';
  raise notice 'PASS: isolamento e perfis nas consultas (14)';
end $$;
reset role;

-- ===================================================================== linhas paginadas (explorador): analista lê; exportação bruta é do gestor
:as_na
do $$
declare r jsonb;
begin
  r := public.bi_dataset_rows(test.t('org'), test.t('ds'), '[]', null, 'c3', 'desc', 1, 3);
  assert (r ->> 'total')::int = 10 and jsonb_array_length(r -> 'rows') = 3, 'página de 3 em 10';
  assert (r -> 'rows' -> 0 -> 'v' ->> 'c3') = '400', 'ordenado por valor decrescente';
  r := public.bi_dataset_rows(test.t('org'), test.t('ds'), '[{"field":"c2","op":"eq","value":"Site"}]', null, 'c1', 'asc', 2, 3);
  assert (r ->> 'total')::int = 4 and jsonb_array_length(r -> 'rows') = 1, 'página 2 de 3 com 4 linhas filtradas tem 1';
  r := public.bi_dataset_rows(test.t('org'), test.t('ds'), '[]', null, null, 'asc', 1, 100000);
  assert (r ->> 'size')::int = 100, 'tamanho de página limitado a 100';
  assert test.errmsg(format($q$select public.bi_dataset_rows(%L, %L, '[]', null, 'c3; drop', 'asc')$q$, test.t('org'), test.t('ds'))) like '%coluna inválida%', 'ordenação por identificador malicioso recusada';
  assert test.errmsg(format($q$select public.bi_dataset_rows(%L, %L, '[]', null, null, 'asc', 1, 50, true)$q$, test.t('org'), test.t('ds'))) like '%sem permissão%', 'analista não exporta linhas brutas';
  raise notice 'PASS: linhas paginadas (explorador): analista lê; exportação bruta é do gestor (15)';
end $$;
reset role;
:as_ma
do $$
declare r jsonb;
begin
  r := public.bi_dataset_rows(test.t('org'), test.t('ds'), '[]', null, null, 'asc', 1, 5000, true);
  assert jsonb_array_length(r -> 'rows') = 10, 'gestor exporta as 10 linhas';
  assert (select count(*) from public.report_exports where report_type = 'dataset_csv' and row_count = 10) = 1, 'exportação registrada (nº de linhas, sem valores)';
  assert test.audit_n('dataset_export', test.t('ds')::text) = 1, 'exportação auditada';
  raise notice 'PASS: linhas paginadas (explorador): analista lê; exportação bruta é do gestor (16)';
end $$;
reset role;

rollback;
select 'PASS 90_bi_import_query' as result;

