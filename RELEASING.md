# Releasing

Releases are published to npm as `@secondfactor/js` by the `publish` GitHub
Actions workflow. The workflow never runs on its own: a maintainer starts it by
hand from the Actions tab, and it publishes only from `main`.

## How the repository is protected

These settings live on GitHub rather than in this repository, so they are
recorded here. Keep them in place; the release process depends on them.

- **`main`** accepts changes only through a pull request whose `ci` check has
  passed on every supported Node.js version (22, 24 and 26), with every review
  thread resolved and the branch up to date. Only squash and rebase merges are
  allowed. Force-pushes and deletion are blocked, and nobody can bypass the
  rule.
- **Tags** cannot be moved or deleted once created, so a release tag always
  names the commit that was published.
- **The `npm` environment** deploys only from `main` and waits for a required
  reviewer to approve each publish. Administrators cannot bypass it.
- **Actions** may use only GitHub's own actions, each pinned to a full commit
  SHA. Workflows from outside contributors wait for approval before they run.
- **Releases** are immutable once published.
- **Secret scanning** with push protection, **Dependabot** alerts and security
  updates, and **private vulnerability reporting** are on.

npm must trust the workflow: on the `@secondfactor/js` package, under
**Settings → Trusted Publisher**, a GitHub Actions publisher names owner
`secondfactor`, repository `secondfactor-js`, workflow `publish.yml` and
environment `npm`. Keep **Settings → Publishing access** on **Require
two-factor authentication and disallow tokens**, so that only the workflow can
publish. No npm token exists for this package, and none should be created.

## Each release

1. Choose the version under [Semantic Versioning](https://semver.org/). Set it
   in **both** `package.json` (`npm version <version> --no-git-tag-version`
   does this) and `src/index.ts` (`VERSION`); they must match, because
   `VERSION` is what the `X-SF-Client` header reports. The workflow refuses to
   publish when they differ.
2. Move the `unreleased` heading in `CHANGELOG.md` to the version and today's
   date.
3. Open a pull request titled `chore: release <version>` and merge it once
   `ci` is green.
4. Open **Actions → publish → Run workflow** and run it on `main`. The workflow
   runs the full test matrix again, checks that the two versions agree and
   that the version has not been tagged before, and builds and packs the
   package.
5. Approve the `npm` deployment when GitHub asks. The workflow then publishes
   to npm with provenance and creates the `v<version>` tag.
6. Create a GitHub release from the new tag, pasting the changelog section.
   Releases are immutable once published.

A published version can never be published again with different contents. If
a release is broken, deprecate it with `npm deprecate` and publish the next
patch version.
