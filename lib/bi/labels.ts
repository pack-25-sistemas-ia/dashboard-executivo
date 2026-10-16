// Rótulos em português e permissões de tela (o banco autoriza de verdade; aqui só decidimos o que mostrar).
import type { OrgRole } from '@/lib/validation/org';

export type Perms = { read: boolean; analyst: boolean; manager: boolean; admin: boolean };
export function can(role: OrgRole): Perms {
  return {
    read: true,
    analyst: role === 'owner' || role === 'admin' || role === 'manager' || role === 'member',
    manager: role === 'owner' || role === 'admin' || role === 'manager',
    admin: role === 'owner' || role === 'admin',
  };
}
export const BI_ROLE_LABELS: Record<OrgRole, string> = { owner: 'Administrador', admin: 'Administrador', manager: 'Gestor', member: 'Analista', viewer: 'Visualizador' };

export const DATASET_STATUS_LABELS: Record<string, string> = { active: 'Ativo', archived: 'Arquivado' };
export const VERSION_STATUS_LABELS: Record<string, string> = { staging: 'Em preparo', published: 'Ativa', superseded: 'Substituída', failed: 'Falhou' };
export const IMPORT_STATUS_LABELS: Record<string, string> = { processing: 'Em andamento', ready: 'Pronta para publicar', published: 'Publicada', failed: 'Falhou', cancelled: 'Cancelada' };
export const IMPORT_MODE_LABELS: Record<string, string> = { replace: 'Substituição integral', append: 'Inclusão de novos registros' };
export const DASH_STATUS_LABELS: Record<string, string> = { draft: 'Rascunho', published: 'Publicado', archived: 'Arquivado' };
export const VISIBILITY_LABELS: Record<string, string> = { private: 'Privado (só quem recebeu acesso)', organization: 'Toda a empresa' };
export const PERMISSION_LABELS: Record<string, string> = { view: 'Visualização', edit: 'Edição', admin: 'Administração' };
export const METRIC_STATUS_LABELS: Record<string, string> = { active: 'Ativo', invalid: 'Inválido', archived: 'Arquivado' };
export const SEMANTIC_LABELS: Record<string, string> = { dimension: 'Dimensão (categoria)', measure: 'Medida (valor)', time: 'Tempo', identifier: 'Identificador', ignore: 'Ignorar coluna' };

export const NOTIFICATION_TYPES: Record<string, string> = {
  import_done: 'Importação concluída', import_failed: 'Importação com erro', metric_invalid: 'Indicador inválido', dashboard_shared: 'Dashboard compartilhado',
  permission_revoked: 'Permissão revogada', goal_achieved: 'Meta atingida', goal_below: 'Meta abaixo do esperado', dataset_stale: 'Dataset desatualizado',
};
