# Security policy

## Reporting a vulnerability

Please do not report security vulnerabilities through public GitHub issues,
discussions or pull requests.

Report them privately through GitHub instead: open the **Security** tab of this
repository and choose **Report a vulnerability**. Include the affected version,
a description of the issue, and the steps to reproduce it.

We will acknowledge the report, keep you informed while we work on a fix, and
credit you in the release notes unless you would prefer not to be named.

## Supported versions

Security fixes are released for the latest published version only.

## Verifying a release

The first release, 0.1.0, was published by hand by a maintainer, because npm
cannot trust a workflow for a package that does not exist yet. Every later
release is built and published by the `publish` workflow in this repository
through npm trusted publishing, and carries a signed npm provenance statement
that links the tarball to the exact workflow run and commit that produced it.
The package refuses token-based publishing entirely, so no release can come
from a personal machine.

To check the packages you have installed, run:

```bash
npm audit signatures
```

It verifies the registry signature of every installed package and the
provenance attestation of those that have one. The provenance of each release
is also shown on its page on npmjs.com.
