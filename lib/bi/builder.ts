import type { ChartType, Filter, Grain } from './engine';

/** Configuração do construtor de gráficos (guardada no widget para poder reabrir e editar). Só ids e chaves internas — nunca SQL. */
export type ChartBuilder = {
  dataset_id: string;
  chart: ChartType;
  metric_ids: string[];
  dims: Array<{ field: string; grain?: Grain }>;
  filters: Filter[];
  period_field: string | null;
  title: string;
};
