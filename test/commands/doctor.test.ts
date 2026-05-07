import { describe, expect, it } from 'vitest';
import { formatSetupSection } from '../../src/commands/doctor.js';
import { checklistFromTasks, markTask } from '../../src/core/checklist/index.js';

const fakePath = '/work/.hex/checklist.yaml';
const fakeRoot = '/work';

describe('formatSetupSection', () => {
  it('returns null when no checklist was found', () => {
    expect(formatSetupSection(null)).toBeNull();
  });

  it('returns null when every task is already done', () => {
    let checklist = checklistFromTasks([
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ]);
    checklist = markTask(checklist, 'a', 'done');
    checklist = markTask(checklist, 'b', 'done');
    expect(formatSetupSection({ path: fakePath, rootDir: fakeRoot, checklist })).toBeNull();
  });

  it('lists pending tasks, mentions the resume command', () => {
    const checklist = checklistFromTasks([
      { id: 'install-deps', title: 'Install dependencies' },
      { id: 'push-to-github', title: 'Push to GitHub for first deploy' },
    ]);
    const out = formatSetupSection({ path: fakePath, rootDir: fakeRoot, checklist });
    expect(out).not.toBeNull();
    expect(out).toContain('install-deps');
    expect(out).toContain('Install dependencies');
    expect(out).toContain('push-to-github');
    expect(out).toContain('hex setup');
  });

  it('omits done tasks from the list, but reflects them in the count', () => {
    let checklist = checklistFromTasks([
      { id: 'a', title: 'Done one' },
      { id: 'b', title: 'Pending one' },
    ]);
    checklist = markTask(checklist, 'a', 'done');
    const out = formatSetupSection({ path: fakePath, rootDir: fakeRoot, checklist });
    expect(out).not.toBeNull();
    expect(out).toContain('1 pending, 1 done');
    expect(out).toContain('Pending one');
    expect(out).not.toContain('Done one');
  });
});
