import { z } from 'zod';
import type { McpEnv, McpIdentity } from '../env';
import type { ToolResult, CompactOptions } from '../shape';
import { CONCISE, DETAILED } from '../shape';

export interface ToolContext {
  env: McpEnv;
  identity: McpIdentity;
}

export interface ToolDef<S extends z.ZodObject<any> = z.ZodObject<any>> {
  name: string;
  description: string;
  inputSchema: S;
  run(args: z.infer<S>, ctx: ToolContext): Promise<ToolResult>;
}

export function defineTool<S extends z.ZodObject<any>>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

export const localeInputs = {
  location_code: z.number().int().positive().optional()
    .describe('DataForSEO location code. Defaults to the account default (2840 = United States). 2826 = United Kingdom, 2124 = Canada, 2036 = Australia, 2724 = Spain, 2484 = Mexico.'),
  language_code: z.string().min(2).max(8).optional()
    .describe('Two-letter language code such as en or es. Defaults to the account default.'),
  response_format: z.enum(['concise', 'detailed']).default('concise')
    .describe('concise returns the fields a person would put in a spreadsheet; detailed returns more fields and longer lists.'),
};

// Bare-domain input. sanitizeDomainTarget (routes/competitors.ts) still runs
// inside every handler; this only gives the model a clearer schema.
export const domainInput = z.string().min(3).max(253)
  .describe('Bare domain such as example.com. Protocol, www and paths are stripped automatically.');

export function resolveLocale(
  args: { location_code?: number; language_code?: string },
  identity: McpIdentity,
): { location_code: number; language_code: string } {
  return {
    location_code: args.location_code ?? identity.defaultLocationCode,
    language_code: args.language_code ?? identity.defaultLanguageCode,
  };
}

export function shapeFor(format: 'concise' | 'detailed' | undefined): CompactOptions {
  return format === 'detailed' ? DETAILED : CONCISE;
}
