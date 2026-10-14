'use server';

import { z } from 'zod';

import { tenantLabelsSchema } from '@/lib/tenant/labels';
import { crmSettingsSchema } from '@/modules/leads/settings';
import { updateCrmSettings, updateLabels } from '@/modules/settings/workspace';
import { resolveLabels } from '@/lib/tenant/labels';
import { authedAction } from '@/server/action';

import {
  addPipelineStageSchema,
  customFieldSchema,
  emailTemplateSchema,
  leadReasonSchema,
  leadStatusSchema,
  moveSchema,
  pipelineSchema,
  renameSchema,
  roleSchema,
  routingRuleSchema,
  sequenceSchema,
  stageRulesSchema,
  subSourceSchema,
  toggleSchema,
  webFormSchema,
} from './schemas';
import * as config from './service';
import { addStage } from '@/modules/settings/service';

const SETTINGS = ['/settings', '/leads', '/contacts', '/pipeline', '/opportunities'];
const idSchema = z.object({ id: z.uuid() });
const manage = 'settings.manage' as const;

export const saveCrmSettingsAction = authedAction(
  { permission: manage, input: crmSettingsSchema, revalidate: ['/'] },
  (ctx, input) => updateCrmSettings(ctx, input),
);
export const saveLabelsAction = authedAction(
  { permission: manage, input: tenantLabelsSchema, revalidate: ['/'] },
  (ctx, input) => updateLabels(ctx, resolveLabels(input)),
);

export const renameSourceAction = authedAction(
  { permission: manage, input: renameSchema, revalidate: SETTINGS },
  (ctx, input) => config.renameSource(ctx, input),
);
export const addSubSourceAction = authedAction(
  { permission: manage, input: subSourceSchema, revalidate: SETTINGS },
  (ctx, input) => config.addSubSource(ctx, input),
);
export const renameSubSourceAction = authedAction(
  { permission: manage, input: renameSchema, revalidate: SETTINGS },
  (ctx, input) => config.renameSubSource(ctx, input),
);
export const toggleSubSourceAction = authedAction(
  { permission: manage, input: toggleSchema, revalidate: SETTINGS },
  (ctx, input) => config.toggleSubSource(ctx, input),
);

export const saveLeadStatusAction = authedAction(
  { permission: manage, input: leadStatusSchema, revalidate: SETTINGS },
  (ctx, input) => config.saveLeadStatus(ctx, input),
);
export const toggleLeadStatusAction = authedAction(
  { permission: manage, input: toggleSchema, revalidate: SETTINGS },
  (ctx, input) => config.toggleLeadStatus(ctx, input),
);
export const moveLeadStatusAction = authedAction(
  { permission: manage, input: moveSchema, revalidate: SETTINGS },
  (ctx, input) => config.moveLeadStatus(ctx, input),
);
export const addLeadReasonAction = authedAction(
  { permission: manage, input: leadReasonSchema, revalidate: SETTINGS },
  (ctx, input) => config.addLeadReason(ctx, input),
);
export const toggleLeadReasonAction = authedAction(
  { permission: manage, input: toggleSchema, revalidate: SETTINGS },
  (ctx, input) => config.toggleLeadReason(ctx, input),
);

export const saveRoutingRuleAction = authedAction(
  { permission: manage, input: routingRuleSchema, revalidate: SETTINGS },
  (ctx, input) => config.saveRoutingRule(ctx, input),
);
export const deleteRoutingRuleAction = authedAction(
  { permission: manage, input: idSchema, revalidate: SETTINGS },
  (ctx, input) => config.deleteRoutingRule(ctx, input.id),
);
export const moveRoutingRuleAction = authedAction(
  { permission: manage, input: moveSchema, revalidate: SETTINGS },
  (ctx, input) => config.moveRoutingRule(ctx, input),
);

export const savePipelineAction = authedAction(
  { permission: manage, input: pipelineSchema, revalidate: SETTINGS },
  (ctx, input) => config.savePipeline(ctx, input),
);
export const makeDefaultPipelineAction = authedAction(
  { permission: manage, input: idSchema, revalidate: SETTINGS },
  (ctx, input) => config.makeDefaultPipeline(ctx, input.id),
);
export const togglePipelineAction = authedAction(
  { permission: manage, input: toggleSchema, revalidate: SETTINGS },
  (ctx, input) => config.togglePipeline(ctx, input),
);
export const addPipelineStageAction = authedAction(
  { permission: manage, input: addPipelineStageSchema, revalidate: SETTINGS },
  (ctx, input) => addStage(ctx, input.name, input.pipelineId),
);
export const saveStageRulesAction = authedAction(
  { permission: manage, input: stageRulesSchema, revalidate: SETTINGS },
  (ctx, input) => config.saveStageRules(ctx, input),
);

export const saveCustomFieldAction = authedAction(
  { permission: manage, input: customFieldSchema, revalidate: SETTINGS },
  (ctx, input) => config.saveCustomField(ctx, input),
);
export const toggleCustomFieldAction = authedAction(
  { permission: manage, input: toggleSchema, revalidate: SETTINGS },
  (ctx, input) => config.toggleCustomField(ctx, input),
);

export const saveEmailTemplateAction = authedAction(
  { permission: manage, input: emailTemplateSchema, revalidate: SETTINGS },
  (ctx, input) => config.saveEmailTemplate(ctx, input),
);
export const toggleEmailTemplateAction = authedAction(
  { permission: manage, input: toggleSchema, revalidate: SETTINGS },
  (ctx, input) => config.toggleEmailTemplate(ctx, input),
);
export const saveSequenceAction = authedAction(
  { permission: manage, input: sequenceSchema, revalidate: SETTINGS },
  (ctx, input) => config.saveSequence(ctx, input),
);
export const toggleSequenceAction = authedAction(
  { permission: manage, input: toggleSchema, revalidate: SETTINGS },
  (ctx, input) => config.toggleSequence(ctx, input),
);

export const saveWebFormAction = authedAction(
  { permission: manage, input: webFormSchema, revalidate: SETTINGS },
  (ctx, input) => config.saveWebForm(ctx, input),
);
export const toggleWebFormAction = authedAction(
  { permission: manage, input: toggleSchema, revalidate: SETTINGS },
  (ctx, input) => config.toggleWebForm(ctx, input),
);

export const saveRoleAction = authedAction(
  { permission: 'roles.manage', input: roleSchema, revalidate: ['/settings'] },
  (ctx, input) => config.saveRole(ctx, input),
);
export const deleteRoleAction = authedAction(
  { permission: 'roles.manage', input: idSchema, revalidate: ['/settings'] },
  (ctx, input) => config.deleteRole(ctx, input.id),
);
