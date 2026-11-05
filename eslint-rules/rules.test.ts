import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, it } from 'vitest';
import { actualApiImport } from './actual-api-import';
import { noFloatMoney } from './no-float-money';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      projectService: { allowDefaultProject: ['*.ts', 'src/host/*.ts', 'src/renderer/*.ts'] },
      tsconfigRootDir: import.meta.dirname,
    },
  },
});

const money = 'type Money = number;\n';

ruleTester.run('no-float-money', noFloatMoney, {
  valid: [
    `${money}const a: Money = 100; const b: Money = 200; const c = a + b; const n = c * 2;`,
    `${money}const parsed: number = parseFloat('1.5');`,
    `const ratio = 10 / 4;`,
    `${money}interface T { amount: Money; count: number } declare const t: T; const x = t.count / 2;`,
  ],
  invalid: [
    {
      code: `${money}const a: Money = 100; const half = a / 2;`,
      errors: [{ messageId: 'operand' }],
    },
    { code: `${money}const a: Money = 100; const n = +a;`, errors: [{ messageId: 'operand' }] },
    {
      code: `${money}const a: Money = 100; const n = parseFloat(a as unknown as string);`,
      errors: [{ messageId: 'operand' }],
    },
    {
      code: `${money}const a: Money = 100; const n = Number(a);`,
      errors: [{ messageId: 'operand' }],
    },
    { code: `${money}const a: Money = parseFloat('1.50');`, errors: [{ messageId: 'result' }] },
    {
      code: `${money}let a: Money | null = null; a = Number('2');`,
      errors: [{ messageId: 'result' }],
    },
    {
      code: `${money}interface T { amount: Money } declare const t: T; const x = t.amount / 100;`,
      errors: [{ messageId: 'operand' }],
    },
    {
      code: `${money}interface T { amount: Money } const t: T = { amount: Number.parseFloat('3') };`,
      errors: [{ messageId: 'result' }],
    },
  ],
});

ruleTester.run('actual-api-import', actualApiImport, {
  valid: [
    {
      code: `export async function load() { return import('@actual-app/api'); }`,
      filename: 'src/host/actual.ts',
    },
    {
      code: `import type { APIAccountEntity } from '@actual-app/api'; export type A = APIAccountEntity;`,
      filename: 'src/host/actual.ts',
    },
    {
      code: `import { join } from 'node:path'; export const j = join;`,
      filename: 'src/host/queue.ts',
    },
  ],
  invalid: [
    {
      code: `import * as api from '@actual-app/api'; export const a = api;`,
      filename: 'src/host/actual.ts',
      errors: [{ messageId: 'static' }],
    },
    {
      code: `import * as api from '@actual-app/api'; export const a = api;`,
      filename: 'src/host/queue.ts',
      errors: [{ messageId: 'outside' }],
    },
    {
      code: `export const p = import('@actual-app/api');`,
      filename: 'src/host/queue.ts',
      errors: [{ messageId: 'outside' }],
    },
    {
      code: `export type X = import('@actual-app/api').APIAccountEntity;`,
      filename: 'src/renderer/x.ts',
      errors: [{ messageId: 'outside' }],
    },
    {
      code: `export * from '@actual-app/api';`,
      filename: 'src/host/actual.ts',
      errors: [{ messageId: 'static' }],
    },
  ],
});
