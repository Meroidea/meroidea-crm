import 'server-only';

import { createDraftInvoiceTool } from './invoice';
import { draftCommunicationTool } from './communication';
import { analyseDocumentTool } from './document';
import { suggestNextActionsTool } from './next-actions';
import { deleteRosterTool, generateStaffRosterTool, removeRosterShiftsTool } from './roster';
import type { ToolContext, ToolDefinition } from './shared';

// Each tool's input type differs; the registry only needs what they share.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrowed per tool by its own Zod schema
type AnyTool = ToolDefinition<any>;

export const TOOLS: AnyTool[] = [
  createDraftInvoiceTool,
  generateStaffRosterTool,
  removeRosterShiftsTool,
  deleteRosterTool,
  draftCommunicationTool,
  analyseDocumentTool,
  suggestNextActionsTool,
];

/**
 * The tools this person may use right now. A tool the person lacks the permission for is never
 * offered to the model at all, so it cannot be talked into calling it; each tool's queries then
 * check the permission again, at the person's own record scope.
 */
export function availableTools(tool: ToolContext): AnyTool[] {
  return TOOLS.filter((definition) => definition.available(tool));
}
