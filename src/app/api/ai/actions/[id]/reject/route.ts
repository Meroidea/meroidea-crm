import { rejectPendingAction } from '@/modules/assistant/pending';
import { authedRoute, jsonOk, routeId } from '@/server/authed-route';

/** Cancel (ADR-064): the proposal is kept as a record, marked rejected, and can never run. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return authedRoute(request, async (ctx) =>
    jsonOk(await rejectPendingAction(ctx, await routeId(params))),
  );
}
