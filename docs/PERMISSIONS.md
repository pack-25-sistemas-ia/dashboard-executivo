# PERMISSIONS — perfis e acesso

Papéis do Core → perfis de BI: **owner/admin = Administrador**, **manager = Gestor**, **member = Analista**, **viewer = Visualizador**. A interface só decide o que mostrar; **o banco autoriza** (RLS de leitura + funções `bi_*` que começam por `private.bi_guard`: sessão, MFA e papel).

| Ação | Admin | Gestor | Analista | Visualizador |
|---|:-:|:-:|:-:|:-:|
| Ver dashboards publicados para a empresa ou compartilhados | ✔ | ✔ | ✔ | ✔ (só pelos widgets) |
| Consulta livre/explorador, ver linhas do dataset | ✔ | ✔ | ✔ | ✘ |
| Criar/editar datasets, importar, criar indicadores, gráficos, dimensões, dashboards | ✔ | ✔ | ✔ | ✘ |
| Publicar/despublicar dashboards | ✔ | ✔ | ✘ | ✘ |
| Criar metas, exportar linhas brutas de dataset | ✔ | ✔ | ✘ | ✘ |
| Arquivar dataset | ✔ | ✔ | ✘ | ✘ |
| Criar/alterar dataset restrito e conceder acesso a ele; configurações do BI | ✔ | ✘ | ✘ | ✘ |
| Exportar o CSV do que o dashboard mostra | ✔ | ✔ | ✔ | ✔ (mesmos dados da tela) |

## Dashboard
Nível por dashboard: **admin** (administrador da empresa, criador, ou concedido), **edit**, **view**. Rascunho é privado (criador, concedidos, administrador). Publicado com visibilidade «empresa» vale a todos os membros. Compartilhar exige nível admin do dashboard; visualizador só recebe «visualização». Revogar vale na consulta seguinte.

## Dataset restrito
Só administrador e quem foi autorizado (`dataset_access`) enxergam metadados, consultam ou usam em widgets. Dashboard com dataset restrito **não** pode ser publicado para a empresa toda e só é compartilhado com quem tem o acesso.

## Privilégios e MFA
Nenhum `INSERT/UPDATE/DELETE` direto para usuários em tabela alguma; `dataset_rows` não tem `SELECT`. Administradores precisam de AAL2 também no banco (políticas restritivas e `bi_guard`). Teste de higiene em SQL 93 (privilégios, `SECURITY DEFINER` com `search_path`, ausência de `PUBLIC`/`anon`).

## Privacidade (LGPD)
Dados de negócio podem conter dados pessoais: minimização (o arquivo original não é guardado; auditoria só guarda contagens/ids/nomes de colunas; avisos não carregam valores). Lista de pessoas para compartilhar (`bi_members`) devolve só id, papel e nome/parte local do e-mail a analista+.
