/**
 * Hooks for module-template
 */
import type { HookPayload } from "../../types/hooks";

export async function onModuleLoaded({ module }: HookPayload) {
  console.log(`[ModuleTemplate] Loaded: ${module.name}`);
}

export async function onModuleDisabled({ module }: HookPayload) {
  console.log(`[ModuleTemplate] Disabled: ${module.name}`);
}

