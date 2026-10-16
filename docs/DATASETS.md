# DATASETS

Um dataset é um conjunto estruturado de dados importados (vendas, despesas, atendimentos…). Tem **versões**: a ativa é a única consultada; as anteriores ficam como histórico (linhas guardadas conforme a retenção; metadados sempre).

- **Modos de atualização:** *substituição integral* (nova versão com o esquema do novo arquivo; impacto sobre indicadores/gráficos é listado e exige confirmação) e *acréscimo* (esquema da versão ativa + chave de deduplicação obrigatória; chaves já existentes são ignoradas e contadas, e **não** sobrescrevem).
- **Esquema:** colunas com chave interna, nome de exibição, tipo, papel, obrigatória, formato numérico e descrição. Renomear/descrever/mudar papel é permitido sem nova carga; tipo e chave mudam só por nova importação.
- **Qualidade:** linhas, vazios por coluna, rejeitadas e ignoradas na última carga, data da última atualização, indicadores inválidos.
- **Arquivar:** o dataset não recebe importações e dashboards que o usam deixam de responder; restaurar volta ao normal. Nada é apagado.
- **Restrito:** só administradores e pessoas autorizadas (ver PERMISSIONS.md).
- **Demonstração:** os datasets do seed têm `source_type = demo` e aparecem marcados; dados de demonstração nunca se misturam com produção sem aviso.
