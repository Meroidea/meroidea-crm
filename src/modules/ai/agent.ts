import 'server-only';

import { FunctionCallingConfigMode, type Content, type FunctionCall } from '@google/genai';

import { AppError } from '@/lib/errors';
import { zonedToday } from '@/lib/dates';
import { audit } from '@/server/audit';
import { aiService } from '@/server/ai';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';
import { consumeRateLimit } from '@/server/rate-limit';

import { sniffAttachmentType } from './attachments';
import type { AssistantRequest } from './schemas';
import { availableTools } from './tools';
import { DATA_RULE, type Attachment, type ToolContext } from './tools/shared';
import type { AssistantResponse, ToolName } from './types';

/** Model turns per request: a tool call, a correction or a question, and a last answer. */
const MAX_STEPS = 3;

/**
 * One key serves every business, and the free tier's quota is small, so each person and each
 * business gets a share of it: one busy workspace cannot use up everyone else's assistant.
 */
const PERSON_PER_HOUR = 30;
const BUSINESS_PER_DAY = 300;

async function enforceLimits(ctx: TenantContext): Promise<void> {
  const person = await consumeRateLimit({
    bucket: `ai:person:${ctx.tenantId}`,
    subject: ctx.userId,
    limit: PERSON_PER_HOUR,
    windowSeconds: 3600,
  });
  if (!person) {
    throw new AppError(
      'RATE_LIMITED',
      'You have used the assistant a lot this hour. Please try again later.',
    );
  }
  const business = await consumeRateLimit({
    bucket: 'ai:business',
    subject: ctx.tenantId,
    limit: BUSINESS_PER_DAY,
    windowSeconds: 86_400,
  });
  if (!business) {
    throw new AppError(
      'RATE_LIMITED',
      'Your business has reached today’s assistant limit. It resets tomorrow.',
    );
  }
}

async function readAttachment(file: File): Promise<Attachment> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = sniffAttachmentType(bytes, file.name);
  if (!mimeType) {
    throw new AppError(
      'VALIDATION',
      'Attach a PDF, an image (PNG, JPEG, WebP, HEIC) or a text file.',
      {
        file: ['That file type is not supported'],
      },
    );
  }
  // The name is shown back in the card; keep it short and free of paths.
  const name = (file.name.split(/[\\/]/).pop() ?? 'document').slice(0, 120) || 'document';
  return { name, mimeType, bytes };
}

function systemInstruction(
  ctx: TenantContext,
  input: AssistantRequest,
  tool: ToolContext,
  toolNames: string[],
): string {
  const contact = ctx.tenant.labels.contact;
  const opportunity = ctx.tenant.labels.opportunity;
  return [
    `You are the assistant inside Meroidea, the business workspace of ${ctx.tenant.name}. Today is ${tool.today} (timezone ${ctx.tenant.timezone}). Money is in ${ctx.tenant.currency}. The user’s role is ${ctx.roleName}.`,
    `In this workspace, contacts are called "${contact.plural}" and opportunities "${opportunity.plural}".`,
    toolNames.length > 0
      ? `You can use these tools: ${toolNames.join(', ')}. Use one when the user asks for what it does. Tools only prepare drafts and previews: nothing is saved, sent or published until the user approves it in the app. Never say you saved, sent, scheduled or published anything.`
      : 'This user has no assistant tools available, so answer questions only.',
    'If the user asks for something no tool covers or they lack access to, say so plainly.',
    'Act rather than ask whenever a sensible default exists. Resolve relative dates like "next week" from today; weeks start on Monday and end on Sunday. To build a roster without shift times, call generate_staff_roster without shiftRequirements: it repeats the previous week\u2019s shifts.',
    'Ask one short question only when something essential has no default (who an invoice is for, or its prices). If the user answers briefly (yes, ok, sure), carry on with the defaults instead of asking again.',
    input.context.contactId
      ? `The user is viewing a ${contact.singular.toLowerCase()} with id ${input.context.contactId}; "this person" or "them" means that one.`
      : '',
    input.context.opportunityId
      ? `The user is viewing an ${opportunity.singular.toLowerCase()} with id ${input.context.opportunityId}.`
      : '',
    tool.attachment
      ? `The user attached a file, "${tool.attachment.name}" (${tool.attachment.mimeType}). Use analyse_document to review it.`
      : '',
    'Reply in short, plain sentences without markdown tables.',
    DATA_RULE,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Runs one request: the reasoning model reads it, may call one of the tools this person is
 * allowed, and either a preview comes back or the model answers in words. When a tool needs
 * something (a choice between two contacts, a fix to a date), the model gets another step to
 * correct itself or ask the person. Every run is written to the audit log: which tool, which
 * model, ids and counts, never what was asked or answered (rules/security.md).
 */
export async function runAssistant(
  ctx: TenantContext,
  input: AssistantRequest,
): Promise<AssistantResponse> {
  requirePermission(ctx, 'ai.use');
  if (!aiService.isConfigured()) {
    throw new AppError(
      'INTERNAL',
      'The AI assistant is not set up yet. Ask the platform owner to add a Gemini API key.',
    );
  }
  await enforceLimits(ctx);

  const tool: ToolContext = {
    ctx,
    today: zonedToday(ctx.tenant.timezone),
    attachment: input.file ? await readAttachment(input.file) : null,
  };
  const tools = availableTools(tool);
  const byName = new Map(tools.map((definition) => [definition.name, definition]));

  const contents: Content[] = [
    ...input.history.map((message) => ({ role: message.role, parts: [{ text: message.text }] })),
    { role: 'user', parts: [{ text: input.prompt }] },
  ];
  const config = {
    systemInstruction: systemInstruction(ctx, input, tool, [...byName.keys()]),
    ...(tools.length > 0
      ? {
          tools: [
            {
              functionDeclarations: tools.map((definition) => ({
                name: definition.name,
                description: definition.description,
                parametersJsonSchema: definition.parameters,
              })),
            },
          ],
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        }
      : {}),
  };

  const response: AssistantResponse = { reply: '', actionTaken: null, artifact: null };
  const trail: { tool: string; outcome: string }[] = [];
  let auditDetails: Record<string, unknown> = {};
  let steps = 0;
  // The model that answered the first step answers the rest: a conversation with function calls
  // carries signatures only the model that wrote them accepts.
  let model: string | undefined;
  let fellBack = false;

  while (steps < MAX_STEPS) {
    steps += 1;
    // The last step must answer in words, so a request never ends in silence.
    const final = steps === MAX_STEPS && tools.length > 0;
    const answer = await aiService.generate(
      'reasoning',
      contents,
      final
        ? {
            ...config,
            toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } },
          }
        : config,
      // Choosing a tool and filling in its arguments needs little thinking, and thinking is what
      // made requests slow: Gemini 3 thinks at length unless told otherwise.
      { thinking: 'low', timeoutMs: 20_000, model },
    );
    model = answer.model;
    fellBack ||= answer.fellBack;
    const result = answer.response;
    const text = aiService.responseText(result);
    const calls: FunctionCall[] = result.functionCalls ?? [];
    if (calls.length === 0) {
      response.reply = text;
      break;
    }
    // The model's turn goes back exactly as it came, thought signatures included: Gemini needs
    // them to continue a conversation with function calls.
    const modelTurn = result.candidates?.[0]?.content;
    if (modelTurn) contents.push(modelTurn);

    // One action per request, so the person approves one thing at a time.
    const [call, ...rest] = calls;
    const definition = call?.name ? byName.get(call.name as ToolName) : undefined;
    let outcome: Record<string, unknown>;
    if (!call || !definition) {
      outcome = { ok: false, message: 'That tool is not available to this user.' };
      trail.push({ tool: call?.name?.slice(0, 40) ?? 'unknown', outcome: 'unavailable' });
    } else {
      const parsed = definition.args.safeParse(call.args ?? {});
      if (!parsed.success) {
        outcome = {
          ok: false,
          message: 'The arguments were not valid.',
          problems: parsed.error.issues
            .slice(0, 10)
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`),
        };
        trail.push({ tool: definition.name, outcome: 'invalid_arguments' });
      } else {
        try {
          const ran = await definition.run(parsed.data, tool);
          if (ran.kind === 'artifact') {
            trail.push({ tool: definition.name, outcome: 'preview' });
            response.actionTaken = definition.name;
            response.artifact = ran.artifact;
            response.reply = text || ran.reply;
            auditDetails = ran.audit;
            break;
          }
          outcome = ran.data;
          trail.push({ tool: definition.name, outcome: 'needs_input' });
        } catch (error) {
          // Problems with the request go back to the model to explain; anything else (the model
          // limit, an outage) ends the request with its own message.
          if (
            !(error instanceof AppError) ||
            !['NOT_FOUND', 'VALIDATION', 'CONFLICT', 'FORBIDDEN'].includes(error.code)
          ) {
            throw error;
          }
          outcome = { ok: false, message: error.message };
          trail.push({ tool: definition.name, outcome: 'refused' });
        }
      }
    }
    contents.push({
      role: 'user',
      parts: [
        { functionResponse: { id: call?.id, name: call?.name ?? 'unknown', response: outcome } },
        ...rest.map((extra) => ({
          functionResponse: {
            id: extra.id,
            name: extra.name ?? 'unknown',
            response: { ok: false, message: 'Only one action runs per request; this one did not.' },
          },
        })),
      ],
    });
  }

  if (!response.reply) {
    response.reply = 'I could not finish that. Try saying it another way, or with more detail.';
  }

  await withRls(ctx, (tx) =>
    audit(tx, ctx, {
      action: 'ai_assist',
      entityType: 'ai_assistant',
      entityId: input.context.contactId ?? input.context.opportunityId ?? null,
      context: {
        model: model ?? aiService.modelFor('reasoning'),
        fellBack,
        steps,
        tools: trail,
        actionTaken: response.actionTaken,
        attachment: tool.attachment
          ? { mimeType: tool.attachment.mimeType, bytes: tool.attachment.bytes.length }
          : null,
        ...auditDetails,
      },
    }),
  );
  return response;
}
