import type { Prompt, PromptDef } from './types.js';

/**
 * Each YAML prompt entry is a single-key map. The value can be a long-form
 * PromptDef object, or a shorthand: array → enum, boolean → boolean,
 * number → integer, string → string. Desugaring normalises everything to
 * the long form before schema validation.
 */
export function desugarPrompt(name: string, raw: unknown): Prompt {
  if (Array.isArray(raw)) {
    const choices = raw.map((c) => {
      if (typeof c !== 'string') {
        throw new Error(`prompt "${name}": enum shorthand choices must be strings`);
      }
      return c;
    });
    if (choices.length === 0) {
      throw new Error(`prompt "${name}": enum shorthand needs at least one choice`);
    }
    const def: PromptDef = { type: 'enum', choices, default: choices[0] };
    return { name, def };
  }

  if (typeof raw === 'boolean') {
    return { name, def: { type: 'boolean', default: raw } };
  }

  if (typeof raw === 'number') {
    return { name, def: { type: 'integer', default: raw } };
  }

  if (typeof raw === 'string') {
    return { name, def: { type: 'string', default: raw } };
  }

  if (raw && typeof raw === 'object') {
    return { name, def: raw as PromptDef };
  }

  throw new Error(`prompt "${name}": unsupported shorthand`);
}

/**
 * Walk the raw `prompts:` YAML array and produce the desugared form
 * the schema validator expects. Each entry must be a single-key map.
 */
export function desugarPrompts(raw: unknown): Prompt[] {
  if (!Array.isArray(raw)) {
    throw new Error('prompts must be a list');
  }
  return raw.map((entry, idx) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`prompts[${idx}] must be a single-key map`);
    }
    const keys = Object.keys(entry);
    if (keys.length !== 1) {
      throw new Error(`prompts[${idx}] must have exactly one key (got ${keys.length})`);
    }
    const name = keys[0] as string;
    const value = (entry as Record<string, unknown>)[name];
    return desugarPrompt(name, value);
  });
}
