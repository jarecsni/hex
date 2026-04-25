import { detectCapabilities } from '../util/tty.js';
import { brand } from './colors.js';
import { getGlyphs } from './glyphs.js';

export function splash(): string {
  const caps = detectCapabilities();
  if (!caps.unicode) {
    return `  ${brand.honeyBold('hex')}`;
  }
  const g = getGlyphs(true);
  const honey = brand.honey;
  return [
    `   ${honey(g.empty)} ${honey(g.empty)}`,
    `  ${honey(g.empty)} ${brand.honeyBold(g.filled)} ${honey(g.empty)}`,
    `   ${honey(g.empty)} ${honey(g.empty)}`,
  ].join('\n');
}
