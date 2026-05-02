import nunjucks from 'nunjucks';
import type { Answers } from './types.js';

const env = new nunjucks.Environment(null, {
  autoescape: false,
  throwOnUndefined: false,
});

/**
 * Evaluate a Nunjucks expression in boolean context against an answers
 * object. Used for both prompt `when:` and hook / include rule `when:`.
 *
 * Examples that work:
 *   "containerize"
 *   "!debug"
 *   "framework == 'react'"
 *   "framework in ['react', 'vue']"
 */
export function evalWhen(expr: string, answers: Answers): boolean {
  const tpl = `{% if ${expr} %}1{% else %}0{% endif %}`;
  let out: string;
  try {
    out = env.renderString(tpl, answers);
  } catch (err) {
    throw new Error(
      `failed to evaluate when expression "${expr}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return out === '1';
}
