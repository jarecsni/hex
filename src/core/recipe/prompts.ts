import { runPrompts } from '../prompts/engine.js';
import type { Answers, Prompter } from '../prompts/types.js';
import type { ResolvedRecipe } from './resolve.js';

/**
 * Drive prompt collection across a resolved recipe — recipe top-level
 * questions first, then each child's prompts in `composes:` declaration
 * order.
 *
 * Answer tree shape:
 *
 *   {
 *     <recipe_top_level_prompt>: <answer>,        // recipe prompts at root
 *     ...
 *     <child_key>: {                              // each composes: entry
 *       <child_prompt>: <answer>,
 *       ...
 *     }
 *   }
 *
 * Children with no prompts still get an empty object at `answers[key]`,
 * so a sibling's `when:` can branch on `child_key` (truthy when present).
 *
 * Each child's prompts are evaluated with a flat context that contains
 * the recipe top-level answers plus all completed-sibling namespace
 * objects, plus the child's own already-collected answers. That makes:
 *
 *   - recipe-level: bare reference works (`when: containerize`)
 *   - sibling presence: `when: api` (truthy if api child ran) or
 *     `when: api.port == 3000` (deeper field check)
 *   - same-child cross-refs: bare reference works (`when: framework`)
 */
export async function runRecipePrompts(
  resolved: ResolvedRecipe,
  prompter: Prompter,
  initial: Answers = {},
): Promise<Answers> {
  const answers: Answers = { ...initial };
  const recipeManifest = resolved.recipeBundle.manifest;

  if (recipeManifest.prompts && recipeManifest.prompts.length > 0) {
    const recipeAnswers = await runPrompts(
      recipeManifest.prompts,
      prompter,
      answers,
      recipeManifest.sections,
    );
    Object.assign(answers, recipeAnswers);
  }

  for (const [key, child] of resolved.children) {
    if (child.resolved) {
      // Recipe child — recursively run the nested recipe's prompts. The
      // nested recipe sees outer scope (recipe-level + completed siblings)
      // at root via the initial answers. Extract the nested recipe's own
      // contributions (everything new vs. the snapshot) into answers[key].
      prompter.note?.('', `Configuring "${key}"`);
      const inheritedKeys = new Set(Object.keys(answers));
      const nestedContext = await runRecipePrompts(child.resolved, prompter, { ...answers });
      const nestedContributions: Answers = {};
      for (const k of Object.keys(nestedContext)) {
        if (!inheritedKeys.has(k)) nestedContributions[k] = nestedContext[k];
      }
      answers[key] = nestedContributions;
      continue;
    }

    const childManifest = child.bundle.manifest;
    const childPrompts = childManifest.prompts ?? [];

    if (childPrompts.length === 0) {
      answers[key] = {};
      continue;
    }

    prompter.note?.('', `Configuring "${key}"`);

    const promptNames = new Set(childPrompts.map((p) => p.name));
    const childContext = await runPrompts(
      childPrompts,
      prompter,
      { ...answers },
      childManifest.sections,
    );

    const childAnswers: Answers = {};
    for (const name of promptNames) {
      if (name in childContext) childAnswers[name] = childContext[name];
    }
    answers[key] = childAnswers;
  }

  return answers;
}
