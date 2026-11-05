import type { ESLint } from 'eslint';
import { actualApiImport } from './actual-api-import';
import { noFloatMoney } from './no-float-money';

/** Local ESLint plugin with the project rules (21 §4.1). */
export const localPlugin: ESLint.Plugin = {
  meta: { name: 'local' },
  // typescript-eslint's RuleModule and ESLint's RuleDefinition describe the same runtime shape.
  rules: {
    'actual-api-import': actualApiImport,
    'no-float-money': noFloatMoney,
  } as unknown as ESLint.Plugin['rules'],
};
