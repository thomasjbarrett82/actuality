# Branch protection for `main`

Apply these settings in GitHub (Settings ▸ Branches ▸ Add rule for `main`), as `02` §5.1 requires:

- Require a pull request before merging. Squash merging only, so the pull request title becomes the commit (`21` §4.6).
- Require status checks to pass before merging: `check`, `test` (all three OS), `integration` (both server versions) and `build` (all three OS). Require branches to be up to date.
- Do not allow bypassing the above settings, including for administrators.
- Block force pushes and deletions.

With the GitHub CLI, the same rule is:

```sh
gh api -X PUT repos/{owner}/{repo}/branches/main/protection --input .github/branch-protection.json
```
