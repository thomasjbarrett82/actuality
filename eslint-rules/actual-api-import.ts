import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from '@typescript-eslint/utils';

const createRule = ESLintUtils.RuleCreator((name) => `docs/app-spec/02-architecture.md#${name}`);

const API = '@actual-app/api';
const isApi = (source: string): boolean => source === API || source.startsWith(`${API}/`);

/**
 * `src/host/actual.ts` is the only module that may load `@actual-app/api`, and only with a dynamic
 * `import()` after it installs the fetch timeout wrapper: the API reads `globalThis.fetch` once, at
 * load (02 §5, 03 §3). Type-only imports are allowed in actual.ts, because they are erased.
 */
export const actualApiImport = createRule({
  name: 'actual-api-import',
  meta: {
    type: 'problem',
    docs: { description: 'Restrict how and where @actual-app/api is loaded' },
    schema: [],
    messages: {
      outside: '@actual-app/api may only be loaded in src/host/actual.ts.',
      static:
        'Load @actual-app/api with a dynamic import() after the fetch wrapper is installed, never with a static import.',
    },
  },
  defaultOptions: [],
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    const inActualTs = /(^|\/)src\/host\/actual\.ts$/.test(filename);

    const check = (
      node: TSESTree.Node,
      source: string,
      typeOnly: boolean,
      dynamic: boolean,
    ): void => {
      if (!isApi(source)) return;
      if (!inActualTs) context.report({ node, messageId: 'outside' });
      else if (!dynamic && !typeOnly) context.report({ node, messageId: 'static' });
    };

    return {
      ImportDeclaration(node) {
        const typeOnly =
          node.importKind === 'type' ||
          (node.specifiers.length > 0 &&
            node.specifiers.every(
              (s) => s.type === AST_NODE_TYPES.ImportSpecifier && s.importKind === 'type',
            ));
        check(node, node.source.value, typeOnly, false);
      },
      ExportNamedDeclaration(node) {
        if (node.source) check(node, node.source.value, node.exportKind === 'type', false);
      },
      ExportAllDeclaration(node) {
        check(node, node.source.value, node.exportKind === 'type', false);
      },
      ImportExpression(node) {
        if (node.source.type === AST_NODE_TYPES.Literal && typeof node.source.value === 'string') {
          check(node, node.source.value, false, true);
        }
      },
      TSImportType(node) {
        if (typeof node.source.value === 'string') check(node, node.source.value, true, false);
      },
    };
  },
});
