# Releasing

Releases are published to npm as `@secondfactor/js` by the `publish` GitHub
Actions workflow. The workflow never runs on its own: a maintainer starts it by
hand from the Actions tab, and it publishes only from `main`. The very first
release is the exception, and is published by hand as described below.

## Prerequisites

- The `secondfactor` organization exists on npm, which owns the
  `@secondfactor` scope.
- The account that publishes the first release is a member of that
  organization with publish rights, and has two-factor authentication turned
  on for its account.

## The first release, by hand

npm cannot configure trusted publishing for a package that does not exist yet,
so the first version is published from a maintainer's machine, once:

1. Sign in: `npm login`.
2. Make a clean checkout of `main`, with nothing uncommitted:

   ```bash
   git clone https://github.com/secondfactor/secondfactor-js.git
   cd secondfactor-js
   npm ci
   ```

3. Check exactly what will be published: `npm pack --dry-run`. The list must be
   the four files under `dist/` (`index.js`, `index.cjs`, `index.d.ts`,
   `index.d.cts`), `README.md`, `CHANGELOG.md`, `LICENSE` and `package.json`,
   and nothing else.
4. Publish: `npm publish --access public`. `prepublishOnly` type-checks, builds
   and tests first, so a failing build cannot be published.
5. Tag the commit and push the tag: `git tag v<version> && git push origin
   v<version>`.

Then, straight away, make the workflow the only way to publish:

6. Configure the trusted publisher. On npmjs.com, open the package's
   **Settings**, and under **Trusted Publisher** choose GitHub Actions with
   owner `secondfactor`, repository `secondfactor-js`, workflow filename
   `publish.yml` and environment `npm`. Alternatively, with npm 11.15.0 or
   later and two-factor authentication on the account:

   ```bash
   npm trust github @secondfactor/js --repo secondfactor/secondfactor-js --file publish.yml --env npm --allow-publish
   ```

   A newly created trusted publisher must complete its first successful
   publish within two days, or it has to be created again.
7. Under **Settings → Publishing access**, choose **Require two-factor
   authentication and disallow tokens**. Trusted publishing keeps working;
   every token, including any created by mistake later, can no longer publish.

No npm token exists for this package, and none should be created.

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

## Each later release

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
