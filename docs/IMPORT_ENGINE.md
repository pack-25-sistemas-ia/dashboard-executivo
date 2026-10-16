# IMPORT_ENGINE — importação em etapas

## Fluxo
1. **Ler** (servidor, `previewFile`): formato pelo **conteúdo** (`PK` = xlsx; OLE2/PDF/binário recusados; `.xlsm/.xls` recusados), tamanho ≤ 20 MB, ≤ 50.000 linhas, ≤ 100 colunas, célula ≤ 2.000 caracteres. Sugere tipo por coluna (booleano, inteiro, data, data e hora, percentual, moeda, decimal, texto; zeros à esquerda ficam texto; «1.234» ambíguo gera aviso).
2. **Mapear** (cliente): nome, tipo, papel (dimensão/medida/tempo/identificador/ignorar), obrigatória, formato numérico (BR/EN), chave de deduplicação, política para linhas inválidas.
3. **Validar** (`runImport`): o servidor tipa cada célula (`parseCell`), aponta erros por linha/coluna, detecta chave repetida no arquivo e chama `bi_begin_import` → `bi_stage_rows` (lotes de 1.000) → `bi_finish_import`. O **banco revalida** cada valor (`bi_value_ok`) e as colunas. Nada fica visível.
4. **Publicar** (`bi_publish_import`): trava o dataset, confere política de erros, limites e impacto, aplica substituição ou acréscimo, calcula estatísticas, troca a versão ativa **na mesma transação**, revalida indicadores, aplica a retenção, audita e avisa.
5. **Cancelar/falhar** (`bi_fail_import`): remove as linhas de staging e registra a falha; a versão ativa nunca muda. Importações abandonadas (> 30 min) são limpas na próxima tentativa.

## Segurança do arquivo
Fórmulas XLSX nunca são avaliadas (só o valor em cache), macros recusadas, *zip bomb* barrada pelo diretório central **antes** de descompactar, entidades XML inválidas descartadas, controles removidos do texto. O arquivo original **não é guardado** (só hash, nome, contagens e mapeamento).

## Tipos e formatos
| Tipo | Entrada aceita | Guardado |
|---|---|---|
| Inteiro/Decimal/Moeda/Percentual | `1.234,56`, `R$ 10,00`, `(1.000,00)`, `12,5%`, `1,234.56` (EN, por coluna) | texto canônico `-1234.56` (≤ 6 casas, ≤ 15 dígitos) |
| Data | `DD/MM/AAAA`, `DD-MM-AAAA`, `DD.MM.AAAA`, `AAAA-MM-DD`, série do Excel | `AAAA-MM-DD` (ano de 2 dígitos é recusado) |
| Data e hora | `DD/MM/AAAA HH:MM[:SS]`, ISO | ISO com deslocamento, interpretado no fuso da empresa |
| Booleano | sim/não, verdadeiro/falso, 1/0 | JSON booleano |

## Limites (metas de engenharia, configuráveis até estes tetos)
50.000 linhas · 100 colunas · 20 MB · lotes de 1.000 · 1.000 erros registrados por importação.
