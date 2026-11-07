import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Heading from '@theme/Heading';
import Layout from '@theme/Layout';
import ThemedImage from '@theme/ThemedImage';
import type { ReactNode } from 'react';
import styles from './index.module.css';

interface Feature {
  title: string;
  description: string;
  to: string;
}

const features: Feature[] = [
  {
    title: 'Envelope budgeting',
    description:
      'Give every dollar a job, month by month. Budgeted, Outflows and Balance for each category, the Available to Budget math in the month header, Quick Budget and a built-in calculator.',
    to: '/docs/budgets/the-budget-screen',
  },
  {
    title: 'A fast, keyboard-friendly register',
    description:
      'Inline editing, splits, transfers, payee auto-fill, tags, cleared and reconciled states, a search language, undo and reconciliation against your statement.',
    to: '/docs/accounts-and-transactions/the-register',
  },
  {
    title: 'Scheduled transactions',
    description:
      "Recurring bills and paychecks are posted by Actual's own schedule service, so they stay in step with every other Actual app you use.",
    to: '/docs/accounts-and-transactions/scheduled-transactions',
  },
  {
    title: 'Reports',
    description:
      'Summary, Spending Breakdown, Spending Comparison, Inflow vs Outflow and Net Worth, with linked filters, saved filters, Money Age, CSV exports, and Print.',
    to: '/docs/reports/overview',
  },
  {
    title: 'Import and export',
    description:
      'Import OFX, QFX, QIF and CSV files from your bank with duplicate detection. Export to CSV or QIF, print, and save budget backups.',
    to: '/docs/accounts-and-transactions/importing-and-exporting',
  },
  {
    title: 'Safe when offline',
    description:
      "Everything is saved to your Actual server as you go. When the server can't be reached, Actuality shows your budget read-only and tells you why.",
    to: '/docs/troubleshooting/connection-problems',
  },
];

function Hero(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={styles.hero}>
      <div className="container">
        <img className={styles.heroIcon} src={useBaseUrl('/actuality-icon.svg')} alt="" />
        <Heading as="h1" className={styles.heroTitle}>
          {siteConfig.title}
        </Heading>
        <p className={styles.heroTagline}>{siteConfig.tagline}</p>
        <ThemedImage
          className={styles.heroScreenshot}
          sources={{
            light: useBaseUrl('/img/home/demo-budget-light.png'),
            dark: useBaseUrl('/img/home/demo-budget-dark.png'),
          }}
          alt="Actuality's budget screen, with categories down the left and Budgeted, Outflows and Balance for each month"
        />
        <p className={styles.heroText}>
          A desktop app for Windows, macOS and Linux that works with budgets stored on an Actual
          Budget server.
        </p>
        <div className={styles.heroButtons}>
          <Link className="button button--secondary button--lg" to="/docs/intro">
            Read the User Guide
          </Link>
          <Link
            className={`button button--lg ${styles.heroOutlineButton}`}
            to="/docs/getting-started/quick-start"
          >
            Quick start
          </Link>
        </div>
      </div>
    </header>
  );
}

function Features(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {features.map((f) => (
            <div key={f.title} className="col col--4">
              <div className={styles.feature}>
                <Heading as="h2" className={styles.featureTitle}>
                  <Link to={f.to}>{f.title}</Link>
                </Heading>
                <p>{f.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="User Guide"
      description="How to use Actuality, a desktop envelope-budgeting app for Actual Budget servers."
    >
      <Hero />
      <main>
        <Features />
      </main>
    </Layout>
  );
}
