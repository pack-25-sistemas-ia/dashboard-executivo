import { z } from 'zod';

export const PRIVACY_TYPES = [
  'confirmation',
  'access',
  'correction',
  'anonymization_or_deletion',
  'portability',
  'sharing_info',
  'consent_revocation',
] as const;

export const PRIVACY_STATUSES = ['open', 'in_progress', 'answered', 'rejected'] as const;

export const PRIVACY_TYPE_LABELS: Record<(typeof PRIVACY_TYPES)[number], string> = {
  confirmation: 'Confirmação de tratamento',
  access: 'Acesso aos dados',
  correction: 'Correção de dados',
  anonymization_or_deletion: 'Anonimização ou eliminação',
  portability: 'Portabilidade',
  sharing_info: 'Informação sobre compartilhamento',
  consent_revocation: 'Revogação de consentimento',
};

export const PRIVACY_STATUS_LABELS: Record<(typeof PRIVACY_STATUSES)[number], string> = {
  open: 'Aberta',
  in_progress: 'Em andamento',
  answered: 'Respondida',
  rejected: 'Recusada',
};

export const createPrivacyRequestSchema = z.object({
  request_type: z.enum(PRIVACY_TYPES, 'Tipo inválido.'),
  subject_reference: z.string().trim().min(1, 'Informe a referência do titular.').max(200, 'Referência muito longa.'),
  notes: z.string().trim().max(2000, 'Máximo de 2000 caracteres.').optional().transform((v) => (v ? v : undefined)),
});

export const updatePrivacyStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(PRIVACY_STATUSES, 'Status inválido.'),
});
