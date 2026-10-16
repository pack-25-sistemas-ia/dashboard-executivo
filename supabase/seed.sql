-- Dados de DEMONSTRAÇÃO fictícios e determinísticos da «Horizonte Distribuidora (dados fictícios)». Local apenas. Senha dos usuários @demo.exemplo: DemoLocal#2026.
-- Datasets, indicadores, dashboards, metas e acessos nascem pelas MESMAS funções do sistema (bi_begin_import → bi_stage_rows → bi_finish_import → bi_publish_import,
-- bi_save_metric, bi_save_dashboard…), com a sessão do usuário simulada por claims: as regras (tipos, versões, permissões, auditoria) valem também para a demonstração.
-- Datas relativas ao dia da criação do banco. NUNCA use este arquivo em produção.

create function pg_temp.as_user(p_id text, p_aal text) returns void language sql as $f$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'aal', p_aal, 'role', 'authenticated')::text, true) $f$;
create function pg_temp.as_owner() returns void language sql as $f$ select pg_temp.as_user('b9b9b9b9-0000-4000-8000-0000000000a1', 'aal2') $f$;
create function pg_temp.as_manager() returns void language sql as $f$ select pg_temp.as_user('b9b9b9b9-0000-4000-8000-0000000000a2', 'aal1') $f$;
create function pg_temp.as_analyst() returns void language sql as $f$ select pg_temp.as_user('b9b9b9b9-0000-4000-8000-0000000000a3', 'aal1') $f$;
create function pg_temp.org() returns uuid language sql as $f$ select 'b9b9b9b9-0000-4000-8000-000000000001'::uuid $f$;
-- número pseudoaleatório determinístico (0..2^31-1) a partir de uma semente textual
create function pg_temp.h(p_seed text) returns bigint language sql immutable as $f$ select ('x' || substr(md5(p_seed), 1, 7))::bit(28)::bigint $f$;
create function pg_temp.pick(p_seed text, p_opts text[]) returns text language sql immutable as $f$ select p_opts[1 + (pg_temp.h(p_seed) % array_length(p_opts, 1))] $f$;

-- Importa um conjunto de linhas pelo caminho oficial (lotes de 1.000) e publica; devolve o dataset.
create function pg_temp.load(p_name text, p_file text, p_cols jsonb, p_rows jsonb, p_hash text) returns uuid language plpgsql as $f$
declare r jsonb; n int := jsonb_array_length(p_rows); i int := 0;
begin
  r := public.bi_begin_import(pg_temp.org(), null, p_name, p_file, p_hash, 'csv', 'replace', 'reject_all', p_cols, '{}', n);
  while i < n loop
    perform public.bi_stage_rows(pg_temp.org(), (r ->> 'job_id')::uuid, (select jsonb_agg(x) from (select x from jsonb_array_elements(p_rows) with ordinality t(x, ord) where ord > i and ord <= i + 1000 order by ord) q));
    i := i + 1000;
  end loop;
  perform public.bi_finish_import(pg_temp.org(), (r ->> 'job_id')::uuid, n, 0);
  perform public.bi_publish_import(pg_temp.org(), (r ->> 'job_id')::uuid);
  return (r ->> 'dataset_id')::uuid;
end $f$;

create function pg_temp.dsid(p_name text) returns uuid language sql as $f$ select id from public.datasets where organization_id = pg_temp.org() and name = p_name $f$;
create function pg_temp.metric(p_ds text, p_name text, p_desc text, p_agg text, p_field text, p_format text, p_filters jsonb default '[]') returns uuid language plpgsql as $f$
begin return (public.bi_save_metric(pg_temp.org(), null, pg_temp.dsid(p_ds), p_name, p_desc, 'aggregation', p_agg, p_field, null, p_filters, p_format, null) ->> 'id')::uuid; end $f$;
create function pg_temp.formula(p_ds text, p_name text, p_desc text, p_ast jsonb, p_format text) returns uuid language plpgsql as $f$
begin return (public.bi_save_metric(pg_temp.org(), null, pg_temp.dsid(p_ds), p_name, p_desc, 'formula', null, null, p_ast, '[]', p_format, null) ->> 'id')::uuid; end $f$;
create function pg_temp.mid(p_ds text, p_name text) returns uuid language sql as $f$ select id from public.metric_definitions where dataset_id = pg_temp.dsid(p_ds) and name = p_name $f$;
create function pg_temp.ref(p_id uuid) returns jsonb language sql as $f$ select jsonb_build_object('op', 'ref', 'metric', p_id) $f$;

-- Widgets: consulta declarativa + a expressão de cada indicador «congelada» (o que o editor grava ao salvar).
create function pg_temp.layout(x int, y int, w int, h int) returns jsonb language sql as $f$ select jsonb_build_object('lg', jsonb_build_object('x', x, 'y', y, 'w', w, 'h', h)) $f$;
create function pg_temp.widget(p_type text, p_chart text, p_title text, p_ds text, p_measures jsonb, p_metrics jsonb, p_dims jsonb, p_period text, p_lay jsonb, p_limit int default 100, p_comparison boolean default false, p_filters jsonb default '[]', p_dimdisp jsonb default '[]') returns jsonb language sql as $f$
  select jsonb_build_object('widget_type', p_type, 'title', p_title, 'dataset_id', pg_temp.dsid(p_ds), 'layout_json', p_lay,
    'query_json', jsonb_strip_nulls(jsonb_build_object('measures', p_measures, 'dimensions', nullif(p_dims, '[]'::jsonb), 'filters', nullif(p_filters, '[]'::jsonb), 'period', case when p_period is null then null else jsonb_build_object('field', p_period) end,
      'limit', p_limit, 'order', case when jsonb_array_length(p_dims) = 0 then null when (p_dims -> 0 ? 'grain') then '[{"by":"d0","dir":"asc"}]'::jsonb else '[{"by":"m0","dir":"desc"}]'::jsonb end)),
    'display_json', jsonb_build_object('kind', 'chart', 'chart', p_chart, 'dims', p_dimdisp, 'metrics', p_metrics, 'datasetName', p_ds, 'limit', p_limit, 'periodField', p_period, 'filtersText', '[]'::jsonb) || case when p_comparison then '{"comparison":true}'::jsonb else '{}'::jsonb end,
    'metric_id', (p_metrics -> 0 ->> 'id')::uuid, 'metric_version', 1);
$f$;
create function pg_temp.md(p_ds text, p_name text, p_format text, p_expr jsonb, p_additive boolean) returns jsonb language sql as $f$
  select jsonb_build_object('id', pg_temp.mid(p_ds, p_name), 'name', p_name, 'format', p_format, 'unit', null, 'version', 1, 'description', null, 'additive', p_additive, 'expr', p_expr) $f$;

do $seed$
declare
  org uuid := 'b9b9b9b9-0000-4000-8000-000000000001';
  pw text := extensions.crypt('DemoLocal#2026', extensions.gen_salt('bf'));
  vc jsonb; vr jsonb; dc jsonb; dr jsonb; ac jsonb; ar jsonb; fc jsonb; fr jsonb;
  ds_v uuid; ds_d uuid; ds_a uuid; ds_f uuid; dash uuid; dash2 uuid; res jsonb;
  m_fat uuid; m_ped uuid; m_conc uuid; m_ticket uuid; m_taxa uuid; m_desp uuid; m_tick uuid; m_tempo uuid; m_atras uuid; g1 uuid;
  M_ADD jsonb := '{"op":"m","alias":"m0"}'; M_B jsonb := '{"op":"m","alias":"m1"}';
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  canais text[] := array['Loja física', 'Site próprio', 'Marketplace', 'Representantes'];
  vendedores text[] := array['Marina Costa', 'Rafael Prado', 'Juliana Freitas', 'Bernardo Lopes', 'Aline Moura', 'Gustavo Rocha', 'Patrícia Sena', 'Tiago Barros'];
  cats text[] := array['Alimentos', 'Bebidas', 'Limpeza', 'Higiene', 'Utilidades'];
begin
  if exists (select 1 from public.organizations where id = org) then return; end if; -- já semeado
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', v.id::uuid, 'authenticated', 'authenticated', v.email, pw, now(), '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', v.nome), now(), now(), '', '', '', ''
  from (values
    ('b9b9b9b9-0000-4000-8000-0000000000a1', 'dono@demo.exemplo', 'Helena Duarte'), ('b9b9b9b9-0000-4000-8000-0000000000a2', 'gestor@demo.exemplo', 'Rodrigo Albuquerque'),
    ('b9b9b9b9-0000-4000-8000-0000000000a3', 'analista@demo.exemplo', 'Camila Teixeira'), ('b9b9b9b9-0000-4000-8000-0000000000a4', 'consulta@demo.exemplo', 'Otávio Mendes'),
    ('b9b9b9b9-0000-4000-8000-0000000000a5', 'analista2@demo.exemplo', 'Priscila Nogueira')
  ) as v(id, email, nome);
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.email, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now() from auth.users u where u.email like '%@demo.exemplo';
  update public.profiles p set full_name = u.raw_user_meta_data ->> 'full_name' from auth.users u where u.id = p.id and u.email like '%@demo.exemplo';
  insert into public.organizations (id, name, slug) values (org, 'Horizonte Distribuidora (dados fictícios)', 'horizonte');
  insert into public.organization_settings (organization_id, display_name, theme) values (org, 'Horizonte Distribuidora', '{"primary":"#0e7490"}'::jsonb);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'b9b9b9b9-0000-4000-8000-0000000000a1', 'owner'), (org, 'b9b9b9b9-0000-4000-8000-0000000000a2', 'manager'), (org, 'b9b9b9b9-0000-4000-8000-0000000000a3', 'member'),
    (org, 'b9b9b9b9-0000-4000-8000-0000000000a4', 'viewer'), (org, 'b9b9b9b9-0000-4000-8000-0000000000a5', 'member');

  -- ===================================================================== datasets (importados pelo caminho oficial)
  perform pg_temp.as_analyst();
  vc := '[{"key":"c1","name":"Pedido","type":"string","semantic":"identifier","required":true,"dedupe":true,"position":0},{"key":"c2","name":"Data da venda","type":"date","semantic":"time","required":true,"position":1},
          {"key":"c3","name":"Canal","type":"string","semantic":"dimension","required":true,"position":2},{"key":"c4","name":"Vendedor","type":"string","semantic":"dimension","position":3},
          {"key":"c5","name":"Categoria","type":"string","semantic":"dimension","position":4},{"key":"c6","name":"Valor","type":"currency","semantic":"measure","position":5},
          {"key":"c7","name":"Quantidade","type":"integer","semantic":"measure","position":6},{"key":"c8","name":"Situação","type":"string","semantic":"dimension","position":7}]';
  select jsonb_agg(jsonb_build_object('n', i + 1, 'k', 'PED-' || lpad(i::text, 5, '0'), 'v', jsonb_build_object(
      'c1', 'PED-' || lpad(i::text, 5, '0'), 'c2', (today - ((pg_temp.h('d' || i) % 300))::int)::text, 'c3', pg_temp.pick('c' || i, canais), 'c4', pg_temp.pick('v' || i, vendedores), 'c5', pg_temp.pick('g' || i, cats),
      'c6', to_char(20 + (pg_temp.h('p' || i) % 90000) / 100.0, 'FM999990.00'), 'c7', (1 + pg_temp.h('q' || i) % 9)::text,
      'c8', case when pg_temp.h('s' || i) % 100 < 78 then 'Concluído' when pg_temp.h('s' || i) % 100 < 90 then 'Em andamento' else 'Cancelado' end))
    order by i) into vr from generate_series(1, 3600) i;
  ds_v := pg_temp.load('Vendas', 'vendas-demo.csv', vc, vr, repeat('1', 64));

  dc := '[{"key":"c1","name":"Lançamento","type":"string","semantic":"identifier","required":true,"dedupe":true,"position":0},{"key":"c2","name":"Data","type":"date","semantic":"time","required":true,"position":1},
          {"key":"c3","name":"Categoria","type":"string","semantic":"dimension","position":2},{"key":"c4","name":"Centro de custo","type":"string","semantic":"dimension","position":3},{"key":"c5","name":"Valor","type":"currency","semantic":"measure","position":4}]';
  select jsonb_agg(jsonb_build_object('n', i + 1, 'k', 'LAN-' || lpad(i::text, 4, '0'), 'v', jsonb_build_object(
      'c1', 'LAN-' || lpad(i::text, 4, '0'), 'c2', (today - ((pg_temp.h('dd' || i) % 300))::int)::text, 'c3', pg_temp.pick('dc' || i, array['Pessoal', 'Aluguel', 'Marketing', 'Logística', 'Tecnologia']),
      'c4', pg_temp.pick('cc' || i, array['Comercial', 'Operações', 'Administrativo']), 'c5', to_char(50 + (pg_temp.h('dv' || i) % 400000) / 100.0, 'FM999990.00'))) order by i) into dr from generate_series(1, 700) i;
  ds_d := pg_temp.load('Despesas', 'despesas-demo.csv', dc, dr, repeat('2', 64));

  ac := '[{"key":"c1","name":"Chamado","type":"string","semantic":"identifier","required":true,"dedupe":true,"position":0},{"key":"c2","name":"Aberto em","type":"date","semantic":"time","required":true,"position":1},
          {"key":"c3","name":"Categoria","type":"string","semantic":"dimension","position":2},{"key":"c4","name":"Responsável","type":"string","semantic":"dimension","position":3},{"key":"c5","name":"Situação","type":"string","semantic":"dimension","position":4},
          {"key":"c6","name":"Horas para resolver","type":"decimal","semantic":"measure","position":5},{"key":"c7","name":"Atrasado","type":"integer","semantic":"measure","position":6}]';
  select jsonb_agg(jsonb_build_object('n', i + 1, 'k', 'CH-' || lpad(i::text, 5, '0'), 'v', jsonb_strip_nulls(jsonb_build_object(
      'c1', 'CH-' || lpad(i::text, 5, '0'), 'c2', (today - ((pg_temp.h('ad' || i) % 200))::int)::text, 'c3', pg_temp.pick('ac' || i, array['Entrega', 'Cobrança', 'Produto', 'Cadastro']),
      'c4', pg_temp.pick('ar' || i, array['Larissa Gomes', 'Daniel Pires', 'Beatriz Cunha', 'Márcio Tavares']), 'c5', case when pg_temp.h('as' || i) % 100 < 85 then 'Concluído' else 'Aberto' end,
      'c6', case when pg_temp.h('as' || i) % 100 < 85 then to_char(1 + (pg_temp.h('ah' || i) % 9000) / 100.0, 'FM999990.00') else null end, 'c7', (case when pg_temp.h('al' || i) % 100 < 12 then 1 else 0 end)::text))) order by i) into ar from generate_series(1, 1500) i;
  ds_a := pg_temp.load('Atendimentos', 'atendimentos-demo.csv', ac, ar, repeat('3', 64));

  -- dataset restrito (só administradores e quem for autorizado)
  perform pg_temp.as_owner();
  ds_f := public.bi_create_dataset(org, 'Folha de pagamento (restrito)', 'Exemplo de dataset restrito: dashboards e consultas só entregam dados a quem tem autorização explícita.', true);
  fc := '[{"key":"c1","name":"Competência","type":"date","semantic":"time","required":true,"dedupe":true,"position":0},{"key":"c2","name":"Total da folha","type":"currency","semantic":"measure","position":1}]';
  fr := (select jsonb_agg(jsonb_build_object('n', i + 1, 'k', to_char(date_trunc('month', today) - (i || ' months')::interval, 'YYYY-MM-01'), 'v', jsonb_build_object('c1', to_char(date_trunc('month', today) - (i || ' months')::interval, 'YYYY-MM-01'), 'c2', to_char(81000 + (pg_temp.h('f' || i) % 600000) / 100.0, 'FM999990.00'))) order by i) from generate_series(1, 12) i);
  res := public.bi_begin_import(org, ds_f, null, 'folha-demo.csv', repeat('4', 64), 'csv', 'replace', 'reject_all', fc, '{}', 12);
  perform public.bi_stage_rows(org, (res ->> 'job_id')::uuid, fr);
  perform public.bi_finish_import(org, (res ->> 'job_id')::uuid, 12, 0);
  perform public.bi_publish_import(org, (res ->> 'job_id')::uuid);

  -- ===================================================================== indicadores
  perform pg_temp.as_analyst();
  m_fat := pg_temp.metric('Vendas', 'Faturamento', 'Soma do valor de todos os pedidos do período.', 'sum', 'c6', 'currency');
  m_ped := pg_temp.metric('Vendas', 'Pedidos', 'Quantidade de pedidos (linhas) no período.', 'count', null, 'integer');
  m_conc := pg_temp.metric('Vendas', 'Pedidos concluídos', 'Pedidos com situação «Concluído».', 'count', null, 'integer', '[{"field":"c8","op":"eq","value":"Concluído"}]');
  m_ticket := pg_temp.formula('Vendas', 'Ticket médio', 'Faturamento ÷ pedidos.', jsonb_build_object('op', 'div', 'l', pg_temp.ref(m_fat), 'r', pg_temp.ref(m_ped)), 'currency');
  m_taxa := pg_temp.formula('Vendas', 'Taxa de conclusão (%)', 'Pedidos concluídos ÷ pedidos × 100.', jsonb_build_object('op', 'mul', 'l', jsonb_build_object('op', 'div', 'l', pg_temp.ref(m_conc), 'r', pg_temp.ref(m_ped)), 'r', jsonb_build_object('op', 'num', 'value', '100')), 'percentage');
  perform pg_temp.metric('Vendas', 'Vendedores ativos', 'Vendedores distintos com pedidos.', 'count_distinct', 'c4', 'integer');
  m_desp := pg_temp.metric('Despesas', 'Total de despesas', 'Soma das despesas lançadas.', 'sum', 'c5', 'currency');
  m_tick := pg_temp.metric('Atendimentos', 'Chamados', 'Quantidade de chamados abertos no período.', 'count', null, 'integer');
  m_tempo := pg_temp.metric('Atendimentos', 'Tempo médio de resolução (h)', 'Média de horas dos chamados concluídos.', 'avg', 'c6', 'decimal');
  m_atras := pg_temp.metric('Atendimentos', 'Chamados atrasados', 'Soma da marca de atraso (1 = atrasado).', 'sum', 'c7', 'integer');

  -- ===================================================================== dashboards (gestor)
  perform pg_temp.as_manager();
  dash := public.bi_create_dashboard(org, 'Comercial', 'Faturamento, pedidos e ticket médio, por canal, vendedor e mês.', 'comercial');
  res := public.bi_save_dashboard(org, dash, 1, 'Comercial', 'Faturamento, pedidos e ticket médio, por canal, vendedor e mês.', 'last_30', 'previous_period', 'same_days', jsonb_build_array(
    pg_temp.widget('comparison', 'kpi', 'Faturamento', 'Vendas', '[{"alias":"m0","agg":"sum","field":"c6"}]', jsonb_build_array(pg_temp.md('Vendas', 'Faturamento', 'currency', M_ADD, true)), '[]', 'c2', pg_temp.layout(0, 0, 3, 3), 1, true),
    pg_temp.widget('comparison', 'kpi', 'Pedidos', 'Vendas', '[{"alias":"m0","agg":"count"}]', jsonb_build_array(pg_temp.md('Vendas', 'Pedidos', 'integer', M_ADD, true)), '[]', 'c2', pg_temp.layout(3, 0, 3, 3), 1, true),
    pg_temp.widget('comparison', 'kpi', 'Ticket médio', 'Vendas', '[{"alias":"m0","agg":"sum","field":"c6"},{"alias":"m1","agg":"count"}]', jsonb_build_array(pg_temp.md('Vendas', 'Ticket médio', 'currency', jsonb_build_object('op', 'div', 'l', M_ADD, 'r', M_B), false)), '[]', 'c2', pg_temp.layout(6, 0, 3, 3), 1, true),
    pg_temp.widget('comparison', 'kpi', 'Taxa de conclusão', 'Vendas', '[{"alias":"m0","agg":"count","filters":[{"field":"c8","op":"eq","value":"Concluído"}]},{"alias":"m1","agg":"count"}]',
      jsonb_build_array(pg_temp.md('Vendas', 'Taxa de conclusão (%)', 'percentage', jsonb_build_object('op', 'mul', 'l', jsonb_build_object('op', 'div', 'l', M_ADD, 'r', M_B), 'r', jsonb_build_object('op', 'num', 'value', '100')), false)), '[]', 'c2', pg_temp.layout(9, 0, 3, 3), 1, true),
    pg_temp.widget('chart', 'line', 'Faturamento por mês', 'Vendas', '[{"alias":"m0","agg":"sum","field":"c6"}]', jsonb_build_array(pg_temp.md('Vendas', 'Faturamento', 'currency', M_ADD, true)), '[{"field":"c2","grain":"month"}]', 'c2', pg_temp.layout(0, 3, 8, 5), 400, false, '[]', '[{"field":"c2","name":"Data da venda","type":"date","grain":"month"}]'),
    pg_temp.widget('chart', 'donut', 'Faturamento por canal', 'Vendas', '[{"alias":"m0","agg":"sum","field":"c6"}]', jsonb_build_array(pg_temp.md('Vendas', 'Faturamento', 'currency', M_ADD, true)), '[{"field":"c3"}]', 'c2', pg_temp.layout(8, 3, 4, 5), 7, false, '[]', '[{"field":"c3","name":"Canal","type":"string"}]'),
    pg_temp.widget('chart', 'bar', 'Faturamento por vendedor', 'Vendas', '[{"alias":"m0","agg":"sum","field":"c6"}]', jsonb_build_array(pg_temp.md('Vendas', 'Faturamento', 'currency', M_ADD, true)), '[{"field":"c4"}]', 'c2', pg_temp.layout(0, 8, 12, 5), 30, false, '[]', '[{"field":"c4","name":"Vendedor","type":"string"}]'),
    jsonb_build_object('widget_type', 'freshness', 'title', 'Atualização dos dados', 'display_json', '{"kind":"freshness"}'::jsonb, 'layout_json', pg_temp.layout(0, 13, 6, 3)),
    jsonb_build_object('widget_type', 'alert', 'title', 'Avisos', 'display_json', '{"kind":"alert"}'::jsonb, 'layout_json', pg_temp.layout(6, 13, 6, 3))
  ), jsonb_build_array(jsonb_build_object('dataset_id', ds_v, 'field_key', 'c3', 'label', 'Canal', 'operator', 'eq'), jsonb_build_object('dataset_id', ds_v, 'field_key', 'c5', 'label', 'Categoria', 'operator', 'in')));
  perform public.bi_publish_dashboard(org, dash, 'organization');
  perform public.bi_set_favorite(org, dash, true);

  dash2 := public.bi_create_dashboard(org, 'Operações e despesas', 'Chamados de atendimento e despesas por categoria.', 'operacoes');
  res := public.bi_save_dashboard(org, dash2, 1, 'Operações e despesas', 'Chamados de atendimento e despesas por categoria.', 'last_30', 'previous_period', 'same_days', jsonb_build_array(
    pg_temp.widget('comparison', 'kpi', 'Chamados', 'Atendimentos', '[{"alias":"m0","agg":"count"}]', jsonb_build_array(pg_temp.md('Atendimentos', 'Chamados', 'integer', M_ADD, true)), '[]', 'c2', pg_temp.layout(0, 0, 4, 3), 1, true),
    pg_temp.widget('comparison', 'kpi', 'Tempo médio de resolução', 'Atendimentos', '[{"alias":"m0","agg":"avg","field":"c6"}]', jsonb_build_array(pg_temp.md('Atendimentos', 'Tempo médio de resolução (h)', 'decimal', M_ADD, false)), '[]', 'c2', pg_temp.layout(4, 0, 4, 3), 1, true),
    pg_temp.widget('comparison', 'kpi', 'Total de despesas', 'Despesas', '[{"alias":"m0","agg":"sum","field":"c5"}]', jsonb_build_array(pg_temp.md('Despesas', 'Total de despesas', 'currency', M_ADD, true)), '[]', 'c2', pg_temp.layout(8, 0, 4, 3), 1, true),
    pg_temp.widget('chart', 'bar', 'Despesas por categoria', 'Despesas', '[{"alias":"m0","agg":"sum","field":"c5"}]', jsonb_build_array(pg_temp.md('Despesas', 'Total de despesas', 'currency', M_ADD, true)), '[{"field":"c3"}]', 'c2', pg_temp.layout(0, 3, 6, 5), 30, false, '[]', '[{"field":"c3","name":"Categoria","type":"string"}]'),
    pg_temp.widget('chart', 'area', 'Chamados por mês', 'Atendimentos', '[{"alias":"m0","agg":"count"}]', jsonb_build_array(pg_temp.md('Atendimentos', 'Chamados', 'integer', M_ADD, true)), '[{"field":"c2","grain":"month"}]', 'c2', pg_temp.layout(6, 3, 6, 5), 400, false, '[]', '[{"field":"c2","name":"Aberto em","type":"date","grain":"month"}]')
  ), '[]');
  -- rascunho privado compartilhado com a analista 2 (edição) para demonstrar compartilhamento e controle de concorrência
  perform public.bi_share_dashboard(org, dash2, 'b9b9b9b9-0000-4000-8000-0000000000a5', 'edit');

  -- ===================================================================== metas
  g1 := public.bi_save_goal(org, null, m_fat, 'Faturamento do mês', 'min', 'month', 150000, null, 80, 'previous_month', '[]', 'b9b9b9b9-0000-4000-8000-0000000000a2');
  perform public.bi_save_goal(org, null, m_desp, 'Despesas do mês (teto)', 'max', 'month', 90000, null, 80, 'previous_month', '[]', 'b9b9b9b9-0000-4000-8000-0000000000a2');
  perform public.bi_save_goal(org, null, m_tick, 'Crescimento de chamados (máx. 10%)', 'growth', 'month', 10, null, 80, 'previous_month', '[]', null);

  -- ===================================================================== visão salva e gráfico da biblioteca (analista)
  perform pg_temp.as_analyst();
  perform public.bi_save_view(org, null, ds_v, 'Pedidos acima de R$ 500', '[{"field":"c6","op":"gt","value":"500"}]', '["c1","c2","c3","c6"]', '[{"field":"c6","dir":"desc"}]');
  perform public.bi_save_dimension(org, null, ds_v, 'Canal de venda', 'c3', 'category');
  perform public.bi_save_dimension(org, null, ds_v, 'Mês da venda', 'c2', 'time');

  -- dataset de despesas «desatualizado» (a demonstração dos avisos de atualização): publicado há 12 dias
  update public.dataset_versions set published_at = now() - interval '12 days' where dataset_id = ds_d and status = 'published';
  update public.datasets set source_type = 'demo' where organization_id = org;
  perform set_config('request.jwt.claims', '', true);
end
$seed$;
