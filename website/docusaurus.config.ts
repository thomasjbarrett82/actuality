// Docusaurus config for the Actuality user guide. The site is static: `npm run build` writes it to build/.
import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';

const repoUrl = 'https://github.com/thomasjbarrett82/actuality';

const config: Config = {
  title: 'Actuality',
  tagline: 'Potential made actual',
  favicon: 'actuality-icon.svg',

  // Where the site is published.
  url: 'https://actualitydesktop.org',
  baseUrl: '/',
  projectName: 'actuality',
  organizationName: 'thomasjbarrett82',
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
        // Release notes and announcements (02 §3.1). Posts with `in_app_notification: true` also go into the
        // news feed, static/news.json, which `npm run news:build` (in the repo root) writes from them.
        blog: {
          path: 'blog',
          routeBasePath: 'blog',
          blogTitle: 'Actuality blog',
          blogDescription: 'Release notes and announcements for Actuality.',
          blogSidebarTitle: 'Recent posts',
          blogSidebarCount: 'ALL',
          showReadingTime: false,
          editUrl: `${repoUrl}/edit/main/website/`,
          tags: 'tags.yml',
          onInlineTags: 'throw',
          onInlineAuthors: 'throw',
          onUntruncatedBlogPosts: 'throw',
          feedOptions: {
            type: 'rss',
            title: 'Actuality blog',
            description: 'Release notes and announcements for Actuality.',
            copyright: 'Copyright © 2026 the Actuality contributors.',
            language: 'en',
          },
        },
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
        { to: '/blog', position: 'left', label: 'Blog' },
        { href: `${repoUrl}/releases`, position: 'left', label: 'Downloads' },
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
            { label: 'Blog', to: '/blog' },
            // A static file, not a page: pathname:// keeps the router and the broken-link check off it.
            { label: 'RSS feed', href: 'pathname:///blog/rss.xml' },
            { label: 'Source code', href: repoUrl },
            { label: 'Report a problem', href: `${repoUrl}/issues` },
            // SignPath Foundation's terms ask for this link on the home page (02 §5).
            { label: 'Code signing policy', to: '/code-signing-policy' },
            { label: 'Privacy policy', to: '/privacy' },
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
