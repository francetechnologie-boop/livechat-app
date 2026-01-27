/**
 * Hooks for dev-manager
 */
import type { HookPayload } from "../../types/hooks";

export async function onModuleLoaded({ module }: HookPayload) {
  console.log(`[DevManager] Loaded: ${module.name}`);
}

export async function onModuleDisabled({ module }: HookPayload) {
  console.log(`[DevManager] Disabled: ${module.name}`);
}
