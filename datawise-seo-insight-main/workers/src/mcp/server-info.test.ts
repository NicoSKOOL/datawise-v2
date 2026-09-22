import { describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { serverInfo } from './server';
import { makeMcpTestEnv } from './test-support';

describe('serverInfo', () => {
  it('advertises the DataWise title, website and an absolute icon URL on the public host', () => {
    const { env } = makeMcpTestEnv();
    const info = serverInfo(env);
    expect(info.name).toBe('datawise');
    expect(info.title).toBe('DataWise');
    expect(info.websiteUrl).toBe('https://datawiseseo.com');
    expect(info.icons).toEqual([{ src: `${env.MCP_PUBLIC_URL}/icon.png`, mimeType: 'image/png', sizes: ['192x192'] }]);
    // The SDK validates Implementation at construction time.
    expect(() => new McpServer(info)).not.toThrow();
  });
});
