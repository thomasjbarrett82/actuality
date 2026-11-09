// The User Guide sidebar, in reading order.
import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  guide: [
    'intro',
    {
      type: 'category',
      label: 'Getting started',
      collapsed: false,
      items: [
        'getting-started/connect-to-your-server',
        'getting-started/open-or-create-a-budget',
        'getting-started/finding-your-way-around',
        'getting-started/quick-start',
      ],
    },
    {
      type: 'category',
      label: 'Budgets',
      items: [
        'budgets/the-budget-screen',
        'budgets/budgeting-money',
        'budgets/categories',
        'budgets/overspending',
        'budgets/managing-budgets',
      ],
    },
    {
      type: 'category',
      label: 'Accounts and transactions',
      items: [
        'accounts-and-transactions/accounts',
        'accounts-and-transactions/the-register',
        'accounts-and-transactions/entering-transactions',
        'accounts-and-transactions/splits-and-transfers',
        'accounts-and-transactions/working-with-transactions',
        'accounts-and-transactions/searching',
        'accounts-and-transactions/scheduled-transactions',
        'accounts-and-transactions/reconciling',
        'accounts-and-transactions/importing-and-exporting',
        'accounts-and-transactions/payees-and-rules',
      ],
    },
    {
      type: 'category',
      label: 'Reports',
      items: ['reports/overview', 'reports/the-reports', 'reports/money-age'],
    },
    {
      type: 'category',
      label: 'Troubleshooting',
      items: ['troubleshooting/connection-problems', 'troubleshooting/fixing-budget-problems'],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/keyboard-shortcuts',
        'reference/preferences',
        'reference/updates-and-news',
      ],
    },
  ],
};

export default sidebars;
