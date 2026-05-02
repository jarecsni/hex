import nunjucks from 'nunjucks';
import type { Answers } from '../prompts/types.js';

/**
 * Nunjucks environment used to render template file contents and paths.
 *
 * - autoescape disabled (most outputs are source code, not HTML)
 * - throwOnUndefined left off (consistent with idiomatic Cookiecutter / Copier
 *   behaviour: undefined renders to empty)
 * - no `nunjucks.precompile`-style code injection — the loader is null,
 *   so authors cannot pull in arbitrary template files from the host
 */
function createEnv(): nunjucks.Environment {
  return new nunjucks.Environment(null, {
    autoescape: false,
    throwOnUndefined: false,
    trimBlocks: true,
    lstripBlocks: true,
  });
}

const env = createEnv();

export function renderText(template: string, answers: Answers): string {
  return env.renderString(template, answers);
}
