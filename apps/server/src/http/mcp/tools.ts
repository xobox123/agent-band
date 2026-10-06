import { z } from 'zod';
import type { Db } from '../../platform/db.ts';
import {
  CompleteGoalInput,
  CreateSubtaskInput,
  DelegateAgentFilter,
  RequestReviewInput,
  type Delegation,
  type RunContext,
} from '../../modules/delegation/index.ts';

export interface McpTool {
  name: string;
  description: string;
  schema: z.ZodType;
  run(d: Delegation, db: Db, ctx: RunContext, input: never): Promise<unknown>;
}

const GetTaskInput = z.object({ key: z.string().min(1).describe('Task key, e.g. "AB-12".') }).strict();
const PostNoteInput = z
  .object({ text: z.string().min(1).max(2000).describe('Note text, 1 to 2000 characters.') })
  .strict();
const NoInput = z.object({}).strict();

const tool = <S extends z.ZodType>(
  name: string,
  description: string,
  schema: S,
  run: (d: Delegation, db: Db, ctx: RunContext, input: z.output<S>) => Promise<unknown>,
): McpTool => ({ name, description, schema, run });

export const MCP_TOOLS: McpTool[] = [
  tool(
    'list_agents',
    'List the agents you may delegate to (handle, name, role, labels, groups, model). Call this before create_subtask to pick a target. Leaders and agents outside your delegation scope are not listed.',
    DelegateAgentFilter,
    (d, db, ctx, input) => d.listDelegateAgents(db, ctx, input),
  ),
  tool(
    'create_subtask',
    'Create a subtask for another agent. The subtask runs asynchronously after this call returns; it does not run inside your turn and you do not get its result now. Target an agent by { "agentId" }, a { "label" } or an { "agentGroupId" }. workDir must be an absolute path inside the goal workDir. mode is capped by your own permissions. dependsOn lists keys of earlier subtasks that must finish first. Limits (maxSubtasks, token budget, maxRounds) apply to the whole goal; exceeding them returns an error. Create all independent subtasks in one turn, then end your turn: you are resumed with their results.',
    CreateSubtaskInput,
    (d, db, ctx, input) => d.createSubtask(db, ctx, input),
  ),
  tool(
    'list_subtasks',
    'List all subtasks of this goal with status, result summary and token usage.',
    NoInput,
    (d, db, ctx) => d.listSubtasks(db, ctx),
  ),
  tool(
    'get_task',
    'Get one subtask of this goal by key: status, result summary, error and token usage.',
    GetTaskInput,
    (d, db, ctx, input) => d.getTask(db, ctx, input.key),
  ),
  tool(
    'request_review',
    'Ask an agent with role reviewer to review a finished subtask. Creates a read-only review subtask that depends on the reviewed one. Runs asynchronously like any subtask; end your turn afterwards and read the review when you are resumed.',
    RequestReviewInput,
    (d, db, ctx, input) => d.requestReview(db, ctx, input),
  ),
  tool(
    'complete_goal',
    'Finish the goal. Call it once, when the work is done or cannot be continued. outcome is success, partial or failed. Any still-open subtasks are cancelled. Without this call the goal keeps waiting for another turn.',
    CompleteGoalInput,
    (d, db, ctx, input) => d.completeGoal(db, ctx, input),
  ),
  tool(
    'post_note',
    'Append a short progress note to the goal timeline, visible to the humans following the goal.',
    PostNoteInput,
    (d, db, ctx, input) => d.postNote(db, ctx, input.text).then(() => ({ ok: true })),
  ),
];

export function toolDescriptors() {
  return MCP_TOOLS.map((t) => {
    const inputSchema: Record<string, unknown> = z.toJSONSchema(t.schema, { io: 'input' });
    delete inputSchema['$schema'];
    return { name: t.name, description: t.description, inputSchema };
  });
}
