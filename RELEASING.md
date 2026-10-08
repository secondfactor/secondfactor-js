# Releasing

Releases are published by hand from this repository to npm as
`@secondfactor/js`. Only members of the `@secondfactor` npm organization with
publish rights can publish.

## One-time setup

1. Have an npm account with two-factor authentication on, added to the
   `@secondfactor` organization.
2. `npm login`

## Each release

1. Make sure `main` is green in CI, and `npm run typecheck` and `npm test` pass
   locally.
2. Choose the version under [Semantic Versioning](https://semver.org/). Set it
   in **both** `package.json` (`version`) and `src/index.ts` (`VERSION`); they
   must match, because `VERSION` is what the `X-SF-Client` header reports.
3. Move the `unreleased` heading in `CHANGELOG.md` to the version and today's
   date.
4. Commit: `chore: release <version>`.
5. Check exactly what will be published: `npm pack --dry-run`. The list must be
   the four files under `dist/` (`index.js`, `index.cjs`, `index.d.ts`,
   `index.d.cts`), `README.md`, `CHANGELOG.md`, `LICENSE` and `package.json`,
   and nothing else.
6. Publish: `npm publish --access public`. A scoped package is private unless
   `--access public` is given. `prepublishOnly` type-checks, builds and tests
   first, so a failing build cannot be published.
7. Tag and push: `git tag v<version> && git push origin main v<version>`.
8. Create a GitHub release from the tag, pasting the changelog section.

A published version can never be published again with different contents. If a
release is broken, deprecate it with `npm deprecate` and publish the next patch
version.
