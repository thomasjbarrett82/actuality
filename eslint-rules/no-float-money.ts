import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from '@typescript-eslint/utils';
import ts from 'typescript';

const createRule = ESLintUtils.RuleCreator((name) => `docs/app-spec/21-testing-quality.md#${name}`);

/**
 * Money is an integer in minor units and never a float (04 §1, 21 §4).
 *
 * `type Money = number` erases to `number`, so the rule recognizes money by the type annotation of the
 * symbol behind an expression: a variable, parameter or property declared as `Money` (or `Money | null`).
 * It reports, outside `shared/money.ts`:
 * - `parseFloat(x)`, `Number(x)`, unary `+x` and `x / y` where an operand is `Money`;
 * - `parseFloat(...)` / `Number(...)` whose result initializes or is assigned to something typed `Money`.
 */
export const noFloatMoney = createRule({
  name: 'no-float-money',
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow floating-point operations on Money values outside shared/money.ts',
    },
    schema: [],
    messages: {
      operand:
        'Money is an integer in minor units: use shared/money.ts instead of `{{op}}` on a Money value.',
      result:
        'Money is an integer in minor units: parse with shared/money.ts `parse()`, not `{{op}}`.',
    },
  },
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    const isMoneyTypeNode = (node: ts.TypeNode | undefined): boolean => {
      if (!node) return false;
      if (ts.isTypeReferenceNode(node)) return node.typeName.getText() === 'Money';
      if (ts.isUnionTypeNode(node)) return node.types.some(isMoneyTypeNode);
      if (ts.isParenthesizedTypeNode(node)) return isMoneyTypeNode(node.type);
      return false;
    };

    const declaredAsMoney = (decl: ts.Declaration): boolean => {
      if (
        ts.isVariableDeclaration(decl) ||
        ts.isParameter(decl) ||
        ts.isPropertySignature(decl) ||
        ts.isPropertyDeclaration(decl)
      ) {
        return isMoneyTypeNode(decl.type);
      }
      return false;
    };

    const isMoney = (expr: TSESTree.Node): boolean => {
      let node = expr;
      while (
        node.type === AST_NODE_TYPES.TSAsExpression ||
        node.type === AST_NODE_TYPES.TSNonNullExpression ||
        node.type === AST_NODE_TYPES.TSSatisfiesExpression
      ) {
        node = node.expression;
      }
      const tsNode = services.esTreeNodeToTSNodeMap.get(node);
      const target = ts.isPropertyAccessExpression(tsNode) ? tsNode.name : tsNode;
      const symbol = checker.getSymbolAtLocation(target);
      return symbol?.declarations?.some(declaredAsMoney) ?? false;
    };

    const callName = (node: TSESTree.CallExpression): string | null => {
      const c = node.callee;
      if (c.type === AST_NODE_TYPES.Identifier && (c.name === 'parseFloat' || c.name === 'Number'))
        return c.name;
      if (
        c.type === AST_NODE_TYPES.MemberExpression &&
        c.object.type === AST_NODE_TYPES.Identifier &&
        c.object.name === 'Number' &&
        c.property.type === AST_NODE_TYPES.Identifier &&
        c.property.name === 'parseFloat'
      ) {
        return 'Number.parseFloat';
      }
      return null;
    };

    const flowsIntoMoney = (node: TSESTree.Node): boolean => {
      const parent = node.parent;
      if (!parent) return false;
      if (parent.type === AST_NODE_TYPES.VariableDeclarator && parent.init === node)
        return isMoney(parent.id);
      if (parent.type === AST_NODE_TYPES.AssignmentExpression && parent.right === node)
        return isMoney(parent.left);
      if (
        parent.type === AST_NODE_TYPES.Property &&
        parent.value === node &&
        parent.parent.type === AST_NODE_TYPES.ObjectExpression
      ) {
        const tsNode = services.esTreeNodeToTSNodeMap.get(parent);
        const contextual = checker.getContextualType(
          services.esTreeNodeToTSNodeMap.get(parent.parent),
        );
        if (!contextual || !ts.isPropertyAssignment(tsNode)) return false;
        const prop = contextual.getProperty(tsNode.name.getText());
        return prop?.declarations?.some(declaredAsMoney) ?? false;
      }
      return false;
    };

    return {
      CallExpression(node) {
        const name = callName(node);
        if (!name) return;
        const arg = node.arguments[0];
        if (arg && arg.type !== AST_NODE_TYPES.SpreadElement && isMoney(arg)) {
          context.report({ node, messageId: 'operand', data: { op: `${name}()` } });
        } else if (flowsIntoMoney(node)) {
          context.report({ node, messageId: 'result', data: { op: `${name}()` } });
        }
      },
      UnaryExpression(node) {
        if (node.operator === '+' && isMoney(node.argument)) {
          context.report({ node, messageId: 'operand', data: { op: 'unary +' } });
        }
      },
      BinaryExpression(node) {
        if (node.operator !== '/') return;
        if (isMoney(node.left) || isMoney(node.right)) {
          context.report({ node, messageId: 'operand', data: { op: '/' } });
        }
      },
    };
  },
});
