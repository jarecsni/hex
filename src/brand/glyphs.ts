import { detectCapabilities } from '../util/tty.js';

export interface Glyphs {
  filled: string;
  empty: string;
  error: string;
}

const UNICODE: Glyphs = {
  filled: '⬢',
  empty: '⬡',
  error: '⬣',
};

const ASCII: Glyphs = {
  filled: '[#]',
  empty: '[ ]',
  error: '[!]',
};

export function getGlyphs(unicode = detectCapabilities().unicode): Glyphs {
  return unicode ? UNICODE : ASCII;
}

export const cell = {
  done: () => getGlyphs().filled,
  pending: () => getGlyphs().empty,
  error: () => getGlyphs().error,
};
