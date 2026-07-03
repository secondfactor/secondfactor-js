# secondfactor.ai OTP — React Native / Web (TypeScript)

Talks to **your backend proxy**, never to secondfactor.ai directly — your
API key stays server-side. See [../README.md](../README.md) for the 3-endpoint
proxy contract.

## Usage

```ts
import { SecondFactor } from "@secondfactor/otp";

const sf = new SecondFactor("https://api.yourapp.com/auth/otp");

const requestId = await sf.start("+9779841000001");
if (await sf.verify(requestId, code)) { /* create session */ }

// resend button: enable when sf.resendAvailableIn === 0
await sf.resend(requestId);
```

Works in React Native, Expo, and any browser (uses `fetch`). No dependencies.

## Errors

All methods throw a `SecondFactorException`/`SecondFactorError` carrying the
server `detail` message and optional `code` (`rate_limited`, `burst`,
`unreachable`, `blocked_by_policy`, ...). Show `detail` to users; branch on `code`.
