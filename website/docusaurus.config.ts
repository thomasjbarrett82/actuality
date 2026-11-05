// Docusaurus config for the Actuality user guide. The site is static: `npm run build` writes it to build/.
import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';

const repoUrl = 'https://github.com/thomasjbarrett82/actual-desktop';

const config: Config = {
  title: 'Actuality',
  tagline: 'Potential made actual',
  favicon: 'actuality-icon.svg',

  // Where the site is published. A project site on GitHub Pages lives under /actual-desktop/; with a
  // custom domain, set url to that domain and baseUrl to '/'.
  url: 'https://thomasjbarrett82.github.io',
  baseUrl: '/actual-desktop/',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: {
    hooks: { onBrokenMarkdownLinks: 'throw', onBrokenMarkdownImages: 'throw' },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  // The app's own icon files, served from the site root, so the site's branding never drifts from the app's.
  staticDirectories: ['static', '../resources/icons/svg'],

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: 'docs',
          sidebarPath: './sidebars.ts',
          editUrl: `${repoUrl}/edit/main/website/`,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Actuality',
      logo: {
        alt: 'Actuality logo',
        src: 'actuality-logo-light.svg',
        srcDark: 'actuality-logo-dark.svg',
      },
      items: [
        { type: 'docSidebar', sidebarId: 'guide', position: 'left', label: 'User Guide' },
        { to: '/docs/reference/keyboard-shortcuts', position: 'left', label: 'Keyboard Shortcuts' },
        {
          to: '/docs/troubleshooting/connection-problems',
          position: 'left',
          label: 'Troubleshooting',
        },
        { href: repoUrl, position: 'right', label: 'Source code' },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Get started',
          items: [
            { label: 'Introduction', to: '/docs/intro' },
            { label: 'Connect to your server', to: '/docs/getting-started/connect-to-your-server' },
            {
              label: 'Open or create a budget',
              to: '/docs/getting-started/open-or-create-a-budget',
            },
          ],
        },
        {
          title: 'Help',
          items: [
            { label: 'Keyboard shortcuts', to: '/docs/reference/keyboard-shortcuts' },
            { label: 'Connection problems', to: '/docs/troubleshooting/connection-problems' },
            { label: 'Fixing budget problems', to: '/docs/troubleshooting/fixing-budget-problems' },
          ],
        },
        {
          title: 'Project',
          items: [
            { label: 'Source code', href: repoUrl },
            { label: 'Report a problem', href: `${repoUrl}/issues` },
            { label: 'Actual Budget documentation', href: 'https://actualbudget.org/docs/' },
          ],
        },
      ],
      copyright: `Copyright © 2026 the Actuality contributors. Released under the MIT License. Actuality isn't affiliated with or endorsed by the Actual Budget project.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
