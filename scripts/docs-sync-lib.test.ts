import { describe, expect, it } from 'vitest';
import type { DocFile } from './docs-check-lib';
import {
  checkSync,
  fragmentsOf,
  messageValues,
  NO_GUIDE_IMPACT,
  type SyncInput,
} from './docs-sync-lib';

const budgetPage: DocFile = {
  path: 'website/docs/budget.md',
  text: "---\nspec: ['09']\n---\n# Budget\n\nSelect **Hold for next month…**.\n",
};

const input = (over: Partial<SyncInput>): SyncInput => ({
  changed: [],
  messages: ['docs: a change'],
  guides: [budgetPage],
  docs: [budgetPage],
  stringsBefore: [],
  stringsAfter: [],
  ...over,
});

describe('docs-sync', () => {
  it('reads every string of a nested bundle', () => {
    expect(messageValues({ a: 'One', b: { c: 'Two', d: 3 } })).toEqual(['One', 'Two']);
  });

  it('splits a message into its long literal parts', () => {
    expect(fragmentsOf('Deleted {n} transaction | Deleted {n} transactions')).toEqual([
      'transaction',
      'transactions',
    ]);
    expect(fragmentsOf('Hold for next month…')).toEqual(['Hold for next month…']);
    expect(fragmentsOf('{name} ok')).toEqual([]);
  });

  it('asks for a guide change when a user-facing chapter changes', () => {
    const problems = checkSync(input({ changed: ['docs/app-spec/09-budget-screen.md'] }));
    expect(problems.map((p) => p.message)).toEqual([
      'chapter 09 changed, but no user guide page that describes it did (website/docs/budget.md). ' +
        `Update the guide, or add the line "${NO_GUIDE_IMPACT}" to a commit message if users see no difference.`,
    ]);
  });

  it('accepts a guide change, the trailer, or a change to an internal chapter', () => {
    const changed = ['docs/app-spec/09-budget-screen.md'];
    expect(checkSync(input({ changed: [...changed, budgetPage.path] }))).toEqual([]);
    expect(checkSync(input({ changed, messages: [`fix: x\n\n${NO_GUIDE_IMPACT}\n`] }))).toEqual([]);
    expect(checkSync(input({ changed: ['docs/app-spec/05-visual-design-system.md'] }))).toEqual([]);
  });

  it('reports docs that still quote a removed or reworded UI string', () => {
    const problems = checkSync(
      input({
        stringsBefore: ['Hold for next month…', 'Done'],
        stringsAfter: ['Set aside for next month…', 'Done'],
      }),
    );
    expect(problems.map((p) => `${p.path}:${p.line}: ${p.message}`)).toEqual([
      'website/docs/budget.md:6: quotes "Hold for next month…", which is no longer in the English UI strings',
    ]);
  });

  it("doesn't report text that is still part of a current string", () => {
    expect(
      checkSync(
        input({
          stringsBefore: ['Hold for next month…'],
          stringsAfter: ['Hold for next month… (advanced)'],
        }),
      ),
    ).toEqual([]);
  });
});
