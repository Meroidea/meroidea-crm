import { editPendingAction, getPendingAction } from '@/modules/assistant/pending';
import { pendingEditSchema } from '@/modules/assistant/pending-schemas';
import { authedRoute, jsonOk, routeId } from '@/server/authed-route';
import { readJsonBody } from '@/server/request';

type Params = { params: Promise<{ id: string }> };

/** One of the person's own proposals, as the card shows it. */
export async function GET(request: Request, { params }: Params): Promise<Response> {
  return authedRoute(request, async (ctx) =>
    jsonOk(await getPendingAction(ctx, await routeId(params))),
  );
}

/** The person's own edits to a pending proposal, validated again as a whole (ADR-064). */
export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  return authedRoute(request, async (ctx) => {
    const id = await routeId(params);
    const edit = pendingEditSchema.parse(await readJsonBody(request, 64 * 1024));
    return jsonOk(await editPendingAction(ctx, id, edit));
  });
}
