import { z } from 'zod';

import { formFieldsSchema } from '@/modules/leads/form-fields';

import { CUSTOM_ENTITIES, CUSTOM_FIELD_TYPES } from '@/modules/custom-fields/validation';

const name = (max: number) => z.string().trim().min(1, 'Enter a name').max(max);
const optionalUuid = z
  .union([z.literal(''), z.uuid()])
  .optional()
  .transform((value) => value || null);
const optionalLeadType = z
  .union([z.literal(''), z.enum(['b2b', 'b2c'])])
  .optional()
  .transform((value) => value || null);

export const subSourceSchema = z.object({ sourceId: z.uuid(), name: name(80) });
export const renameSchema = z.object({ id: z.uuid(), name: name(80) });
export const toggleSchema = z.object({ id: z.uuid(), isActive: z.boolean() });
export const moveSchema = z.object({ id: z.uuid(), direction: z.enum(['up', 'down']) });

export const STATUS_COLORS = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'info',
  'positive',
  'destructive',
  'primary',
] as const;

export const leadStatusSchema = z.object({
  id: z.uuid().optional(),
  name: name(60),
  /** New statuses are working or closing ones; system statuses keep their kind. */
  kind: z.enum(['working', 'closed']).optional(),
  leadType: optionalLeadType,
  requiresReason: z.boolean().default(false),
  color: z.enum(STATUS_COLORS).default('chart-3'),
});

export const leadReasonSchema = z.object({
  kind: z.enum(['disqualify', 'reject']),
  name: name(80),
});

const textList = z
  .array(z.string().trim().min(1).max(80))
  .max(50)
  .transform((values) => [...new Set(values)]);

export const routingRuleSchema = z
  .object({
    id: z.uuid().optional(),
    name: name(80),
    stage: z.enum(['intake', 'handover']),
    leadType: optionalLeadType,
    method: z.enum(['round_robin', 'least_loaded']),
    userIds: z.array(z.uuid()).max(100).default([]),
    teamId: optionalUuid,
    conditions: z
      .object({
        sourceIds: z.array(z.uuid()).max(50).default([]),
        subSourceIds: z.array(z.uuid()).max(100).default([]),
        countries: textList.default([]),
        regions: textList.default([]),
        industries: textList.default([]),
        companySizes: textList.default([]),
        languages: textList.default([]),
        interests: textList.default([]),
      })
      .default({
        sourceIds: [],
        subSourceIds: [],
        countries: [],
        regions: [],
        industries: [],
        companySizes: [],
        languages: [],
        interests: [],
      }),
    isActive: z.boolean().default(true),
  })
  .refine((rule) => rule.userIds.length > 0 || rule.teamId, {
    message: 'Choose who it shares leads between',
    path: ['userIds'],
  });

export const pipelineSchema = z.object({
  id: z.uuid().optional(),
  name: name(60),
  /** Chosen when the pipeline is added; never changed afterwards. */
  objectType: z.enum(['opportunity', 'opportunity_item']).default('opportunity'),
  leadType: optionalLeadType,
  /** Opportunity pipelines: the item pipeline their items use. Empty means the default one;
   * left out means unchanged. */
  itemPipelineId: z
    .union([z.literal(''), z.uuid()])
    .optional()
    .transform((value) => (value === undefined ? undefined : value || null)),
  description: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((value) => value || null),
});

export const stageRulesSchema = z
  .object({
    id: z.uuid(),
    ownerUserId: optionalUuid,
    ownerTeamId: optionalUuid,
    onEnter: z.enum(['notify', 'reassign', 'task']),
    requiredFields: z
      .array(z.string().regex(/^(custom:[a-z][a-z0-9_]{0,39}|[a-zA-Z]+)$/))
      .max(30)
      .default([]),
    checklist: z
      .array(z.object({ id: z.string().min(1).max(40), label: z.string().trim().min(1).max(120) }))
      .max(20)
      .default([]),
    requiresApproval: z.boolean().default(false),
  })
  .refine((rules) => !(rules.ownerUserId && rules.ownerTeamId), {
    message: 'Choose a person or a team, not both',
    path: ['ownerTeamId'],
  });

export const addPipelineStageSchema = z.object({ pipelineId: z.uuid(), name: name(40) });

export const itemStageAdvanceSchema = z.object({
  id: z.uuid(),
  advancesParentToStageId: optionalUuid,
});
export type ItemStageAdvanceInput = z.infer<typeof itemStageAdvanceSchema>;

export const customFieldSchema = z.object({
  id: z.uuid().optional(),
  entityType: z.enum(CUSTOM_ENTITIES),
  label: name(60),
  description: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => value || null),
  fieldType: z.enum(CUSTOM_FIELD_TYPES),
  choices: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  isRequired: z.boolean().default(false),
  showInList: z.boolean().default(false),
});

export const emailTemplateSchema = z.object({
  id: z.uuid().optional(),
  name: name(80),
  subject: z.string().trim().min(1, 'Enter a subject').max(200),
  body: z.string().trim().min(1, 'Write the message').max(20000),
});

export const SEQUENCE_STEP_TYPES = ['email', 'call', 'meeting', 'follow_up', 'other'] as const;

export const sequenceSchema = z.object({
  id: z.uuid().optional(),
  name: name(80),
  description: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((value) => value || null),
  steps: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        day: z.coerce.number().int().min(0).max(365),
        type: z.enum(SEQUENCE_STEP_TYPES),
        title: z.string().trim().min(1, 'Describe the step').max(160),
        templateId: optionalUuid,
      }),
    )
    .min(1, 'Add at least one step')
    .max(30),
});

export const webFormSchema = z.object({
  id: z.uuid().optional(),
  name: name(80),
  sourceId: z.uuid('Choose a source'),
  subSourceId: optionalUuid,
  leadType: z.enum(['b2b', 'b2c']),
  /** Shown above the form; falls back to the form's name. */
  heading: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => value || null),
  intro: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((value) => value || null),
  submitLabel: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((value) => value || null),
  thankYouMessage: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((value) => value || null),
  fields: formFieldsSchema,
});

export const publishWebFormSchema = z.object({ id: z.uuid(), publish: z.boolean() });

export const roleSchema = z.object({
  id: z.uuid().optional(),
  name: name(60),
  description: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((value) => value || null),
  /** permission key → 'own' | 'team' | 'all' for record permissions, 'true' for the rest. */
  grants: z.record(z.string(), z.enum(['own', 'team', 'all', 'true'])),
});

export type RoutingRuleInput = z.output<typeof routingRuleSchema>;
export type StageRulesInput = z.output<typeof stageRulesSchema>;
export type CustomFieldInput = z.output<typeof customFieldSchema>;
export type SequenceInput = z.output<typeof sequenceSchema>;
export type WebFormInput = z.output<typeof webFormSchema>;
export type RoleInput = z.output<typeof roleSchema>;
