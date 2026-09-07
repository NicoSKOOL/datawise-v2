import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import type { McpEnv, McpIdentity } from './env';
import type { ToolContext } from './tools/types';
import { ALL_TOOLS } from './tools/registry';
import { runGated } from './gate';

export const SERVER_INFO = { name: 'datawise', version: '1.0.0' };

// Every stage 1 tool is a read (spec section 5). ChatGPT and Claude skip the
// per-call confirmation prompt only when readOnlyHint is true.
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

export function createDataWiseServer(ctx: ToolContext): McpServer {
  const server = new McpServer(SERVER_INFO);
  for (const tool of ALL_TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema.shape, annotations: READ_ONLY },
      // ToolResult (shape.ts) has no index signature, so it structurally
      // fails against the SDK's CallToolResult (which allows arbitrary
      // extra keys). The runtime shape is a valid CallToolResult; this cast
      // avoids adding an index signature to the shared, already-tested
      // ToolResult type just for this SDK quirk.
      async (args: unknown) => (await runGated(tool, args, ctx)) as CallToolResult,
    );
  }
  return server;
}

export function allowedHostnames(env: McpEnv): string[] {
  const publicHost = new URL(env.MCP_PUBLIC_URL).hostname;
  return [publicHost, 'datawise-mcp.nico-510.workers.dev', 'localhost', '127.0.0.1'];
}

export function handleMcpRequest(request: Request, env: McpEnv, execCtx: ExecutionContext, identity: McpIdentity): Promise<Response> {
  // A fresh stateless server per request; identity is closed over, so tools
  // never need to read the bearer token or the auth context.
  const handler = createMcpHandler(() => createDataWiseServer({ env, identity }), {
    route: '/mcp',
    legacy: 'stateless',
    allowedHostnames: allowedHostnames(env),
    onerror: (error: Error) => console.error('[mcp] protocol error:', error.message),
  });
  return handler(request, env as unknown as Record<string, unknown>, execCtx);
}
