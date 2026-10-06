import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { RUN_ID_HEADER, RUN_TOKEN_HEADER } from '@agent-band/contracts';
import type { Composition } from '../../composition.ts';
import { AppError } from '../../platform/errors.ts';
import { MCP_TOOLS, toolDescriptors } from '../mcp/tools.ts';

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS =
  'agent-band delegation tools. Create subtasks for other agents, then end your turn; you are resumed with their results. Finish with complete_goal.';

interface RpcRequest {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
}

type RpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string; data?: unknown } };

const rpcError = (id: RpcRequest['id'], code: number, message: string): RpcResponse => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
});

function errorText(err: AppError): string {
  const detail = Array.isArray(err.details)
    ? ` ${JSON.stringify(err.details)}`
    : err.details
      ? ` ${JSON.stringify(err.details)}`
      : '';
  return `${err.code} (${err.status}): ${err.message}${detail}`;
}

const header = (v: string | string[] | undefined): string => (typeof v === 'string' ? v : '');

/** Stateless Streamable HTTP MCP endpoint exposing the delegation tools to leader runs. */
export function mcpRoutes(c: Composition): FastifyPluginCallbackZod {
  return (app, _opts, done) => {
    app.post(
      '/mcp',
      { schema: { tags: ['execution'], summary: 'MCP server with the delegation tools (run token auth)' } },
      async (req, reply) => {
        const runId = header(req.headers[RUN_ID_HEADER]);
        const token = header(req.headers[RUN_TOKEN_HEADER]);
        const body: unknown = req.body;
        const first = Array.isArray(body) ? undefined : (body as RpcRequest | null | undefined);
        if (!runId || !token) {
          return reply.code(401).send(rpcError(first?.id, -32001, 'Missing run credentials'));
        }
        if (typeof body !== 'object' || body === null)
          return reply.code(400).send(rpcError(null, -32700, 'Expected a JSON-RPC message'));
        let ctx;
        try {
          ctx = await c.delegation.resolveRunContext(c.database.db, runId, token);
        } catch (err) {
          if (err instanceof AppError)
            return reply.code(err.status).send(rpcError(first?.id, -32001, errorText(err)));
          throw err;
        }

        const handle = async (msg: RpcRequest): Promise<RpcResponse | null> => {
          // A response or malformed message from the client has nothing to answer.
          if (typeof msg.method !== 'string') return null;
          if (msg.id === undefined) return null;
          const params = (msg.params ?? {}) as {
            name?: unknown;
            arguments?: unknown;
            protocolVersion?: unknown;
          };
          switch (msg.method) {
            case 'initialize': {
              const wanted = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
              return {
                jsonrpc: '2.0',
                id: msg.id,
                result: {
                  protocolVersion: SUPPORTED_VERSIONS.includes(wanted) ? wanted : SUPPORTED_VERSIONS[0],
                  capabilities: { tools: { listChanged: false } },
                  serverInfo: { name: 'agent-band', version: '1.0.0' },
                  instructions: INSTRUCTIONS,
                },
              };
            }
            case 'ping':
              return { jsonrpc: '2.0', id: msg.id, result: {} };
            case 'tools/list':
              return { jsonrpc: '2.0', id: msg.id, result: { tools: toolDescriptors() } };
            case 'tools/call': {
              const tool = MCP_TOOLS.find((t) => t.name === params.name);
              if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${String(params.name)}`);
              try {
                const input = tool.schema.safeParse(params.arguments ?? {});
                if (!input.success) {
                  const issues = input.error.issues.map(
                    (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
                  );
                  return {
                    jsonrpc: '2.0',
                    id: msg.id,
                    result: {
                      isError: true,
                      content: [{ type: 'text', text: `validation_failed (400): ${issues.join('; ')}` }],
                    },
                  };
                }
                const value = await tool.run(c.delegation, c.database.db, ctx, input.data as never);
                return {
                  jsonrpc: '2.0',
                  id: msg.id,
                  result: { content: [{ type: 'text', text: JSON.stringify(value ?? null, null, 2) }] },
                };
              } catch (err) {
                if (!(err instanceof AppError)) {
                  req.log.error({ err }, 'mcp tool failed');
                  return {
                    jsonrpc: '2.0',
                    id: msg.id,
                    result: { isError: true, content: [{ type: 'text', text: 'internal_error (500)' }] },
                  };
                }
                return {
                  jsonrpc: '2.0',
                  id: msg.id,
                  result: { isError: true, content: [{ type: 'text', text: errorText(err) }] },
                };
              }
            }
            default:
              return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
          }
        };

        if (Array.isArray(body)) {
          const out = (await Promise.all(body.map(handle))).filter((r) => r !== null);
          return out.length === 0 ? reply.code(202).send() : out;
        }
        const res = await handle(body);
        return res === null ? reply.code(202).send() : res;
      },
    );
    const notAllowed = (
      _req: unknown,
      reply: { code(n: number): { header(k: string, v: string): { send(): unknown } } },
    ) => reply.code(405).header('allow', 'POST').send();
    app.get('/mcp', { schema: { hide: true } }, notAllowed);
    app.delete('/mcp', { schema: { hide: true } }, notAllowed);
    done();
  };
}
