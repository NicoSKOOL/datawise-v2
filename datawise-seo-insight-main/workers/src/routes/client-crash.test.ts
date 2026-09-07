import { describe, it, expect } from 'vitest';
import { buildClientCrashInput } from './client-crash';
import { buildClientCrashEvent } from '../activity';

describe('buildClientCrashInput', () => {
  it('normalizes a boundary payload and bounds every field', () => {
    const input = buildClientCrashInput({
      name: 'TypeError',
      message: 'x'.repeat(600),
      stack: 's'.repeat(5000),
      component_stack: 'c'.repeat(4000),
      route: '/content-tools?tab=optimizer',
      source: 'route',
    }, 'Mozilla/5.0 test');
    expect(input).not.toBeNull();
    expect(input!.name).toBe('TypeError');
    expect(input!.message).toHaveLength(500);
    expect(input!.stack).toHaveLength(4000);
    expect(input!.component_stack).toHaveLength(3000);
    expect(input!.route).toBe('/content-tools?tab=optimizer');
    expect(input!.source).toBe('route');
    expect(input!.user_agent).toBe('Mozilla/5.0 test');
  });

  it('rejects payloads without a message and ignores non-string fields', () => {
    expect(buildClientCrashInput({ stack: 'only stack' }, null)).toBeNull();
    expect(buildClientCrashInput(null, null)).toBeNull();
    expect(buildClientCrashInput('nope', null)).toBeNull();
    const input = buildClientCrashInput({ message: 'boom', name: 42, stack: { a: 1 } }, null);
    expect(input).toEqual({
      name: 'Error', message: 'boom', stack: null, component_stack: null, route: null, source: 'app', user_agent: null,
    });
  });
});

describe('buildClientCrashEvent', () => {
  it('maps a crash onto an app_events row with the stack in metadata', () => {
    const event = buildClientCrashEvent('user-1', {
      name: 'TypeError',
      message: "Cannot read properties of undefined (reading 'map')",
      stack: 'TypeError: ...\n  at ServicePageOptimizer',
      component_stack: '\n  at ServicePageOptimizer\n  at ContentTools',
      route: '/content-tools?tab=optimizer',
      source: 'route',
      user_agent: 'UA',
    });
    expect(event).toMatchObject({
      event_name: 'Client Crash',
      event_category: 'product',
      feature: 'client',
      action: 'crash',
      resource_type: 'route',
      user_id: 'user-1',
      route: '/content-tools?tab=optimizer',
      method: 'CLIENT',
      outcome: 'error',
      error_code: 'TypeError',
    });
    const metadata = JSON.parse(event.metadata_json as string);
    expect(metadata.message).toContain("reading 'map'");
    expect(metadata.stack).toContain('ServicePageOptimizer');
    expect(metadata.component_stack).toContain('ContentTools');
    expect(metadata.source).toBe('route');
    expect(metadata.user_agent).toBe('UA');
  });

  it('omits empty metadata fields', () => {
    const event = buildClientCrashEvent('user-1', {
      name: 'Error', message: 'boom', stack: null, component_stack: null, route: null, source: 'app', user_agent: null,
    });
    expect(JSON.parse(event.metadata_json as string)).toEqual({ message: 'boom', source: 'app' });
    expect(event.route).toBeNull();
  });
});
