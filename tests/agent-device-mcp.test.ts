import { describe, expect, it } from 'vitest';
import {
  createAgentDeviceMcpServerConfig,
  SimulatedAgentDeviceSession,
} from '../src/mcp/agent-device-adapter.js';

describe('callstack/agent-device MCP adapter & accessibility-tree simulator', () => {
  it('generates standard Mastra MCP stdio server config', () => {
    const cfg = createAgentDeviceMcpServerConfig();
    expect(cfg.agentDevice).toEqual({
      command: 'agent-device',
      args: ['mcp'],
    });
  });

  it('enforces STALE_REF when using invalidated refs and succeeds when refreshing via diff', () => {
    const session = new SimulatedAgentDeviceSession();
    expect(session.open({ app: 'Contacts', platform: 'ios' }).ok).toBe(true);
    expect(session.press({ ref: '@e2', settle: true }).ok).toBe(true);

    // Fill First name -> renumbers Last name from @e8 to @e15
    const fillFirst = session.fill({ ref: '@e7', value: 'Ada', settle: true });
    expect(fillFirst.ok).toBe(true);
    expect(fillFirst.activeRefs).toEqual(['@e14', '@e15', '@e16']);

    // Reusing stale @e8 must fail with STALE_REF
    const staleAttempt = session.fill({ ref: '@e8', value: 'Lovelace', settle: true });
    expect(staleAttempt.ok).toBe(false);
    expect(staleAttempt.errorCode).toBe('STALE_REF');

    // Using refreshed @e15 and @e16 succeeds
    expect(session.fill({ ref: '@e15', value: 'Lovelace', settle: true }).ok).toBe(true);
    const save = session.press({ ref: '@e16', settle: true });
    expect(save.ok).toBe(true);
    expect(session.getScreenState().screen).toBe('submitted');
    expect(session.close().ok).toBe(true);
  });
});
