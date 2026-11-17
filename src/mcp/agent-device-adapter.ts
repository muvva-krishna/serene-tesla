import { z } from 'zod';

export interface AccessibilityNode {
  ref: string;
  role: 'button' | 'text-field' | 'link' | 'heading' | 'status';
  label: string;
  value?: string;
}

export interface AgentDeviceMcpToolCall {
  tool: 'open' | 'snapshot' | 'press' | 'fill' | 'close';
  args: Record<string, unknown>;
}

export interface AgentDeviceToolResponse {
  ok: boolean;
  errorCode?: 'STALE_REF' | 'SESSION_NOT_OPEN' | 'NODE_NOT_FOUND' | 'VALIDATION_ERROR';
  message: string;
  diffLines?: string[];
  activeRefs: string[];
  nodes?: AccessibilityNode[];
  screen?: string;
}

export const agentDeviceOpenSchema = z.object({
  app: z.string().min(1),
  platform: z.enum(['web', 'ios', 'android', 'macos', 'linux']).default('web'),
});

export const agentDevicePressSchema = z.object({
  ref: z.string().regex(/^@e\d+$/),
  settle: z.boolean().default(true),
});

export const agentDeviceFillSchema = z.object({
  ref: z.string().regex(/^@e\d+$/),
  value: z.string(),
  settle: z.boolean().default(true),
});

/**
 * Generates standard Mastra MCPClient server config for callstack/agent-device.
 */
export function createAgentDeviceMcpServerConfig(
  command = 'agent-device',
): { agentDevice: { command: string; args: string[] } } {
  return {
    agentDevice: {
      command,
      args: ['mcp'],
    },
  };
}

/**
 * Deterministic in-process simulation of callstack/agent-device's accessibility-tree
 * lifecycle (refs, --settle diffs, and STALE_REF enforcement) for repeatable
 * Mastra agent benchmarking and rollouts.
 */
export class SimulatedAgentDeviceSession {
  private isOpen = false;
  private screen: 'home' | 'contact_form' | 'submitted' = 'home';
  private activeNodes: AccessibilityNode[] = [];
  private firstName = '';
  private lastName = '';

  private setScreenNodes(nodes: AccessibilityNode[]): void {
    this.activeNodes = nodes;
  }

  private activeRefs(): string[] {
    return this.activeNodes.map(n => n.ref);
  }

  open(input: z.infer<typeof agentDeviceOpenSchema>): AgentDeviceToolResponse {
    const parsed = agentDeviceOpenSchema.parse(input);
    this.isOpen = true;
    this.screen = 'home';
    this.firstName = '';
    this.lastName = '';
    this.setScreenNodes([
      { ref: '@e1', role: 'heading', label: `${parsed.app} (${parsed.platform})` },
      { ref: '@e2', role: 'button', label: 'Add Contact' },
    ]);
    return {
      ok: true,
      message: `Opened ${parsed.app} on ${parsed.platform}.`,
      activeRefs: this.activeRefs(),
      screen: this.screen,
    };
  }

  snapshot(interactiveOnly = true): AgentDeviceToolResponse {
    if (!this.isOpen) {
      return {
        ok: false,
        errorCode: 'SESSION_NOT_OPEN',
        message: 'No open device session.',
        activeRefs: [],
      };
    }
    const visible = interactiveOnly
      ? this.activeNodes.filter(n => n.role === 'button' || n.role === 'text-field')
      : this.activeNodes;
    return {
      ok: true,
      message: `Captured accessibility snapshot (${visible.length} nodes).`,
      nodes: visible,
      activeRefs: this.activeRefs(),
      screen: this.screen,
    };
  }

  press(input: z.infer<typeof agentDevicePressSchema>): AgentDeviceToolResponse {
    if (!this.isOpen) {
      return {
        ok: false,
        errorCode: 'SESSION_NOT_OPEN',
        message: 'No open device session.',
        activeRefs: [],
      };
    }
    const parsed = agentDevicePressSchema.parse(input);
    const target = this.activeNodes.find(n => n.ref === parsed.ref);
    if (!target) {
      return {
        ok: false,
        errorCode: 'STALE_REF',
        message: `STALE_REF: Ref ${parsed.ref} is no longer valid in current accessibility tree.`,
        activeRefs: this.activeRefs(),
        screen: this.screen,
      };
    }

    if (this.screen === 'home' && target.label === 'Add Contact') {
      this.screen = 'contact_form';
      // Pressing Add invalidates @e2 and introduces new form refs (@e7, @e8, @e9)
      this.setScreenNodes([
        { ref: '@e7', role: 'text-field', label: 'First name', value: '' },
        { ref: '@e8', role: 'text-field', label: 'Last name', value: '' },
        { ref: '@e9', role: 'button', label: 'Save Contact' },
      ]);
      return {
        ok: true,
        message: 'Pressed Add Contact and settled UI.',
        diffLines: parsed.settle
          ? [
              '- @e2 [button] "Add Contact"',
              '+ @e7 [text-field] "First name"',
              '+ @e8 [text-field] "Last name"',
              '+ @e9 [button] "Save Contact"',
            ]
          : undefined,
        activeRefs: parsed.settle ? this.activeRefs() : ['@e2'],
        screen: this.screen,
      };
    }

    if (this.screen === 'contact_form' && target.label === 'Save Contact') {
      if (!this.firstName || !this.lastName) {
        return {
          ok: false,
          errorCode: 'VALIDATION_ERROR',
          message: 'Cannot save contact: First name and Last name are required.',
          activeRefs: this.activeRefs(),
          screen: this.screen,
        };
      }
      this.screen = 'submitted';
      this.setScreenNodes([
        {
          ref: '@e20',
          role: 'status',
          label: `Saved ${this.firstName} ${this.lastName}`,
        },
      ]);
      return {
        ok: true,
        message: `Saved contact ${this.firstName} ${this.lastName}.`,
        diffLines: [`+ @e20 [status] "Saved ${this.firstName} ${this.lastName}"`],
        activeRefs: this.activeRefs(),
        screen: this.screen,
      };
    }

    return {
      ok: false,
      errorCode: 'NODE_NOT_FOUND',
      message: `No interactive transition bound to ${parsed.ref}.`,
      activeRefs: this.activeRefs(),
      screen: this.screen,
    };
  }

  fill(input: z.infer<typeof agentDeviceFillSchema>): AgentDeviceToolResponse {
    if (!this.isOpen) {
      return {
        ok: false,
        errorCode: 'SESSION_NOT_OPEN',
        message: 'No open device session.',
        activeRefs: [],
      };
    }
    const parsed = agentDeviceFillSchema.parse(input);
    const target = this.activeNodes.find(n => n.ref === parsed.ref);
    if (!target || target.role !== 'text-field') {
      return {
        ok: false,
        errorCode: 'STALE_REF',
        message: `STALE_REF: Ref ${parsed.ref} is invalid or not a text-field.`,
        activeRefs: this.activeRefs(),
        screen: this.screen,
      };
    }

    // Re-rendering on settle renumbers refs (matching real agent-device behavior!)
    if (target.label === 'First name') {
      this.firstName = parsed.value;
      this.setScreenNodes([
        { ref: '@e14', role: 'text-field', label: 'First name', value: this.firstName },
        { ref: '@e15', role: 'text-field', label: 'Last name', value: this.lastName },
        { ref: '@e16', role: 'button', label: 'Save Contact' },
      ]);
      return {
        ok: true,
        message: `Filled First name with "${parsed.value}".`,
        diffLines: parsed.settle
          ? [
              '- @e7 [text-field] "First name"',
              `+ @e14 [text-field] "First name"="${this.firstName}"`,
              '= @e15 [text-field] "Last name"',
              '= @e16 [button] "Save Contact"',
            ]
          : undefined,
        activeRefs: parsed.settle ? this.activeRefs() : ['@e7', '@e8', '@e9'],
        screen: this.screen,
      };
    }

    if (target.label === 'Last name') {
      this.lastName = parsed.value;
      return {
        ok: true,
        message: `Filled Last name with "${parsed.value}".`,
        activeRefs: this.activeRefs(),
        screen: this.screen,
      };
    }

    return {
      ok: false,
      errorCode: 'NODE_NOT_FOUND',
      message: `Unhandled field ${target.label}.`,
      activeRefs: this.activeRefs(),
      screen: this.screen,
    };
  }

  close(): AgentDeviceToolResponse {
    this.isOpen = false;
    this.activeNodes = [];
    return {
      ok: true,
      message: 'Session closed.',
      activeRefs: [],
      screen: this.screen,
    };
  }

  getScreenState(): { screen: string; firstName: string; lastName: string } {
    return { screen: this.screen, firstName: this.firstName, lastName: this.lastName };
  }
}
