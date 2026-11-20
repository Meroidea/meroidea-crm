import { assistantChatSchema, ASSISTANT_LIMITS } from '@/modules/assistant/schemas';
import { streamAssistantReply } from '@/modules/assistant/service';
import { authedRoute } from '@/server/authed-route';
import { readJsonBody } from '@/server/request';

/** Room for a few tool calls and a streamed answer on a slow model. */
export const maxDuration = 60;

/**
 * Meroidea AI's chat (ADR-063, ADR-064). A Route Handler because the answer streams. Read tools
 * run during the turn; write tools only record proposals, decided at /api/ai/actions/:id.
 */
export async function POST(request: Request): Promise<Response> {
  return authedRoute(request, async (ctx) => {
    const input = assistantChatSchema.parse(
      await readJsonBody(request, ASSISTANT_LIMITS.maxBodyBytes),
    );
    return streamAssistantReply(ctx, input, request.signal);
  });
}
