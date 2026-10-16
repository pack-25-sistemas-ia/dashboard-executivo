-- Metas, visões salvas, avisos, configurações, qualidade dos dados e a matriz de segurança (MFA no banco, privilégios, higiene das funções,
-- isolamento entre empresas em todas as funções que recebem ids).

\set as_oa 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"oa@t.invalid"}'', true); set local role authenticated;'
\set as_oa1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal1","email":"oa@t.invalid"}'', true); set local role authenticated;'
\set as_ma 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"ma@t.invalid"}'', true); set local role authenticated;'
\set as_na 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"na@t.invalid"}'', true); set local role authenticated;'
\set as_va 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"va@t.invalid"}'', true); set local role authenticated;'
\set as_ob 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000b0","aal":"aal2","email":"ob@t.invalid"}'', true); set local role authenticated;'
\set as_anon 'select set_config(''request.jwt.claims'', ''{}'', true); set local role anon;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.notif_n(u uuid, t text) returns bigint language sql security definer set search_path = '' as $$ select count(*) from public.bi_notifications where user_id = u and type = t $$;
create function test.cnt(q text) returns bigint language plpgsql security definer set search_path = '' as $$ declare n bigint; begin execute q into n; return n; end $$;
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'oa@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'ma@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 'na@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a3', 'va@t.invalid'), ('ffffffff-0000-4000-8000-0000000000b0', 'ob@t.invalid');

:as_oa
do $$
declare org uuid;
begin
  org := public.create_organization('BI Metas', 'bi-metas');
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'viewer');
  perform set_config('t.org', org::text, true);
  raise notice 'PASS: bloco (1)';
end $$;
reset role;
:as_ob
do $$ begin perform set_config('t.orgb', public.create_organization('BI Outra', 'bi-outra-2')::text, true); end $$;
reset role;

:as_na
do $$
declare org uuid := test.t('org'); r jsonb; cols jsonb; m jsonb;
begin
  cols := '[{"key":"c1","name":"Id","type":"string","required":true,"dedupe":true,"position":0},{"key":"c2","name":"Data","type":"date","position":1},{"key":"c3","name":"Valor","type":"currency","position":2}]';
  r := public.bi_begin_import(org, null, 'Vendas', 'v.csv', repeat('a', 64), 'csv', 'replace', 'reject_all', cols, '{}', 2);
  perform public.bi_stage_rows(org, (r ->> 'job_id')::uuid, '[{"n":2,"k":"1","v":{"c1":"1","c2":"2026-03-02","c3":"100"}},{"n":3,"k":"2","v":{"c1":"2","c2":"2026-03-03","c3":"50"}}]');
  perform public.bi_finish_import(org, (r ->> 'job_id')::uuid, 2, 0);
  perform public.bi_publish_import(org, (r ->> 'job_id')::uuid);
  perform set_config('t.ds', r ->> 'dataset_id', true);
  m := public.bi_save_metric(org, null, (r ->> 'dataset_id')::uuid, 'Faturamento', null, 'aggregation', 'sum', 'c3', null, '[]', 'currency', null);
  perform set_config('t.m', m ->> 'id', true);
  raise notice 'PASS: bloco (2)';
end $$;
reset role;

-- ===================================================================== metas: só gestor+, com validação e direção
:as_na
do $$ begin
  assert test.errmsg(format($q$select public.bi_save_goal(%L, null, %L, 'Meta', 'min', 'month', 100, null, 80, 'previous_period', '[]', null)$q$, test.t('org'), test.t('m'))) like '%sem permissão%', 'analista não cria meta';
  raise notice 'PASS: metas: só gestor+, com validação e direção (3)';
end $$;
reset role;
:as_va
do $$ begin
  assert test.errmsg(format($q$select public.bi_save_goal(%L, null, %L, 'Meta', 'min', 'month', 100, null, 80, 'previous_period', '[]', null)$q$, test.t('org'), test.t('m'))) like '%sem permissão%', 'visualizador não cria meta';
  assert (select count(*) from public.goal_definitions) = 0, 'nem lê metas';
  raise notice 'PASS: metas: só gestor+, com validação e direção (4)';
end $$;
reset role;
:as_ma
do $$
declare org uuid := test.t('org'); m uuid := test.t('m'); g uuid; q text := 'select public.bi_save_goal(%L, %L, %L, %L, %L, %L, %s, %s, %s, %L, %L, %L)';
begin
  g := public.bi_save_goal(org, null, m, 'Receita mensal', 'min', 'month', 100000, null, 80, 'previous_month', '[]', 'ffffffff-0000-4000-8000-0000000000a1');
  perform set_config('t.g', g::text, true);
  assert (select goal_kind from public.goal_definitions where id = g) = 'min' and (select target_value_decimal from public.goal_definitions where id = g) = 100000, 'gestor cria a meta';
  assert test.errmsg(format(q, org, null, m, 'x', 'melhor', 'month', 1, 'null', 80, 'previous_period', '[]', null)) like '%configuração de meta inválida%', 'direção fora da lista recusada';
  assert test.errmsg(format(q, org, null, m, 'x', 'range', 'month', 10, 5, 80, 'previous_period', '[]', null)) like '%limite superior%', 'faixa invertida recusada';
  assert test.errmsg(format(q, org, null, m, 'x', 'range', 'month', 10, 'null', 80, 'previous_period', '[]', null)) like '%limite superior%', 'faixa sem limite superior recusada';
  assert test.errmsg(format(q, org, null, m, 'x', 'growth', 'month', -5, 'null', 80, 'previous_period', '[]', null)) like '%não pode ser negativo%', 'crescimento negativo recusado';
  assert test.errmsg(format(q, org, null, m, 'x', 'min', 'month', 5, 'null', 0, 'previous_period', '[]', null)) like '%limite de atenção%', 'limite de atenção fora de 1 a 100 recusado';
  assert test.errmsg(format(q, org, null, m, '', 'min', 'month', 5, 'null', 80, 'previous_period', '[]', null)) like '%nome inválido%', 'nome vazio recusado';
  assert test.errmsg(format(q, org, null, m, 'x', 'min', 'month', '1e30', 'null', 80, 'previous_period', '[]', null)) like '%valor-alvo inválido%', 'valor-alvo gigante recusado';
  assert test.errmsg(format(q, org, null, m, 'x', 'min', 'month', 5, 'null', 80, 'previous_period', '[]', gen_random_uuid())) like '%responsável não pertence%', 'responsável de fora recusado';
  assert test.errmsg(format(q, org, null, m, 'x', 'min', 'month', 5, 'null', 80, 'previous_period', '[{"field":"c9","op":"eq","value":"x"}]', null)) like '%coluna inválida%', 'escopo com coluna inexistente recusado';
  assert test.errmsg(format(q, org, null, gen_random_uuid(), 'x', 'min', 'month', 5, 'null', 80, 'previous_period', '[]', null)) like '%indicador não encontrado%', 'indicador inexistente recusado';
  perform public.bi_set_goal_period(org, g, date '2026-03-01', date '2026-03-31', 120000);
  perform public.bi_set_goal_period(org, g, date '2026-03-01', date '2026-03-31', 130000);
  assert (select count(*) from public.goal_periods where goal_id = g) = 1 and (select target_value_decimal from public.goal_periods where goal_id = g) = 130000, 'meta do período é atualizada (sem duplicar)';
  assert test.errmsg(format($q$select public.bi_set_goal_period(%L, %L, date '2026-03-31', date '2026-03-01', 1)$q$, org, g)) like '%período da meta inválido%', 'período invertido recusado';
  perform public.bi_goal_notify(org, g, 'missed', '2026-03');
  perform public.bi_goal_notify(org, g, 'missed', '2026-03');
  assert test.notif_n('ffffffff-0000-4000-8000-0000000000a1', 'goal_below') = 1, 'aviso de meta é idempotente (mesma meta, situação e período = 1 aviso)';
  perform public.bi_goal_notify(org, g, 'achieved', '2026-04');
  assert test.notif_n('ffffffff-0000-4000-8000-0000000000a1', 'goal_achieved') = 1, 'outro período/situação gera outro aviso';
  assert test.errmsg(format($q$select public.bi_goal_notify(%L, %L, 'virou', '2026-03')$q$, org, g)) like '%aviso inválido%', 'situação inválida recusada';
  raise notice 'PASS: metas: só gestor+, com validação e direção (5)';
end $$;
reset role;
:as_ma
do $$ begin
  assert test.errmsg(format($q$select public.bi_archive_metric(%L, %L)$q$, test.t('org'), test.t('m'))) like '%metas ativas%', 'indicador com meta ativa não é arquivado';
  perform public.bi_archive_goal(test.t('org'), test.t('g'));
  assert (select status from public.goal_definitions where id = test.t('g')) = 'archived', 'meta arquivada (não apagada)';
  assert test.errmsg(format($q$delete from public.goal_definitions where id = %L$q$, test.t('g'))) like '%permission denied%', 'ninguém apaga meta';
  raise notice 'PASS: metas: só gestor+, com validação e direção (6)';
end $$;
reset role;

-- ===================================================================== visões salvas
:as_na
do $$
declare org uuid := test.t('org'); ds uuid := test.t('ds'); v uuid;
begin
  v := public.bi_save_view(org, null, ds, 'Valores altos', '[{"field":"c3","op":"gt","value":"60"}]', '["c1","c3"]', '[{"field":"c3","dir":"desc"}]');
  perform set_config('t.view', v::text, true);
  assert test.errmsg(format($q$select public.bi_save_view(%L, null, %L, 'Ruim', '[{"field":"c9","op":"eq","value":"x"}]', '[]', '[]')$q$, org, ds)) like '%coluna inválida%', 'filtro com coluna inexistente recusado';
  assert test.errmsg(format($q$select public.bi_save_view(%L, null, %L, 'Ruim', '[]', '["c1; drop"]', '[]')$q$, org, ds)) like '%coluna inválida%', 'coluna maliciosa recusada';
  assert test.errmsg(format($q$select public.bi_save_view(%L, null, %L, 'Ruim', '[]', '[]', '[{"field":"c3","dir":"cima"}]')$q$, org, ds)) like '%ordenação inválida%', 'direção inválida recusada';
  assert (select count(*) from public.saved_views) = 1, 'o analista vê a própria visão';
  raise notice 'PASS: visões salvas (7)';
end $$;
reset role;
:as_ma
do $$ begin
  assert (select count(*) from public.saved_views) = 1, 'gestor vê as visões da equipe';
  perform public.bi_save_view(test.t('org'), test.t('view'), test.t('ds'), 'Valores altos (gestor)', '[]', '[]', '[]');
  assert (select name from public.saved_views where id = test.t('view')) = 'Valores altos (gestor)', 'gestor edita visão de outro';
  raise notice 'PASS: visões salvas (8)';
end $$;
reset role;
:as_va
do $$ begin
  assert (select count(*) from public.saved_views) = 0, 'visualizador não vê visões';
  assert test.errmsg(format($q$select public.bi_save_view(%L, null, %L, 'x', '[]', '[]', '[]')$q$, test.t('org'), test.t('ds'))) like '%sem permissão%', 'nem cria';
  raise notice 'PASS: visões salvas (9)';
end $$;
reset role;

-- ===================================================================== avisos: preferências e leitura
:as_na
do $$
declare org uuid := test.t('org');
begin
  perform public.bi_set_notification_pref(org, 'dashboard_shared', false);
  assert test.errmsg(format($q$select public.bi_set_notification_pref(%L, 'qualquer', true)$q$, org)) like '%tipo de aviso inválido%', 'tipo de aviso fora da lista recusado';
  assert (select count(*) from public.bi_notification_prefs) = 1, 'preferência gravada';
  raise notice 'PASS: avisos: preferências e leitura (10)';
end $$;
reset role;
:as_ma
do $$
declare d uuid;
begin
  d := public.bi_create_dashboard(test.t('org'), 'Painel do gestor');
  perform public.bi_share_dashboard(test.t('org'), d, 'ffffffff-0000-4000-8000-0000000000a2', 'view');
  assert test.errmsg(format($q$select public.bi_share_dashboard(%L, %L, 'ffffffff-0000-4000-8000-0000000000a1', 'view')$q$, test.t('org'), d)) like '%criador já tem controle total%', 'o criador não é compartilhado consigo mesmo';
  perform set_config('t.mdash', d::text, true);
  raise notice 'PASS: avisos: preferências e leitura (11)';
end $$;
reset role;
:as_na
do $$
declare n int;
begin
  assert test.notif_n('ffffffff-0000-4000-8000-0000000000a2', 'dashboard_shared') = 0, 'com a preferência desligada o aviso de compartilhamento não é criado';
  n := public.bi_mark_notifications_read(test.t('org'));
  assert (select count(*) from public.bi_notifications where read_at is null) = 0, 'marcar como lidas zera as não lidas (só as próprias)';
  raise notice 'PASS: avisos: preferências e leitura (12)';
end $$;
reset role;
:as_va
do $$ begin
  assert (select count(*) from public.bi_notifications) = 0, 'avisos de outras pessoas nunca aparecem';
  raise notice 'PASS: avisos: preferências e leitura (13)';
end $$;
reset role;

-- ===================================================================== configurações e qualidade
:as_ma
do $$ begin
  assert test.errmsg(format($q$select public.bi_update_settings(%L, 'America/Sao_Paulo', 'DD/MM/YYYY', null, 50000, 20, 7, 5, 'last_30')$q$, test.t('org'))) like '%sem permissão%', 'gestor não altera configurações';
  raise notice 'PASS: configurações e qualidade (14)';
end $$;
reset role;
:as_oa
do $$
declare org uuid := test.t('org');
begin
  assert test.errmsg(format($q$select public.bi_update_settings(%L, 'Mars/Olympus', 'DD/MM/YYYY', null, 50000, 20, 7, 5, 'last_30')$q$, org)) like '%fuso horário inválido%', 'fuso inexistente recusado';
  assert test.errmsg(format($q$select public.bi_update_settings(%L, 'America/Sao_Paulo', 'DD/MM/YYYY', null, 90000, 20, 7, 5, 'last_30')$q$, org)) like '%limite fora do permitido%', 'mais que 50 mil linhas recusado';
  assert test.errmsg(format($q$select public.bi_update_settings(%L, 'America/Sao_Paulo', 'MM/DD/YYYY', null, 50000, 20, 7, 5, 'last_30')$q$, org)) like '%formato inválido%', 'formato de data fora da lista recusado';
  assert test.errmsg(format($q$select public.bi_update_settings(%L, 'America/Sao_Paulo', 'DD/MM/YYYY', null, 50000, 20, 7, 1, 'last_30')$q$, org)) like '%limite fora do permitido%', 'retenção abaixo de 2 versões recusada';
  perform public.bi_update_settings(org, 'America/Sao_Paulo', 'DD/MM/YYYY', 'Meu portal', 20000, 10, 3, 4, 'this_month');
  assert (select max_rows from public.bi_settings where organization_id = org) = 20000 and (select portal_name from public.bi_settings where organization_id = org) = 'Meu portal', 'administrador altera';
  raise notice 'PASS: configurações e qualidade (15)';
end $$;
reset role;
:as_na
do $$
declare org uuid := test.t('org'); q jsonb;
begin
  -- limite menor de linhas passa a valer
  assert test.errmsg(format($q$select public.bi_begin_import(%L, null, 'Grande', 'g.csv', %L, 'csv', 'replace', 'reject_all', '[{"key":"c1","name":"A","type":"string"}]', '{}', 20001)$q$, org, repeat('c', 64))) like '%de 1 a 20000 linhas%', 'o limite configurado vale para novas importações';
  q := public.bi_quality_overview(org);
  assert jsonb_array_length(q -> 'datasets') = 1 and (q -> 'datasets' -> 0 ->> 'rows')::int = 2 and (q -> 'datasets' -> 0 ->> 'stale')::boolean = false, 'qualidade: 1 dataset, 2 linhas, atualizado';
  assert (q -> 'datasets' -> 0 -> 'nulls' ->> 'c3')::int = 0 and jsonb_array_length(q -> 'recent_imports') = 1, 'vazios por coluna e histórico de importações';
  assert (q -> 'datasets' -> 0 ->> 'invalid_metrics')::int = 0, 'sem métricas inválidas';
  assert public.bi_check_freshness(org) = 0, 'nada desatualizado ainda';
  raise notice 'PASS: configurações e qualidade (16)';
end $$;
reset role;
select test.sql(format('update public.dataset_versions set published_at = now() - interval ''10 days'' where dataset_id = %L and status = ''published''', current_setting('t.ds')));
:as_na
do $$
declare org uuid := test.t('org'); n int; q jsonb;
begin
  q := public.bi_quality_overview(org);
  assert (q -> 'datasets' -> 0 ->> 'stale')::boolean, 'passou de 3 dias sem atualização: marcado como desatualizado';
  n := public.bi_check_freshness(org);
  assert n >= 3, 'avisos de dataset desatualizado para a equipe';
  assert public.bi_check_freshness(org) = 0, 'idempotente na mesma semana (sem avisos repetidos)';
  assert test.notif_n('ffffffff-0000-4000-8000-0000000000a2', 'dataset_stale') = 1, 'cada pessoa recebe um aviso';
  raise notice 'PASS: configurações e qualidade (17)';
end $$;
reset role;
:as_va
do $$ begin
  assert test.errmsg(format($q$select public.bi_quality_overview(%L)$q$, test.t('org'))) like '%sem permissão%', 'visualizador não vê a qualidade dos dados';
  assert test.errmsg(format($q$select public.bi_check_freshness(%L)$q$, test.t('org'))) like '%sem permissão%', 'nem dispara a checagem';
  raise notice 'PASS: configurações e qualidade (18)';
end $$;
reset role;

-- ===================================================================== MATRIZ DE SEGURANÇA
-- MFA no banco: administrador sem AAL2 não lê nem executa
:as_oa1
do $$
declare org uuid := test.t('org');
begin
  assert (select count(*) from public.datasets) = 0 and (select count(*) from public.dashboards) = 0 and (select count(*) from public.bi_settings) = 0, 'owner sem AAL2 não lê as tabelas (política restritiva)';
  assert test.errmsg(format($q$select public.bi_create_dataset(%L, 'Sem MFA')$q$, org)) like '%verificação em duas etapas%', 'nem executa funções';
  assert test.errmsg(format($q$select public.bi_quality_overview(%L)$q$, org)) like '%verificação em duas etapas%', 'nem consulta qualidade';
  raise notice 'PASS: MATRIZ DE SEGURANÇA (19)';
end $$;
reset role;
-- empresa B: nenhuma função aceita ids de A
:as_ob
do $$
declare ob uuid := test.t('orgb'); oa uuid := test.t('org'); ds uuid := test.t('ds'); mm uuid := test.t('m'); gg uuid := test.t('g'); v uuid := test.t('view'); e text; calls text[];
begin
  calls := array[
    format('select public.bi_update_dataset(%L, %L, ''x'', null, false)', ob, ds),
    format('select public.bi_archive_dataset(%L, %L)', ob, ds),
    format('select public.bi_set_dataset_access(%L, %L, ''ffffffff-0000-4000-8000-0000000000b0'', true)', ob, ds),
    format('select public.bi_update_columns(%L, %L, ''[]'')', ob, ds),
    format('select public.bi_save_dimension(%L, null, %L, ''x'', ''c1'')', ob, ds),
    format('select public.bi_save_metric(%L, null, %L, ''x'', null, ''aggregation'', ''count'', null, null, ''[]'', ''integer'', null)', ob, ds),
    format('select public.bi_archive_metric(%L, %L)', ob, mm),
    format('select public.bi_save_chart(%L, null, %L, ''x'', ''kpi'', ''{}'')', ob, ds),
    format('select public.bi_save_goal(%L, null, %L, ''x'', ''min'', ''month'', 1, null, 80, ''previous_period'', ''[]'', null)', ob, mm),
    format('select public.bi_set_goal_period(%L, %L, current_date, current_date, 1)', ob, gg),
    format('select public.bi_save_view(%L, %L, %L, ''x'', ''[]'', ''[]'', ''[]'')', ob, v, ds),
    format('select public.bi_run_query(%L, jsonb_build_object(''dataset_id'', %L, ''measures'', ''[{"alias":"m0","agg":"count"}]''::jsonb))', ob, ds),
    format('select public.bi_dataset_rows(%L, %L)', ob, ds),
    format('select public.bi_filter_values(%L, %L, ''c1'')', ob, ds),
    format('select public.bi_import_impact(%L, %L, ''[]'')', ob, ds),
    format('select public.bi_begin_import(%L, %L, null, ''a.csv'', %L, ''csv'', ''replace'', ''reject_all'', ''[{"key":"c1","name":"A","type":"string"}]'', ''{}'', 1)', ob, ds, repeat('d', 64)),
    format('select public.bi_publish_import(%L, %L)', ob, gen_random_uuid()),
    format('select public.bi_log_export(%L, %L, 1)', ob, gen_random_uuid()),
    format('select public.bi_quality_overview(%L)', oa),
    format('select public.bi_check_freshness(%L)', oa),
    format('select public.bi_update_settings(%L, ''America/Sao_Paulo'', ''DD/MM/YYYY'', null, 50000, 20, 7, 5, ''last_30'')', oa),
    format('select public.bi_create_dashboard(%L, ''Invasor'')', oa)];
  foreach e in array calls loop
    assert test.errmsg(e) is not null, 'empresa B deveria ser barrada em: ' || e;
  end loop;
  -- operações que, fora da empresa, não encontram nada para alterar: não podem ter efeito algum
  perform public.bi_delete_view(ob, v);
  perform public.bi_archive_goal(ob, gg);
  perform public.bi_mark_notifications_read(ob);
  assert test.cnt('select count(*) from public.saved_views') = 1, 'bi_delete_view com a empresa errada não apagou a visão de A';
  assert test.cnt('select count(*) from public.bi_notifications where read_at is null') >= 1, 'marcar como lido na empresa B não tocou nos avisos de A';
  assert (select count(*) from public.goal_definitions) = 0 and (select count(*) from public.saved_views) = 0 and (select count(*) from public.metric_definitions) = 0 and (select count(*) from public.bi_notifications) = 0, 'empresa B não lê nada de A';
  raise notice 'PASS: MATRIZ DE SEGURANÇA (20)';
end $$;
reset role;
-- anônimo não executa nada
:as_anon
do $$
declare r record; n int := 0;
begin
  for r in select p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'bi\_%' loop
    n := n + 1;
    assert not has_function_privilege('anon', (select p2.oid from pg_proc p2 where p2.proname = r.proname and p2.pronamespace = 'public'::regnamespace limit 1), 'execute'), 'anon não pode executar ' || r.proname;
  end loop;
  assert n >= 40, 'matriz cobre as funções públicas bi_* (' || n || ')';
  raise notice 'PASS: MATRIZ DE SEGURANÇA (21)';
end $$;
reset role;

-- higiene (como dono): privilégios por tabela, funções definer com search_path, RLS em tudo
do $$
declare r record; n int;
begin
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r'
       and c.relname in ('bi_settings', 'datasets', 'dataset_versions', 'dataset_columns', 'dataset_rows', 'dataset_access', 'import_jobs', 'import_row_errors', 'dimension_definitions',
         'metric_definitions', 'metric_versions', 'chart_definitions', 'dashboards', 'dashboard_versions', 'dashboard_widgets', 'dashboard_filters', 'dashboard_permissions', 'dashboard_favorites',
         'dashboard_views', 'goal_definitions', 'goal_periods', 'saved_views', 'report_exports', 'data_refresh_events', 'bi_notifications', 'bi_notification_prefs') loop
    assert (select relrowsecurity from pg_class where oid = ('public.' || r.relname)::regclass), 'RLS ligada em ' || r.relname;
    assert not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name = r.relname and g.grantee in ('authenticated', 'anon') and g.privilege_type <> 'SELECT'),
      'authenticated/anon só têm SELECT em ' || r.relname;
    assert not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name = r.relname and g.grantee = 'anon'), 'anon sem acesso a ' || r.relname;
  end loop;
  assert not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name = 'dataset_rows' and g.grantee in ('authenticated', 'anon')), 'dataset_rows: nenhum privilégio para usuários';
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'bi\_%' and not (p.prosecdef and p.proconfig::text like '%search_path%');
  assert n = 0, 'toda função pública bi_* é SECURITY DEFINER com search_path fixo (' || n || ' fora do padrão)';
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'private' and p.proname like 'bi\_%' and p.prosecdef and not (p.proconfig::text like '%search_path%');
  assert n = 0, 'toda função private bi_* SECURITY DEFINER tem search_path fixo';
  assert not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'bi\_%' and has_function_privilege('public', p.oid, 'execute')), 'nenhuma função bi_* executável por PUBLIC';
  -- funções que montam SQL ou leem linhas não são chamáveis pelo usuário
  assert not has_function_privilege('authenticated', 'private.bi_exec_query(uuid, uuid, jsonb, text)', 'execute'), 'bi_exec_query não é chamável por usuários';
  assert not has_function_privilege('authenticated', 'private.bi_cols(uuid)', 'execute'), 'bi_cols não é chamável por usuários';
  -- a auditoria não guarda valores: só nomes de colunas, contagens e ids
  assert not exists (select 1 from public.audit_log where action like any (array['import_%', 'dashboard_%', 'dataset_%', 'metric_%']) and changes::text ~* '(Loja|Site|Faturamento)'), 'a auditoria não carrega dados de negócio';
  raise notice 'PASS: higiene — privilégios, funções, RLS e auditoria';
end $$;

rollback;
select 'PASS 93_bi_goals_security' as result;
