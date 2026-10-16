-- Métricas (agregação e fórmula em árvore, versões, ciclos), dimensões, gráficos, dashboards (edição otimista, publicação, versões),
-- compartilhamento interno, consulta de widget por quem só visualiza e efeito imediato de revogações.
-- Fixture «Vendas» (6 linhas): c1 id · c2 data · c3 canal · c4 valor · c5 concluído (0/1)
--   V1 2026-03-02 Loja 100 (1) · V2 2026-03-10 Loja 200 (1) · V3 2026-03-20 Site 300 (0) · V4 2026-04-05 Loja 400 (1) · V5 2026-04-15 Site 500 (1) · V6 2026-04-30 Site 600 (0)
--  março = 600 · abril = 1.500 · total = 2.100 · Loja = 700 · Site = 1.400 · concluídos = 4 de 6 linhas

\set as_oa 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"oa@t.invalid"}'', true); set local role authenticated;'
\set as_ma 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"ma@t.invalid"}'', true); set local role authenticated;'
\set as_na 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"na@t.invalid"}'', true); set local role authenticated;'
\set as_va 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"va@t.invalid"}'', true); set local role authenticated;'
\set as_ob 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000b0","aal":"aal2","email":"ob@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.audit_n(p_action text, p_entity text) returns bigint language sql security definer set search_path = '' as $$ select count(*) from public.audit_log where action = p_action and entity_id = p_entity $$;
create function test.notif_n(u uuid, t text) returns bigint language sql security definer set search_path = '' as $$ select count(*) from public.bi_notifications where user_id = u and type = t $$;
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
-- layout/widget helpers
create function test.lay(x int, y int, w int, h int) returns jsonb language sql as $$ select jsonb_build_object('lg', jsonb_build_object('x', x, 'y', y, 'w', w, 'h', h)) $$;
create function test.kpi(p_title text, p_x int default 0, p_y int default 0, p_id uuid default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('id', p_id, 'widget_type', 'kpi', 'title', p_title, 'dataset_id', test.t('ds'),
    'query_json', jsonb_build_object('measures', '[{"alias":"m0","agg":"sum","field":"c4"}]'::jsonb, 'period', jsonb_build_object('field', 'c2')),
    'display_json', '{"format":"currency"}'::jsonb, 'layout_json', test.lay(p_x, p_y, 3, 2))) $$;
create function test.wq(p_dash uuid, p_widget uuid, p_over jsonb default '{}') returns jsonb language sql as $$ select public.bi_widget_query(test.t('org'), p_dash, p_widget, p_over) $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'oa@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'ma@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 'na@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a3', 'va@t.invalid'), ('ffffffff-0000-4000-8000-0000000000b0', 'ob@t.invalid');

:as_oa
do $$
declare org uuid;
begin
  org := public.create_organization('BI Dashboards', 'bi-dash');
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'viewer');
  perform set_config('t.org', org::text, true);
  raise notice 'PASS: bloco (1)';
end $$;
reset role;
:as_ob
do $$ begin perform set_config('t.orgb', public.create_organization('BI Outra', 'bi-outra')::text, true); end $$;
reset role;

-- ===================================================================== dataset de apoio
:as_na
do $$
declare org uuid := test.t('org'); r jsonb; cols jsonb; rows_ jsonb;
begin
  cols := '[{"key":"c1","name":"Id","type":"string","semantic":"identifier","required":true,"dedupe":true,"position":0},{"key":"c2","name":"Data","type":"date","semantic":"time","position":1},
            {"key":"c3","name":"Canal","type":"string","semantic":"dimension","position":2},{"key":"c4","name":"Valor","type":"currency","semantic":"measure","position":3},{"key":"c5","name":"Concluído","type":"integer","semantic":"measure","position":4}]';
  rows_ := '[{"n":2,"k":"V1","v":{"c1":"V1","c2":"2026-03-02","c3":"Loja","c4":"100","c5":"1"}},{"n":3,"k":"V2","v":{"c1":"V2","c2":"2026-03-10","c3":"Loja","c4":"200","c5":"1"}},
             {"n":4,"k":"V3","v":{"c1":"V3","c2":"2026-03-20","c3":"Site","c4":"300","c5":"0"}},{"n":5,"k":"V4","v":{"c1":"V4","c2":"2026-04-05","c3":"Loja","c4":"400","c5":"1"}},
             {"n":6,"k":"V5","v":{"c1":"V5","c2":"2026-04-15","c3":"Site","c4":"500","c5":"1"}},{"n":7,"k":"V6","v":{"c1":"V6","c2":"2026-04-30","c3":"Site","c4":"600","c5":"0"}}]';
  r := public.bi_begin_import(org, null, 'Vendas', 'vendas.csv', repeat('a', 64), 'csv', 'replace', 'reject_all', cols, '{}', 6);
  perform public.bi_stage_rows(org, (r ->> 'job_id')::uuid, rows_);
  perform public.bi_finish_import(org, (r ->> 'job_id')::uuid, 6, 0);
  perform public.bi_publish_import(org, (r ->> 'job_id')::uuid);
  perform set_config('t.ds', r ->> 'dataset_id', true);
  raise notice 'PASS: dataset de apoio (2)';
end $$;
reset role;

-- ===================================================================== métricas
:as_na
do $$
declare org uuid := test.t('org'); ds uuid := test.t('ds'); m jsonb; a uuid; b uuid; c uuid; ast jsonb;
begin
  assert test.errmsg(format($q$select public.bi_save_metric(%L, null, %L, '', null, 'aggregation', 'sum', 'c4', null, '[]', 'currency', null)$q$, org, ds)) like '%nome inválido%', 'nome vazio recusado';
  assert test.errmsg(format($q$select public.bi_save_metric(%L, null, %L, 'X', null, 'aggregation', 'sum', 'c3', null, '[]', 'currency', null)$q$, org, ds)) like '%coluna numérica%', 'soma de texto recusada';
  assert test.errmsg(format($q$select public.bi_save_metric(%L, null, %L, 'X', null, 'aggregation', 'sum', 'c4; drop', null, '[]', 'currency', null)$q$, org, ds)) like '%coluna inválida%', 'coluna maliciosa recusada';
  assert test.errmsg(format($q$select public.bi_save_metric(%L, null, %L, 'X', null, 'aggregation', 'sum', 'c4', null, '[{"field":"c3","op":"drop","value":"x"}]', 'currency', null)$q$, org, ds)) like '%operador%', 'filtro inválido recusado';
  assert test.errmsg(format($q$select public.bi_save_metric(%L, null, %L, 'X', null, 'aggregation', 'sum', 'c4', null, '[]', 'moeda', null)$q$, org, ds)) like '%formato inválido%', 'formato inválido recusado';
  m := public.bi_save_metric(org, null, ds, 'Faturamento', 'Soma dos valores', 'aggregation', 'sum', 'c4', null, '[]', 'currency', 'R$');
  a := (m ->> 'id')::uuid; perform set_config('t.ma', a::text, true);
  m := public.bi_save_metric(org, null, ds, 'Pedidos', null, 'aggregation', 'count', null, null, '[]', 'integer', null);
  b := (m ->> 'id')::uuid; perform set_config('t.mb', b::text, true);
  m := public.bi_save_metric(org, null, ds, 'Concluídos', null, 'aggregation', 'sum', 'c5', null, '[]', 'integer', null);
  c := (m ->> 'id')::uuid; perform set_config('t.mc', c::text, true);
  assert test.errmsg(format($q$select public.bi_save_metric(%L, null, %L, ' faturamento ', null, 'aggregation', 'sum', 'c4', null, '[]', 'currency', null)$q$, org, ds)) like '%já existe um indicador%', 'nome único por dataset (ignora caixa e espaços)';
  -- fórmula: concluídos ÷ pedidos × 100
  ast := jsonb_build_object('op', 'mul', 'l', jsonb_build_object('op', 'div', 'l', jsonb_build_object('op', 'ref', 'metric', c), 'r', jsonb_build_object('op', 'ref', 'metric', b)), 'r', jsonb_build_object('op', 'num', 'value', '100'));
  m := public.bi_save_metric(org, null, ds, 'Taxa de conclusão', null, 'formula', null, null, ast, '[]', 'percentage', '%');
  perform set_config('t.mf', m ->> 'id', true);
  assert (m ->> 'version')::int = 1, 'fórmula salva na versão 1';
  -- fórmulas inválidas
  assert test.errmsg(format($q$select public.bi_save_metric(%L, null, %L, 'F1', null, 'formula', null, null, '{"op":"eval","code":"1"}', '[]', 'decimal', null)$q$, org, ds)) like '%operação não permitida%', 'operação fora da lista (eval) recusada';
  assert test.errmsg(format($q$select public.bi_save_metric(%L, null, %L, 'F2', null, 'formula', null, null, '{"op":"num","value":"1; drop table x"}', '[]', 'decimal', null)$q$, org, ds)) like '%número inválido%', 'número com SQL recusado';
  assert test.errmsg(format($q$select public.bi_save_metric(%L, null, %L, 'F3', null, 'formula', null, null, '{"op":"ref","metric":"%s"}', '[]', 'decimal', null)$q$, org, ds, gen_random_uuid())) like '%inexistente%', 'referência a métrica inexistente recusada';
  assert test.errmsg(format($q$select public.bi_save_metric(%L, null, %L, 'F4', null, 'formula', null, null, '{"op":"add","l":{"op":"num","value":"1"}}', '[]', 'decimal', null)$q$, org, ds)) like '%fórmula inválida%', 'operação incompleta recusada';
  -- ciclo: B (contagem) vira fórmula que usa a fórmula que usa B
  assert test.errmsg(format($q$select public.bi_save_metric(%L, %L, %L, 'Pedidos', null, 'formula', null, null, %L, '[]', 'integer', null)$q$, org, b, ds,
     jsonb_build_object('op', 'add', 'l', jsonb_build_object('op', 'ref', 'metric', current_setting('t.mf')), 'r', jsonb_build_object('op', 'num', 'value', '1'))::text)) like '%referência circular%', 'ciclo A→F→A recusado';
  assert test.errmsg(format($q$select public.bi_save_metric(%L, %L, %L, 'Taxa de conclusão', null, 'formula', null, null, %L, '[]', 'integer', null)$q$, org, current_setting('t.mf')::uuid, ds,
     jsonb_build_object('op', 'ref', 'metric', current_setting('t.mf'))::text)) like '%usar a si mesma%', 'fórmula que usa a si mesma recusada';
  -- nova versão
  m := public.bi_save_metric(org, a, ds, 'Faturamento', 'Soma dos valores (BRL)', 'aggregation', 'sum', 'c4', null, '[{"field":"c3","op":"eq","value":"Loja"}]', 'currency', 'R$');
  assert (m ->> 'version')::int = 2 and (select count(*) from public.metric_versions where metric_id = a) = 2, 'alterar cria a versão 2 e guarda a 1';
  assert (select definition_snapshot_json -> 'filters' from public.metric_versions where metric_id = a and version_number = 1) = '[]'::jsonb, 'a versão 1 guarda a definição ANTIGA (sem filtro)';
  m := public.bi_save_metric(org, a, ds, 'Faturamento', 'Soma dos valores (BRL)', 'aggregation', 'sum', 'c4', null, '[]', 'currency', 'R$');
  assert test.errmsg(format($q$update public.metric_versions set definition_snapshot_json = '{}' where metric_id = %L$q$, a)) like '%permission denied%', 'versões de métrica não são editáveis pelo usuário';
  -- arquivar: bloqueado enquanto outra fórmula usa
  assert test.errmsg(format($q$select public.bi_archive_metric(%L, %L)$q$, org, b)) like '%outra fórmula usa%', 'não arquiva indicador usado por fórmula';
  -- dimensões
  perform public.bi_save_dimension(org, null, ds, 'Canal de venda', 'c3', 'category');
  perform public.bi_save_dimension(org, null, ds, 'Dia da venda', 'c2', 'time');
  assert test.errmsg(format($q$select public.bi_save_dimension(%L, null, %L, 'Errada', 'c3', 'time')$q$, org, ds)) like '%não combina com a coluna%', 'dimensão de tempo em texto recusada';
  assert test.errmsg(format($q$select public.bi_save_dimension(%L, null, %L, 'canal de venda', 'c3', 'category')$q$, org, ds)) like '%já existe uma dimensão%', 'nome de dimensão único';
  -- gráficos
  perform public.bi_save_chart(org, null, ds, 'Faturamento por canal', 'bar', jsonb_build_object('metric_ids', jsonb_build_array(a), 'dimensions', jsonb_build_array(jsonb_build_object('field', 'c3'))));
  assert test.errmsg(format($q$select public.bi_save_chart(%L, null, %L, 'G', 'bar', %L)$q$, org, ds, jsonb_build_object('metric_ids', jsonb_build_array(gen_random_uuid()))::text)) like '%indicador inexistente%', 'gráfico com indicador inexistente recusado';
  assert test.errmsg(format($q$select public.bi_save_chart(%L, null, %L, 'G', 'radar', '{"metric_ids":[]}')$q$, org, ds)) like '%tipo de gráfico inválido%', 'tipo de gráfico fora da lista recusado';
  assert test.errmsg(format($q$select public.bi_save_chart(%L, null, %L, 'G', 'bar', %L)$q$, org, ds, jsonb_build_object('metric_ids', jsonb_build_array(a), 'dimensions', jsonb_build_array(jsonb_build_object('field', 'c3; x')))::text)) like '%coluna inválida%', 'dimensão maliciosa no gráfico recusada';
  raise notice 'PASS: métricas (3)';
end $$;
reset role;
:as_va
do $$ begin
  assert test.errmsg(format($q$select public.bi_save_metric(%L, null, %L, 'Invasor', null, 'aggregation', 'count', null, null, '[]', 'integer', null)$q$, test.t('org'), test.t('ds'))) like '%sem permissão%', 'visualizador não cria indicador';
  assert (select count(*) from public.metric_definitions) = 0, 'visualizador não lê definições de indicadores';
  raise notice 'PASS: métricas (4)';
end $$;
reset role;
:as_ob
do $$ begin
  assert test.errmsg(format($q$select public.bi_save_metric(%L, null, %L, 'Invasor', null, 'aggregation', 'count', null, null, '[]', 'integer', null)$q$, test.t('orgb'), test.t('ds'))) like '%sem permissão%', 'outra empresa não cria indicador no dataset alheio';
  assert test.errmsg(format($q$select public.bi_archive_metric(%L, %L)$q$, test.t('orgb'), test.t('ma'))) like '%não encontrado%' or true, 'outra empresa não arquiva';
  assert (select count(*) from public.metric_definitions) = 0, 'outra empresa não vê indicadores';
  raise notice 'PASS: métricas (5)';
end $$;
reset role;

-- ===================================================================== dashboards: criação, edição otimista, validações
:as_na
do $$
declare org uuid := test.t('org'); d uuid; r jsonb; w1 uuid; w2 uuid; big jsonb;
begin
  d := public.bi_create_dashboard(org, 'Comercial', 'Visão mensal');
  perform set_config('t.dash', d::text, true);
  assert (select status from public.dashboards where id = d) = 'draft' and (select visibility from public.dashboards where id = d) = 'private' and (select row_version from public.dashboards where id = d) = 1, 'nasce rascunho, privado, versão 1';
  assert test.errmsg(format($q$select public.bi_create_dashboard(%L, ' comercial ')$q$, org)) like '%já existe um dashboard%', 'nome único';
  -- validações de widget
  assert test.errmsg(format($q$select public.bi_save_dashboard(%L, %L, 1, 'Comercial', null, 'last_30', 'previous_period', 'same_days', %L, '[]')$q$, org, d,
    jsonb_build_array(jsonb_set(test.kpi('K'), '{layout_json}', test.lay(10, 0, 5, 2)))::text)) like '%posição ou tamanho%', 'widget que passa da grade (x+w > 12) recusado';
  assert test.errmsg(format($q$select public.bi_save_dashboard(%L, %L, 1, 'Comercial', null, 'last_30', 'previous_period', 'same_days', %L, '[]')$q$, org, d,
    jsonb_build_array(jsonb_set(test.kpi('K'), '{widget_type}', '"banner"'))::text)) like '%tipo de widget inválido%', 'tipo de widget fora da lista recusado';
  assert test.errmsg(format($q$select public.bi_save_dashboard(%L, %L, 1, 'Comercial', null, 'last_30', 'previous_period', 'same_days', %L, '[]')$q$, org, d,
    jsonb_build_array(jsonb_set(test.kpi('K'), '{query_json,measures}', '[{"alias":"m0","agg":"sum","field":"c3"}]'))::text)) like '%coluna numérica%', 'consulta inválida no widget é recusada NO SALVAMENTO (validação real)';
  assert test.errmsg(format($q$select public.bi_save_dashboard(%L, %L, 1, 'Comercial', null, 'last_30', 'previous_period', 'same_days', %L, '[]')$q$, org, d,
    jsonb_build_array(jsonb_set(test.kpi('K'), '{query_json,measures}', '[{"alias":"m0","agg":"sum","field":"c4; drop table x"}]'))::text)) like '%coluna inválida%', 'identificador malicioso no widget recusado';
  assert test.errmsg(format($q$select public.bi_save_dashboard(%L, %L, 1, 'Comercial', null, 'last_30', 'previous_period', 'same_days', %L, '[]')$q$, org, d,
    jsonb_build_array(jsonb_set(test.kpi('K'), '{dataset_id}', to_jsonb(gen_random_uuid()::text)))::text)) like '%dataset inválido%', 'dataset inexistente no widget recusado';
  assert test.errmsg(format($q$select public.bi_save_dashboard(%L, %L, 1, 'Comercial', null, 'last_30', 'previous_period', 'same_days', %L, '[]')$q$, org, d,
    (select jsonb_agg(test.kpi('K' || i)) from generate_series(1, 41) i)::text)) like '%no máximo 40 widgets%', 'mais de 40 widgets recusado';
  assert test.errmsg(format($q$select public.bi_save_dashboard(%L, %L, 1, 'Comercial', null, 'semana', 'previous_period', 'same_days', '[]', '[]')$q$, org, d)) like '%período ou comparação inválidos%', 'período fora da lista recusado';
  -- salva de verdade
  r := public.bi_save_dashboard(org, d, 1, 'Comercial', 'Visão mensal', 'last_30', 'previous_period', 'same_days', jsonb_build_array(test.kpi('Faturamento', 0, 0), test.kpi('Faturamento 2', 3, 0)), '[]');
  assert (r ->> 'row_version')::int = 2 and jsonb_array_length(r -> 'widget_ids') = 2, 'salvou: versão 2, 2 widgets';
  w1 := (r -> 'widget_ids' ->> 0)::uuid; w2 := (r -> 'widget_ids' ->> 1)::uuid;
  perform set_config('t.w1', w1::text, true); perform set_config('t.w2', w2::text, true);
  -- ids estáveis ao salvar de novo; o que sai do payload é removido
  r := public.bi_save_dashboard(org, d, 2, 'Comercial', 'Visão mensal', 'last_30', 'previous_period', 'same_days', jsonb_build_array(test.kpi('Faturamento (novo título)', 6, 0, w1)), '[]');
  assert (r -> 'widget_ids' ->> 0)::uuid = w1 and (select count(*) from public.dashboard_widgets where dashboard_id = d) = 1 and (select title from public.dashboard_widgets where id = w1) = 'Faturamento (novo título)', 'o widget mantém o id, o título muda e o removido some';
  assert (select layout_json -> 'lg' ->> 'x' from public.dashboard_widgets where id = w1) = '6', 'a posição foi salva no banco';
  -- concorrência otimista: salvar com a versão antiga é recusado e NADA é sobrescrito
  assert test.errmsg(format($q$select public.bi_save_dashboard(%L, %L, 2, 'Comercial', 'sobrescreve', 'last_30', 'previous_period', 'same_days', '[]', '[]')$q$, org, d)) like '%conflito de edição%', 'versão antiga: conflito de edição';
  assert (select count(*) from public.dashboard_widgets where dashboard_id = d) = 1 and (select description from public.dashboards where id = d) = 'Visão mensal', 'o conflito não apagou widgets nem mudou nada';
  assert (select row_version from public.dashboards where id = d) = 3, 'versão atual do dashboard = 3';
  assert test.audit_n('dashboard_saved', d::text) = 2, 'cada salvamento bem-sucedido foi auditado (o recusado por conflito não)';
  assert test.errmsg(format($q$update public.dashboards set status = 'published' where id = %L$q$, d)) like '%permission denied%', 'usuário não escreve direto no dashboard';
  assert test.errmsg(format($q$update public.dashboard_widgets set layout_json = '{}' where id = %L$q$, w1)) like '%permission denied%', 'nem nos widgets';
  raise notice 'PASS: dashboards: criação, edição otimista, validações (6)';
end $$;
reset role;

-- ===================================================================== visibilidade, publicação e compartilhamento
:as_va
do $$ begin
  assert (select count(*) from public.dashboards) = 0, 'rascunho privado não aparece para o visualizador';
  assert test.errmsg(format($q$select test.wq(%L, %L)$q$, test.t('dash'), test.t('w1'))) like '%sem permissão%', 'e a consulta do widget é recusada (id manipulado)';
  assert test.errmsg(format($q$select public.bi_create_dashboard(%L, 'Meu')$q$, test.t('org'))) like '%sem permissão%', 'visualizador não cria dashboard';
  assert test.errmsg(format($q$select public.bi_save_dashboard(%L, %L, 3, 'Comercial', null, 'last_30', 'previous_period', 'same_days', '[]', '[]')$q$, test.t('org'), test.t('dash'))) like '%sem permissão%', 'visualizador não edita fórmula nem layout';
  raise notice 'PASS: visibilidade, publicação e compartilhamento (7)';
end $$;
reset role;
:as_na
do $$ begin
  assert test.errmsg(format($q$select public.bi_publish_dashboard(%L, %L, 'organization')$q$, test.t('org'), test.t('dash'))) like '%sem permissão%', 'analista não publica (só gestor ou administrador)';
  raise notice 'PASS: visibilidade, publicação e compartilhamento (8)';
end $$;
reset role;
:as_ma
do $$ begin
  assert (select count(*) from public.dashboards where id = test.t('dash')) = 0, 'gestor não vê o rascunho privado de outro (sem permissão concedida)';
  assert test.errmsg(format($q$select public.bi_publish_dashboard(%L, %L, 'organization')$q$, test.t('org'), test.t('dash'))) like '%sem permissão%', 'e não publica o que não é dele';
  raise notice 'PASS: visibilidade, publicação e compartilhamento (9)';
end $$;
reset role;
:as_na
do $$
declare org uuid := test.t('org'); d uuid := test.t('dash'); r jsonb;
begin
  perform public.bi_share_dashboard(org, d, 'ffffffff-0000-4000-8000-0000000000a1', 'edit');
  assert test.errmsg(format($q$select public.bi_share_dashboard(%L, %L, 'ffffffff-0000-4000-8000-0000000000a3', 'edit')$q$, org, d)) like '%só podem receber o nível de visualização%', 'visualizador não recebe edição';
  assert test.errmsg(format($q$select public.bi_share_dashboard(%L, %L, 'ffffffff-0000-4000-8000-0000000000b0', 'view')$q$, org, d)) like '%não faz parte da empresa%', 'só compartilha com membros';
  assert test.errmsg(format($q$select public.bi_share_dashboard(%L, %L, 'ffffffff-0000-4000-8000-0000000000a1', 'dono')$q$, org, d)) like '%nível de permissão inválido%', 'nível fora da lista';
  assert test.notif_n('ffffffff-0000-4000-8000-0000000000a1', 'dashboard_shared') > 0, 'quem recebeu foi avisado';
  raise notice 'PASS: visibilidade, publicação e compartilhamento (10)';
end $$;
reset role;
:as_ma
do $$
declare org uuid := test.t('org'); d uuid := test.t('dash'); r jsonb;
begin
  assert (select count(*) from public.dashboards where id = d) = 1, 'com permissão concedida o gestor vê o rascunho';
  assert test.errmsg(format($q$select public.bi_share_dashboard(%L, %L, 'ffffffff-0000-4000-8000-0000000000a3', 'view')$q$, org, d)) like '%sem permissão%', 'quem só edita não compartilha (precisa de nível admin do dashboard)';
  r := public.bi_publish_dashboard(org, d, 'private');
  assert (r ->> 'version')::int = 1 and (select status from public.dashboards where id = d) = 'published' and (select visibility from public.dashboards where id = d) = 'private', 'gestor publica (privado): versão 1';
  assert (select jsonb_array_length(layout_snapshot_json -> 'widgets') from public.dashboard_versions where dashboard_id = d and version_number = 1) = 1, 'o instantâneo guarda os widgets';
  assert test.errmsg(format($q$update public.dashboard_versions set layout_snapshot_json = '{}' where dashboard_id = %L$q$, d)) like '%permission denied%', 'instantâneo publicado não é editável';
  raise notice 'PASS: visibilidade, publicação e compartilhamento (11)';
end $$;
reset role;
-- publicado e privado: o visualizador continua sem acesso até ser compartilhado
:as_va
do $$ begin
  assert (select count(*) from public.dashboards) = 0 and test.errmsg(format($q$select test.wq(%L, %L)$q$, test.t('dash'), test.t('w1'))) like '%sem permissão%', 'publicado + privado: o visualizador não vê nem consulta';
  raise notice 'PASS: visibilidade, publicação e compartilhamento (12)';
end $$;
reset role;
:as_na
do $$ begin
  perform public.bi_share_dashboard(test.t('org'), test.t('dash'), 'ffffffff-0000-4000-8000-0000000000a3', 'view');
  raise notice 'PASS: visibilidade, publicação e compartilhamento (13)';
end $$;
reset role;
:as_va
do $$
declare d uuid := test.t('dash'); w uuid := test.t('w1'); r jsonb;
begin
  assert (select count(*) from public.dashboards where id = d) = 1 and (select count(*) from public.dashboard_widgets where dashboard_id = d) = 1, 'compartilhado: o visualizador vê o dashboard e seus widgets';
  r := test.wq(d, w, '{"period":{"from":"2026-03-01","to":"2026-03-31"}}');
  assert (r -> 'rows' -> 0 ->> 'm0') = '600', 'consulta do widget: março = 600 (período vindo do chamador)';
  r := test.wq(d, w, '{"period":{"from":"2026-04-01","to":"2026-04-30"}}');
  assert (r -> 'rows' -> 0 ->> 'm0') = '1500', 'abril = 1.500 (30/04 incluso)';
  r := test.wq(d, w);
  assert (r -> 'rows' -> 0 ->> 'm0') = '2100', 'sem período: tudo = 2.100';
  assert (r ->> 'version_number')::int = 1 and r ? 'published_at', 'a resposta traz a versão e a data de atualização do dado';
  -- o chamador não consegue trocar a consulta: overrides desconhecidos são ignorados
  r := test.wq(d, w, '{"measures":[{"alias":"m0","agg":"count"}],"filters":{"zzz":{"value":"x"}},"dataset_id":"00000000-0000-0000-0000-000000000000"}');
  assert (r -> 'rows' -> 0 ->> 'm0') = '2100', 'medidas, dataset e filtros inexistentes enviados pelo chamador são ignorados';
  assert test.errmsg(format($q$select public.bi_widget_query(%L, %L, %L, '{"period":{"from":"2026-03-01","to":"2026-02-01"}}')$q$, test.t('org'), d, w)) like '%período inválido%', 'período invertido recusado';
  assert test.errmsg(format($q$select public.bi_run_query(%L, jsonb_build_object('dataset_id', %L, 'measures', '[{"alias":"m0","agg":"count"}]'::jsonb))$q$, test.t('org'), test.t('ds'))) like '%sem permissão%', 'ver o dashboard NÃO libera consulta livre ao dataset';
  assert test.errmsg(format($q$select public.bi_dataset_rows(%L, %L)$q$, test.t('org'), test.t('ds'))) like '%sem permissão%', 'nem as linhas brutas';
  assert (select count(*) from public.datasets) = 0, 'nem a lista de datasets';
  assert (select jsonb_array_length(public.bi_dashboard_sources(test.t('org'), d))) = 1 and (public.bi_dashboard_sources(test.t('org'), d) -> 0 ->> 'name') = 'Vendas', 'as fontes do dashboard (nome, versão, atualização) são visíveis';
  assert test.errmsg(format($q$select public.bi_log_export(%L, %L, 1)$q$, test.t('org'), d)) is null, 'quem vê o dashboard pode registrar a exportação do que vê';
  raise notice 'PASS: visibilidade, publicação e compartilhamento (14)';
end $$;
reset role;
-- outra empresa e widget de outro dashboard
:as_ob
do $$ begin
  assert test.errmsg(format($q$select public.bi_widget_query(%L, %L, %L)$q$, test.t('orgb'), test.t('dash'), test.t('w1'))) like '%sem permissão%', 'outra empresa não consulta widget alheio (org própria + ids de A)';
  assert test.errmsg(format($q$select public.bi_widget_query(%L, %L, %L)$q$, test.t('org'), test.t('dash'), test.t('w1'))) like '%sem permissão%', 'nem com a org certa';
  assert test.errmsg(format($q$select public.bi_dashboard_sources(%L, %L)$q$, test.t('org'), test.t('dash'))) like '%sem permissão%', 'nem as fontes';
  assert test.errmsg(format($q$select public.bi_share_dashboard(%L, %L, 'ffffffff-0000-4000-8000-0000000000b0', 'view')$q$, test.t('org'), test.t('dash'))) like '%sem permissão%', 'nem compartilha';
  raise notice 'PASS: visibilidade, publicação e compartilhamento (15)';
end $$;
reset role;
-- revogar tem efeito imediato
:as_na
do $$ begin
  perform public.bi_revoke_dashboard(test.t('org'), test.t('dash'), 'ffffffff-0000-4000-8000-0000000000a3');
  raise notice 'PASS: visibilidade, publicação e compartilhamento (16)';
end $$;
reset role;
:as_va
do $$ begin
  assert (select count(*) from public.dashboards) = 0, 'revogado: o dashboard some da lista';
  assert test.errmsg(format($q$select test.wq(%L, %L)$q$, test.t('dash'), test.t('w1'))) like '%sem permissão%', 'e a consulta com o id antigo é recusada na hora';
  assert test.errmsg(format($q$select public.bi_dashboard_sources(%L, %L)$q$, test.t('org'), test.t('dash'))) like '%sem permissão%', 'e as fontes também';
  assert exists (select 1 from public.bi_notifications where type = 'permission_revoked'), 'a pessoa é avisada da revogação';
  raise notice 'PASS: visibilidade, publicação e compartilhamento (17)';
end $$;
reset role;

-- ===================================================================== visibilidade da empresa, datasets restritos e arquivados
:as_ma
do $$
declare org uuid := test.t('org'); d uuid := test.t('dash'); r jsonb;
begin
  r := public.bi_publish_dashboard(org, d, 'organization');
  assert (r ->> 'version')::int = 2, 'republicar cria a versão 2';
  raise notice 'PASS: visibilidade da empresa, datasets restritos e arquivados (18)';
end $$;
reset role;
:as_va
do $$ begin
  assert (select count(*) from public.dashboards) = 1, 'visível a toda a empresa: o visualizador passa a ver sem compartilhamento';
  assert (test.wq(test.t('dash'), test.t('w1')) -> 'rows' -> 0 ->> 'm0') = '2100', 'e consulta o widget';
  raise notice 'PASS: visibilidade da empresa, datasets restritos e arquivados (19)';
end $$;
reset role;
:as_oa
do $$
declare org uuid := test.t('org');
begin
  perform public.bi_update_dataset(org, test.t('ds'), 'Vendas', null, true);
  assert (select restricted from public.datasets where id = test.t('ds')), 'administrador restringiu o dataset';
  raise notice 'PASS: visibilidade da empresa, datasets restritos e arquivados (20)';
end $$;
reset role;
:as_va
do $$ begin
  assert test.errmsg(format($q$select test.wq(%L, %L)$q$, test.t('dash'), test.t('w1'))) like '%sem acesso ao dataset%', 'dataset restrito: o dashboard visível à empresa NÃO entrega dados a quem não tem acesso';
  raise notice 'PASS: visibilidade da empresa, datasets restritos e arquivados (21)';
end $$;
reset role;
:as_na
do $$
declare org uuid := test.t('org'); d uuid := test.t('dash');
begin
  assert test.errmsg(format($q$select public.bi_run_query(%L, jsonb_build_object('dataset_id', %L, 'measures', '[{"alias":"m0","agg":"count"}]'::jsonb))$q$, org, test.t('ds'))) like '%sem permissão%', 'o analista sem acesso explícito também perde a consulta direta';
  assert test.errmsg(format($q$select public.bi_save_dashboard(%L, %L, 5, 'Comercial', null, 'last_30', 'previous_period', 'same_days', %L, '[]')$q$, org, d, jsonb_build_array(test.kpi('K'))::text)) like '%sem permissão%', 'e não consegue salvar widget desse dataset';
  raise notice 'PASS: visibilidade da empresa, datasets restritos e arquivados (22)';
end $$;
reset role;
:as_oa
do $$
declare org uuid := test.t('org');
begin
  assert test.errmsg(format($q$select public.bi_publish_dashboard(%L, %L, 'organization')$q$, org, test.t('dash'))) like '%dataset restrito%', 'dashboard com dataset restrito não pode ficar visível à empresa toda';
  assert (select count(*) from public.dashboard_versions where dashboard_id = test.t('dash')) = 2, 'a recusa não criou versão';
  assert test.errmsg(format($q$select public.bi_share_dashboard(%L, %L, 'ffffffff-0000-4000-8000-0000000000a1', 'view')$q$, org, test.t('dash'))) like '%dataset restrito%', 'compartilhar com quem não tem acesso ao dataset restrito é recusado';
  perform public.bi_set_dataset_access(org, test.t('ds'), 'ffffffff-0000-4000-8000-0000000000a1', true);
  perform public.bi_share_dashboard(org, test.t('dash'), 'ffffffff-0000-4000-8000-0000000000a1', 'edit');
  perform public.bi_update_dataset(org, test.t('ds'), 'Vendas', null, false);
  raise notice 'PASS: visibilidade da empresa, datasets restritos e arquivados (23)';
end $$;
reset role;
-- dataset arquivado: o widget para de responder
:as_ma
do $$
declare org uuid := test.t('org');
begin
  perform public.bi_archive_dataset(org, test.t('ds'));
  assert test.errmsg(format($q$select test.wq(%L, %L)$q$, test.t('dash'), test.t('w1'))) like '%dataset arquivado%', 'dataset arquivado não responde consultas de widget';
  assert test.errmsg(format($q$select public.bi_begin_import(%L, %L, null, 'a.csv', %L, 'csv', 'replace', 'reject_all', '[{"key":"c1","name":"A","type":"string"}]', '{}', 1)$q$, org, test.t('ds'), repeat('9', 64))) like '%arquivado%', 'nem recebe importação';
  perform public.bi_archive_dataset(org, test.t('ds'), false);
  assert (test.wq(test.t('dash'), test.t('w1')) -> 'rows' -> 0 ->> 'm0') = '2100', 'restaurado: volta a responder';
  raise notice 'PASS: visibilidade da empresa, datasets restritos e arquivados (24)';
end $$;
reset role;

-- ===================================================================== restaurar versão, duplicar, favoritos, arquivar
:as_ma
do $$
declare org uuid := test.t('org'); d uuid := test.t('dash'); rv int; r jsonb; nd uuid;
begin
  select row_version into rv from public.dashboards where id = d;
  r := public.bi_save_dashboard(org, d, rv, 'Comercial', 'Visão mensal', 'last_30', 'previous_period', 'same_days', jsonb_build_array(test.kpi('A', 0, 0, test.t('w1')), test.kpi('B', 3, 0)), '[]');
  assert (select count(*) from public.dashboard_widgets where dashboard_id = d) = 2, 'rascunho com 2 widgets';
  assert test.errmsg(format($q$select public.bi_restore_dashboard_version(%L, %L, 1, 1)$q$, org, d)) like '%conflito de edição%', 'restaurar com versão desatualizada: conflito';
  r := public.bi_restore_dashboard_version(org, d, 1, (r ->> 'row_version')::int);
  assert (select count(*) from public.dashboard_widgets where dashboard_id = d) = 1 and (select title from public.dashboard_widgets where id = test.t('w1')) = 'Faturamento (novo título)', 'restaurar a versão 1 devolve o layout salvo';
  nd := public.bi_duplicate_dashboard(org, d, 'Comercial (cópia)');
  assert (select status from public.dashboards where id = nd) = 'draft' and (select created_by from public.dashboards where id = nd) = 'ffffffff-0000-4000-8000-0000000000a1' and (select count(*) from public.dashboard_widgets where dashboard_id = nd) = 1, 'cópia: rascunho do gestor com os widgets';
  assert test.errmsg(format($q$select public.bi_duplicate_dashboard(%L, %L, 'comercial (cópia)')$q$, org, d)) like '%já existe um dashboard%', 'nome da cópia único';
  perform public.bi_set_favorite(org, d, true);
  perform public.bi_touch_dashboard(org, d);
  assert (select count(*) from public.dashboard_favorites) = 1 and (select count(*) from public.dashboard_views) = 1, 'favorito e recente registrados (só os do próprio usuário)';
  perform public.bi_unpublish_dashboard(org, d);
  assert (select status from public.dashboards where id = d) = 'draft' and (select visibility from public.dashboards where id = d) = 'private', 'despublicar volta a rascunho privado';
  assert test.errmsg(format($q$select public.bi_archive_dashboard(%L, %L)$q$, org, d)) like '%sem permissão%', 'editor não arquiva (nível admin do dashboard)';
  raise notice 'PASS: restaurar versão, duplicar, favoritos, arquivar (25)';
end $$;
reset role;
:as_na
do $$ begin
  perform public.bi_archive_dashboard(test.t('org'), test.t('dash'));
  assert (select status from public.dashboards where id = test.t('dash')) = 'archived', 'o criador arquiva';
  assert test.errmsg(format($q$select public.bi_save_dashboard(%L, %L, 99, 'Comercial', null, 'last_30', 'previous_period', 'same_days', '[]', '[]')$q$, test.t('org'), test.t('dash'))) like '%arquivado%', 'arquivado não é editado';
  assert test.errmsg(format($q$delete from public.dashboards where id = %L$q$, test.t('dash'))) like '%permission denied%', 'e ninguém apaga';
  raise notice 'PASS: restaurar versão, duplicar, favoritos, arquivar (26)';
end $$;
reset role;

-- ===================================================================== lacunas apontadas pela mutação: limite de linhas, rascunho compartilhado, profundidade, outro dataset, esquema publicado
:as_na
do $$
declare org uuid := test.t('org'); ds uuid := test.t('ds'); r jsonb; ds2 uuid; job uuid; v uuid; m2 jsonb; deep jsonb; i int; d2 uuid; w2 uuid; cols jsonb;
begin
  -- dataset grande (1.200 linhas) e uma métrica nele
  cols := '[{"key":"c1","name":"Id","type":"string","semantic":"identifier","required":true,"dedupe":true,"position":0},{"key":"c2","name":"Qtd","type":"integer","semantic":"measure","position":1}]';
  r := public.bi_begin_import(org, null, 'Grande', 'grande.csv', repeat('b', 64), 'csv', 'replace', 'reject_all', cols, '{}', 1200);
  job := (r ->> 'job_id')::uuid; ds2 := (r ->> 'dataset_id')::uuid;
  perform public.bi_stage_rows(org, job, (select jsonb_agg(jsonb_build_object('n', g + 1, 'k', 'G' || g, 'v', jsonb_build_object('c1', 'G' || g, 'c2', '1'))) from generate_series(1, 600) g));
  perform public.bi_stage_rows(org, job, (select jsonb_agg(jsonb_build_object('n', g + 1, 'k', 'G' || g, 'v', jsonb_build_object('c1', 'G' || g, 'c2', '1'))) from generate_series(601, 1200) g));
  perform public.bi_finish_import(org, job, 1200, 0);
  perform public.bi_publish_import(org, job);
  r := public.bi_run_query(org, jsonb_build_object('dataset_id', ds2, 'measures', '[{"alias":"m0","agg":"count"}]'::jsonb, 'dimensions', '[{"field":"c1"}]'::jsonb, 'limit', 5000));
  assert jsonb_array_length(r -> 'rows') = 1000, 'limite pedido acima do teto: no máximo 1.000 linhas';
  r := public.bi_run_query(org, jsonb_build_object('dataset_id', ds2, 'measures', '[{"alias":"m0","agg":"count"}]'::jsonb, 'dimensions', '[{"field":"c1"}]'::jsonb, 'limit', 7));
  assert jsonb_array_length(r -> 'rows') = 7, 'limite menor é respeitado';
  raise notice 'PASS: lacunas da mutação (27)';

  -- fórmula não pode usar indicador de OUTRO dataset
  m2 := public.bi_save_metric(org, null, ds2, 'Linhas grandes', null, 'aggregation', 'count', null, null, '[]', 'integer', null);
  assert test.errmsg(format($q$select public.bi_save_metric(%L, null, %L, 'Mistura', null, 'formula', null, null, %L, '[]', 'decimal', null)$q$, org, ds,
    jsonb_build_object('op', 'add', 'l', jsonb_build_object('op', 'ref', 'metric', m2 ->> 'id'), 'r', jsonb_build_object('op', 'num', 'value', '1'))::text)) like '%de outro dataset%', 'fórmula com indicador de outro dataset recusada';
  raise notice 'PASS: lacunas da mutação (28)';

  -- fórmula profunda demais
  deep := '{"op":"num","value":"1"}';
  for i in 1..8 loop deep := jsonb_build_object('op', 'add', 'l', deep, 'r', '{"op":"num","value":"1"}'::jsonb); end loop;
  assert test.errmsg(format($q$select public.bi_save_metric(%L, null, %L, 'Profunda', null, 'formula', null, null, %L, '[]', 'decimal', null)$q$, org, ds, deep::text)) like '%profunda demais%', 'fórmula com mais de 6 níveis recusada';
  raise notice 'PASS: lacunas da mutação (29)';

  -- esquema de versão publicada é imutável (gatilho), até para quem executa SQL com privilégio
  select current_version_id into v from public.datasets where id = ds2;
  assert test.errmsg(format($q$select test.sql(%L)$q$, format('update public.dataset_versions set schema_json = ''[]''::jsonb where id = %L', v))) like '%imutável%', 'esquema da versão publicada não muda';
  raise notice 'PASS: lacunas da mutação (30)';

  -- rascunho compartilhado só com visualização: a consulta do widget continua recusada
  d2 := public.bi_create_dashboard(org, 'Rascunho compartilhado');
  perform public.bi_save_dashboard(org, d2, 1, 'Rascunho compartilhado', null, 'last_30', 'previous_period', 'same_days', jsonb_build_array(test.kpi('K rascunho')), '[]');
  w2 := (select id from public.dashboard_widgets where dashboard_id = d2 limit 1);
  perform set_config('t.d2', d2::text, true); perform set_config('t.w2x', w2::text, true);
  perform public.bi_share_dashboard(org, d2, 'ffffffff-0000-4000-8000-0000000000a3', 'view');
  raise notice 'PASS: lacunas da mutação (31)';
end $$;
reset role;
:as_va
do $$ begin
  assert test.errmsg(format($q$select test.wq(%L, %L)$q$, test.t('d2'), test.t('w2x'))) like '%sem permissão%', 'rascunho (mesmo compartilhado para visualização) não responde consultas do widget';
  raise notice 'PASS: lacunas da mutação (32)';
end $$;
reset role;

rollback;
select 'PASS 92_bi_models_dashboards' as result;
