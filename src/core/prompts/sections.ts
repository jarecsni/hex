import type { Prompt, Section } from '../manifest/types.js';

export type SectionPlan = {
  // null title = implicit single-section fallback (no manifest sections declared)
  title: string | null;
  prompts: Prompt[];
};

export class SectionPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SectionPlanError';
  }
}

/**
 * Group prompts into ordered section plans. With no manifest sections,
 * returns one plan with `title: null` containing every prompt; the engine
 * uses the null sentinel to suppress headers for trivial flat manifests.
 *
 * Schema validation already enforces total coverage (every prompt in
 * exactly one section, no orphans, no unknown references). This helper
 * still validates because it can be called against a hand-built manifest
 * that bypassed the schema.
 */
export function planSections(prompts: Prompt[], sections?: Section[]): SectionPlan[] {
  if (!sections || sections.length === 0) {
    return [{ title: null, prompts }];
  }

  const byName = new Map(prompts.map((p) => [p.name, p]));
  const seen = new Set<string>();
  const plans: SectionPlan[] = [];

  for (const section of sections) {
    const sectionPrompts: Prompt[] = [];
    for (const name of section.prompts) {
      const prompt = byName.get(name);
      if (!prompt) {
        throw new SectionPlanError(
          `section "${section.title}" references unknown prompt "${name}"`,
        );
      }
      if (seen.has(name)) {
        throw new SectionPlanError(`prompt "${name}" appears in multiple sections`);
      }
      seen.add(name);
      sectionPrompts.push(prompt);
    }
    plans.push({ title: section.title, prompts: sectionPrompts });
  }

  for (const p of prompts) {
    if (!seen.has(p.name)) {
      throw new SectionPlanError(`prompt "${p.name}" is not assigned to any section`);
    }
  }

  return plans;
}
