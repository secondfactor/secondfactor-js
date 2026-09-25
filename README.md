# secondfactor.ai OTP — React Native / Web (TypeScript)

Talks to **your backend proxy**, never to secondfactor.ai directly — your
API key stays server-side. See [../README.md](../README.md) for the 3-endpoint
proxy contract.

## Usage

```ts
import { SecondFactor } from "@secondfactor/otp";

const sf = new SecondFactor("https://api.yourapp.com/auth/otp");

let requestId = await sf.start("+9779841000001");
if (await sf.verify(requestId, code)) { /* create session */ }

// resend button: enable when sf.resendAvailableIn === 0
requestId = await sf.resend(requestId); // a resend is a new sid: verify against it
```

Works in React Native, Expo, and any browser (uses `fetch`). No dependencies.

## Errors

`verify` returns `false` for a wrong code the user can retry. Everything else
throws a `SecondFactorError` / `SecondFactorException` carrying secondfactor.ai's
`message`, the HTTP `status`, and a `code` to branch on: an error slug such as
`rate_limited`, `burst`, `unreachable` or `blocked_by_policy`, or — when a
verification can no longer be approved — the state it ended in (`EXPIRED`,
`LOCKED`, `VERIFIED`), where only a resend helps. Show `message` to users.
