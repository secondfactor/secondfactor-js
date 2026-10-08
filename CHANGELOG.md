# Changelog

All notable changes to `@secondfactor/js` are recorded here. The project
follows [Semantic Versioning](https://semver.org/).

## 0.1.0 — unreleased

The first release on npm. Before it, this library was a TypeScript file
downloaded from the secondfactor.ai dashboard as `@secondfactor/otp`.

### Added

- Session mode: `SecondFactor.withSession(clientToken)` sends, resends and
  checks codes for a headless verification session your server created, with
  no proxy and no API key in the browser. `status()` and `cancel()` too.
- `SecondFactorError.code` is one documented set of stable strings, and a
  session error carries the session's `state`.
- A per-press `Idempotency-Key` on every send, so a retried request sends at
  most one code.
- Built to ESM and CommonJS, with type declarations for both.

### Changed

- Renamed from `@secondfactor/otp` to `@secondfactor/js`.
- Proxy mode: `check(sid, code)` resolves with the verification and a
  `verified` boolean, and throws `expired`, `locked` or `already_verified` for
  a verification that can never succeed.

### Deprecated

- Proxy mode's `start` and `verify`: use `send` and `check`.
