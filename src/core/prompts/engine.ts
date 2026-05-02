import { existsSync } from 'node:fs';
import type {
  EnumPrompt,
  IntegerPrompt,
  MultiPrompt,
  PasswordPrompt,
  PathPrompt,
  Prompt,
  PromptDef,
  Section,
  StringPrompt,
} from '../manifest/types.js';
import { evalWhen } from './expr.js';
import { planSections } from './sections.js';
import type { Answers, Prompter } from './types.js';

export class PromptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptError';
  }
}

const isRequired = (def: PromptDef): boolean =>
  // explicit required wins; otherwise required when no default is given
  def.required ?? !('default' in def && def.default !== undefined);

function validateString(def: StringPrompt, value: string): string | undefined {
  if (isRequired(def) && value.length === 0) return 'value is required';
  if (def.pattern) {
    const re = new RegExp(def.pattern);
    if (!re.test(value)) return `must match pattern: ${def.pattern}`;
  }
  return undefined;
}

function validateInteger(def: IntegerPrompt, raw: string): string | undefined {
  if (raw.length === 0 && isRequired(def)) return 'value is required';
  if (raw.length === 0) return undefined;
  if (!/^-?\d+$/.test(raw)) return 'must be an integer';
  const n = Number(raw);
  if (def.min !== undefined && n < def.min) return `must be >= ${def.min}`;
  if (def.max !== undefined && n > def.max) return `must be <= ${def.max}`;
  return undefined;
}

function validatePath(def: PathPrompt, raw: string): string | undefined {
  if (raw.length === 0 && isRequired(def)) return 'value is required';
  if (raw.length === 0) return undefined;
  if (def.must_exist && !existsSync(raw)) return `path does not exist: ${raw}`;
  return undefined;
}

async function askPrompt(prompter: Prompter, p: Prompt): Promise<unknown> {
  const def = p.def;
  const message = def.description ?? p.name;

  switch (def.type) {
    case 'string': {
      const result = await prompter.text({
        message,
        default: def.default,
        validate: (v) => validateString(def, v),
      });
      return result;
    }
    case 'integer':
    case 'number': {
      const intDef = def as IntegerPrompt;
      const result = await prompter.text({
        message,
        default: intDef.default !== undefined ? String(intDef.default) : undefined,
        validate: (v) => validateInteger(intDef, v),
      });
      return result.length === 0 ? undefined : Number(result);
    }
    case 'boolean': {
      return prompter.confirm({ message, default: def.default });
    }
    case 'enum': {
      const enumDef = def as EnumPrompt;
      return prompter.select({
        message,
        choices: enumDef.choices,
        default: enumDef.default,
      });
    }
    case 'multi': {
      const multiDef = def as MultiPrompt;
      return prompter.multiselect({
        message,
        choices: multiDef.choices,
        default: multiDef.default,
      });
    }
    case 'password': {
      const _passDef = def as PasswordPrompt;
      return prompter.password({ message });
    }
    case 'path': {
      const pathDef = def as PathPrompt;
      const result = await prompter.text({
        message,
        default: pathDef.default,
        validate: (v) => validatePath(pathDef, v),
      });
      return result;
    }
    default: {
      const exhaustive: never = def;
      throw new PromptError(`unsupported prompt type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Run a list of prompts in order, evaluating `when:` against the answers
 * already collected. Skipped prompts contribute nothing to the answers
 * object — downstream `when:` expressions and Nunjucks templates that
 * reference them will see `undefined`.
 *
 * If `sections` is provided, prompts are grouped and sectioning UI hooks
 * on the prompter are invoked at the right moments. Without sections,
 * the engine runs as a flat list (no headers, no outline) — backwards
 * compatible with manifests that don't declare `sections:`.
 *
 * Header suppression: a section whose every prompt is `when:`-skipped at
 * section entry (using answers gathered from earlier sections) is fully
 * skipped — no header, no progress events. Same-section dependencies
 * still work for runtime skipping; the header heuristic only catches the
 * "entire section gated by a previous answer" case.
 */
export async function runPrompts(
  prompts: Prompt[],
  prompter: Prompter,
  initial: Answers = {},
  sections?: Section[],
): Promise<Answers> {
  const answers: Answers = { ...initial };
  const plans = planSections(prompts, sections);
  const sectioned = plans.length > 1 || (plans[0]?.title ?? null) !== null;

  if (sectioned && prompter.outline) {
    prompter.outline(
      plans.map((plan) => ({
        title: plan.title ?? '',
        promptCount: plan.prompts.length,
      })),
    );
  }

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    if (!plan) continue;
    const promptTotal = plan.prompts.length;

    const willFire = plan.prompts.map((p) => !p.def.when || evalWhen(p.def.when, answers));
    const anyVisible = willFire.some(Boolean);
    if (!anyVisible) continue;

    const showHeader = sectioned && plan.title !== null;
    const sectionInfo = showHeader
      ? {
          index: i + 1,
          total: plans.length,
          title: plan.title as string,
          promptCount: promptTotal,
        }
      : null;

    if (sectionInfo) prompter.sectionStart?.(sectionInfo);

    for (let j = 0; j < plan.prompts.length; j++) {
      const p = plan.prompts[j];
      if (!p) continue;
      if (p.def.when && !evalWhen(p.def.when, answers)) continue;
      if (sectioned) {
        prompter.progress?.({
          sectionIndex: i + 1,
          sectionTotal: plans.length,
          promptIndex: j + 1,
          promptTotal,
        });
      }
      answers[p.name] = await askPrompt(prompter, p);
    }

    if (sectionInfo) prompter.sectionEnd?.(sectionInfo);
  }

  return answers;
}
