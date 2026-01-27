export interface HookPayload {
  module: { name: string; version: string };
  agent?: { name: string; timezone?: string };
}

