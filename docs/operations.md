# Operations

Step-by-step instructions for routine work on this repository. The rules behind each step are in the spec
(`docs/app-spec/`), which wins where the two disagree.

## Writing a blog post

Posts are in `website/blog/` and are written for users. Release posts are written by the release workflow
(see [Cutting a release](#cutting-a-release)), so these steps are for any other post. A pull request that
only adds or changes a post needs no spec or guide change. The full rules are in `02` §3.1
(`docs/app-spec/02-architecture.md`).

1. On a branch, create `website/blog/YYYY-MM-DD-{slug}.md`:

   ```markdown
   ---
   title: Your title
   slug: your-slug
   date: 2026-11-20T15:00:00Z
   tags: [announcement]
   in_app_notification: true
   ---

   A paragraph or two: the excerpt on the blog index, and the body of the news feed entry.

   <!-- truncate -->

   The rest of the post.
   ```

   - The `<!-- truncate -->` line is required: the site build fails without it.
   - Every tag must be declared in `website/blog/tags.yml`. Don't use `release`: that tag is for release
     posts and needs a `release-X.Y.Z` slug.
   - Leave out `authors`. The site build fails on an author written in the post.
   - `date` needs a time and a zone (`Z` or an offset such as `+02:00`), and must not be the same second as
     another post's.
   - `in_app_notification: true` puts the post in the news feed. Leave it out for a post that only belongs
     on the website.
   - Put images in `website/static/img/blog/` and link them as `/img/blog/…`. Relative links to guide pages
     and other posts are fine: the feed turns them into full URLs. In the app an image shows as a link,
     labeled with its alt text, so give every image alt text that reads well on its own.
   - In a post with `in_app_notification: true`, don't use admonitions (`:::tip … :::`), relative image
     paths or MDX components: the app shows its Markdown without them, so they appear as plain text or
     go missing (`24` §4.6).

2. Run `npm run news:build` to regenerate `website/static/news.json`. Never edit that file by hand.
3. Run `npm run check`, then `npm run docs:site:build` (after `npm --prefix website ci` once). `check`
   doesn't build the site, and the site build is what fails on a missing truncate marker or an undeclared
   tag; CI's `website` job builds it too. Use `npm run docs:site` to preview the post. To preview it in the
   app's Notifications dialog, start the app with `ACTUAL_DESKTOP_NEWS_URL` set to the full path of
   `website/static/news.json` (development builds only, `24` §4.2); set `lastSeenNewsAt` in the
   development `settings.json` to an earlier time to see it as unread.
4. Commit the post and `news.json` together and open a pull request with a Conventional Commits title,
   e.g. `docs: blog post about …`.
5. Merge it. The merge to `main` runs `docs-deploy.yml`, which publishes the post, the RSS feed
   (`/blog/rss.xml`) and the news feed (`/news.json`).

To change a published post, edit it and run `npm run news:build` again, in a pull request like any other.
Don't change a published post's `slug` or `date`: the slug is its URL and its feed id, and readers use the
date to decide what's unread.

## Cutting a release

A release is cut from GitHub; nothing runs on your machine. The workflows are `release.yml` and the
`release` job of `ci.yml`, described in `02` §5.1.

Before the first release, the repository needs the `RELEASE_TOKEN` secret: a personal access token that can
push branches and open pull requests. The release pull request is opened with it because GitHub runs no
workflows for a pull request opened with `GITHUB_TOKEN`, so its required checks would never start. Signed
Windows installers also need the SignPath settings (see [Windows code signing](#windows-code-signing));
without them the release's Windows installers are unsigned.

1. **Start it.** Actions ▸ **Release** ▸ **Run workflow**, on `main`, choosing `patch`, `minor` or `major`.
   The workflow:
   - bumps the version in `package.json` and the lockfile, and writes the version's `CHANGELOG.md` section
     from the Conventional Commits since the last tag;
   - writes the release's blog post (`website/blog/{date}-release-{version}.md`) from that section, and
     regenerates the news feed;
   - pushes all of it as one commit to `release/v{version}` and opens the pull request
     `chore: release v{version}` with auto-merge on.
2. **Let the release pull request merge.** It merges by itself (squash) when its required checks pass.
   Don't merge other pull requests while it's open: a change merged after the release pull request was
   opened but before it merged ends up in neither changelog section.
3. **Approve the Windows signing request.** Once SignPath is set up, the Windows `build` job of the CI run
   on `main` for the merge submits the installers to SignPath and waits up to an hour. Open the request in
   SignPath (the job's log links it, or SignPath emails the approvers), check that it comes from this run
   on `main` and names this version, and approve it.
4. **Wait for the draft.** The CI run on `main` for the merge runs every job plus E2E, then its `release`
   job tags the commit `v{version}` and drafts the GitHub release with the 12 installers and the version's
   changelog section as its notes. The run's summary says "Draft release v{version} is ready". The merge
   also publishes the website, so the release post and its news feed entry are live from here on, before
   the release is.
5. **Finish the checklist and publish.** Do the **Release** items of the checklist in
   [`release-checklist.md`](release-checklist.md), record the results in the draft's notes, and publish
   the draft.
6. **Write the highlights.** In a pull request, replace the release post's one-line summary (above the
   `<!-- release-details -->` line) with hand-written highlights: what users will notice, linking to the
   guide pages that describe it. Keep the post's `date`. Run `npm run news:build` and commit the feed with
   the post.

### When something goes wrong

- **The workflow stops with "v{version} is already tagged".** That version was released already; the
  version in `package.json` on `main` is behind its tags. Fix that before running the workflow again.
- **The release pull request's checks fail.** Nothing is tagged or released yet. Close the pull request and
  delete its `release/v{version}` branch, fix the problem on `main` in a pull request, then start the
  release again.
- **The CI run for the release merge fails.** The version is merged but not tagged. A failure that wasn't
  caused by the change (a timeout, a download that failed) can be fixed by re-running the failed jobs: the
  `release` job reuses an existing tag on the same commit and an existing draft, uploading the installers
  again. It refuses to run when the tag is on another commit.
- **The Windows signing step fails or times out** (nobody approved within the hour, or the request was
  denied). Re-run the failed `build` job: it builds again and submits a new signing request. Approve that
  one.

## Windows code signing

The Windows installers are signed through [SignPath Foundation](https://signpath.org), which signs
open-source projects for free with its own certificate. The rules are in `02` §5. The CI side is in
`ci.yml` (the `build` job) and does nothing until the repository has the settings in step 3.

1. **Apply.** Fill in the application on signpath.org. The project meets the terms as they stand: an MIT
   license, a public repository, builds on GitHub Actions, published releases, and the
   [code signing policy](https://actualitydesktop.org/code-signing-policy) page
   (`website/src/pages/code-signing-policy.md`), linked from the site's footer and from every release.
   Turn on multi-factor authentication for every team member, on GitHub and on SignPath.
2. **Set up the SignPath project** once SignPath Foundation approves it. The names must match `ci.yml`:
   - Project slug `actuality`, with this GitHub repository as its trusted build system.
   - Artifact configuration `windows-installers`: paste
     `.signpath/artifact-configurations/windows-installers.xml`.
   - Signing policy `release-signing`, with the SignPath Foundation certificate and the approvers named on
     the code signing policy page.
   - A CI user for GitHub Actions, allowed to submit to that policy. Copy its API token.
3. **Add the repository settings** (Settings ▸ Secrets and variables ▸ Actions):
   - Secret `SIGNPATH_API_TOKEN`: the CI user's API token.
   - Variable `SIGNPATH_ORGANIZATION_ID`: the organization ID from SignPath's organization settings.
4. **Release.** The next release signs its Windows installers (step 3 of
   [Cutting a release](#cutting-a-release)). Afterwards, check a downloaded installer in PowerShell:
   `Get-AuthenticodeSignature .\Actuality-Windows-{version}-x64.exe` shows `Valid`, signed by SignPath
   Foundation. Windows SmartScreen may still warn for a while: its reputation for a publisher builds up as
   people download the installers.

Keep the policy page true: update it when the team changes, or when Actuality starts sending anything new
over the network. When `.signpath/artifact-configurations/windows-installers.xml` changes, paste it into
SignPath again.
