import ignore from 'ignore';
import type { IncludeRule } from '../manifest/types.js';
import { evalWhen } from '../prompts/expr.js';
import type { Answers } from '../prompts/types.js';

type Compiled = {
  rule: IncludeRule;
  matches: (relativePath: string) => boolean;
};

/**
 * Pre-compile each rule's path/glob into a fast matcher.
 *
 * `path:` is exact-match against the relative path (POSIX form).
 * `glob:` reuses `ignore`'s gitignore-style matcher — same surface as
 * `.hexignore`, so authors only learn one glob dialect.
 */
function compile(rules: IncludeRule[]): Compiled[] {
  return rules.map((rule) => {
    if ('path' in rule) {
      const target = rule.path;
      return { rule, matches: (rel) => rel === target };
    }
    const matcher = ignore().add(rule.glob);
    return { rule, matches: (rel) => matcher.ignores(rel) };
  });
}

/**
 * Decide whether a walked file should be emitted. Files only fail this
 * check if they match an include rule AND that rule's `when:` evaluates
 * false. Files that don't match any rule are always included.
 */
export function shouldInclude(
  relativePath: string,
  rules: IncludeRule[],
  answers: Answers,
): boolean {
  if (rules.length === 0) return true;
  for (const { rule, matches } of compile(rules)) {
    if (matches(relativePath)) {
      return evalWhen(rule.when, answers);
    }
  }
  return true;
}
