/**
 * secondfactor.ai for browsers and React Native. No dependencies.
 *
 * This library runs on the user's device, so it never holds your API key.
 * It has two modes.
 *
 * **Session mode (recommended).** Your server creates a headless verification
 * session with its API key (the `secondfactor` package on npm or PyPI) and
 * hands the session's client token to your frontend. The frontend sends and
 * checks codes for that one session, for the number your server fixed, and
 * nothing else:
 *
 *   const session = SecondFactor.withSession(clientToken);
 *   await session.send();
 *   const result = await session.check(code);  // { verified, attempts_remaining, … }
 *
 * Your server then confirms the session it stored, once, and acts on the
 * answer it gets there. Never treat `verified` in the browser as proof: any
 * code running in the browser can be changed by the user.
 *
 * **Proxy mode.** For apps already built on three endpoints of your own that
 * forward to secondfactor.ai (see the README):
 *
 *   const sf = new SecondFactor("https://api.yourapp.com/auth/otp");
 *   const sid = await sf.send("+9779841000001");
 *   const result = await sf.check(sid, code);
 *
 * Everything that is not a wrong code throws `SecondFactorError`, whose `code`
 * is a stable string to branch on.
 */

export const VERSION = "0.1.0";

/** Sent on every request. Browsers forbid setting `User-Agent`. */
export const CLIENT_HEADER = `secondfactor-js/${VERSION}`;

const DEFAULT_BASE_URL = "https://api.secondfactor.ai";
const HOSTED_PATH = "/api/hosted/session";
const DEFAULT_TIMEOUT_MS = 10_000;

export type SessionStatus = "OPEN" | "VERIFIED" | "CANCELED" | "FAILED" | "EXPIRED";

/** A session's state, as every session call returns it.
 *
 * `attempts_remaining` and `code_expires_at` describe the newest code and are
 * null until one is sent. `resend_available_in` is the number of seconds until
 * another send is allowed, for a "Resend in 27s" button, and `sends_remaining`
 * how many sends the session has left. */
export interface SessionState {
  status: SessionStatus;
  failure_reason: "max_sends" | "max_attempts" | "send_refused" | null;
  /** The channel the newest code went out on, such as `sms` or `whatsapp`. */
  channel: string | null;
  sends_remaining: number;
  resend_available_in: number;
  attempts_remaining: number | null;
  code_expires_at: string | null;
  expires_at: string;
}

export interface SendResult extends SessionState {
  /** False when the press fell inside the resend cooldown and sent nothing. */
  sent: boolean;
}

export interface CheckResult extends SessionState {
  /** True when the code was right. Confirm on your server before acting on it. */
  verified: boolean;
}

/** The verification your proxy passed through, with `verified` added. */
export interface Verification {
  sid: string;
  status: string;
  verified: boolean;
  [field: string]: unknown;
}

/**
 * The stable codes a `SecondFactorError` can carry. Other codes may be added
 * in later minor versions, so keep a default branch.
 *
 * - Session state, when a session can no longer do what was asked:
 *   `expired`, `canceled`, `already_verified`, `max_sends`, `max_attempts`,
 *   `send_refused`, and `code_expired` when no code is live and a resend is
 *   the way on.
 * - Proxy mode, when a verification can never succeed: `expired`, `locked`,
 *   `already_verified`.
 * - From the API: `invalid_parameter`, `unauthorized` (the session token is
 *   unknown or its grace period has passed), `rate_limited`, `not_found`,
 *   `permission_denied`.
 * - `network_error` when no answer arrived.
 */
export type ErrorCode =
  | "expired"
  | "canceled"
  | "already_verified"
  | "max_sends"
  | "max_attempts"
  | "send_refused"
  | "code_expired"
  | "locked"
  | "invalid_parameter"
  | "unauthorized"
  | "rate_limited"
  | "not_found"
  | "permission_denied"
  | "network_error"
  | (string & {});

/**
 * A request secondfactor.ai refused, or could not be reached for.
 *
 * `code` is the stable string to branch on (see `ErrorCode`), or null for an
 * answer with no recognisable body. `status` is the HTTP status, or null when
 * no answer arrived. A session error also carries the session's `state`, so
 * the screen can be redrawn from it. The message is written for developers;
 * show your users your own words.
 */
export class SecondFactorError extends Error {
  readonly code: ErrorCode | null;
  readonly status: number | null;
  readonly state: SessionState | null;

  constructor(message: string, code: ErrorCode | null = null, status: number | null = null, state: SessionState | null = null) {
    super(message);
    this.name = "SecondFactorError";
    this.code = code;
    this.status = status;
    this.state = state;
  }
}

export interface SessionOptions {
  /** The API origin. `https://api.secondfactor.ai` by default. */
  baseUrl?: string;
  /** Per request; 10 seconds by default. */
  timeoutMs?: number;
  /** A `fetch` to use instead of the global one. */
  fetch?: typeof fetch;
}

/** One headless verification session, reached with its client token. */
export class VerificationSession {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetch: typeof fetch;

  constructor(clientToken: string, options: SessionOptions = {}) {
    if (!clientToken) throw new TypeError("clientToken is required.");
    this.token = clientToken;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetch = resolveFetch(options.fetch);
  }

  /** The session's current state. Cheap enough to poll every few seconds. */
  async status(): Promise<SessionState> {
    const { response, body } = await this.request("GET", "/status");
    if (!response.ok) throw sessionError(response.status, body);
    return body as SessionState;
  }

  /**
   * Send a code to the number your server fixed for this session.
   *
   * Each call is one press of your button and gets its own idempotency key,
   * so a request retried by the network sends at most one code. To retry a
   * press yourself, pass the key you used the first time. A press inside the
   * resend cooldown resolves with `sent: false` instead of throwing.
   */
  async send(options: { idempotencyKey?: string } = {}): Promise<SendResult> {
    const key = options.idempotencyKey ?? newIdempotencyKey();
    const { response, body } = await this.request("POST", "/send", {}, { "Idempotency-Key": key });
    if (!response.ok) throw sessionError(response.status, body);
    return body as SendResult;
  }

  /** Send another code. The same as `send`; named for the button it serves. */
  resend(options: { idempotencyKey?: string } = {}): Promise<SendResult> {
    return this.send(options);
  }

  /**
   * Check the code the user typed. A wrong code is not an error: it resolves
   * with `verified: false` and the attempts remaining. Throws when the session
   * can no longer succeed this way, with `code_expired` when only a resend
   * helps.
   */
  async check(code: string): Promise<CheckResult> {
    const { response, body } = await this.request("POST", "/check", { code: String(code).trim() });
    if (response.ok) return { ...(body as SessionState), verified: true };
    if (response.status === 422 && isState(body)) return { ...body, verified: false };
    throw sessionError(response.status, body);
  }

  /** End the session, for a "Not your number?" link. */
  async cancel(): Promise<SessionState> {
    const { response, body } = await this.request("POST", "/cancel", {});
    if (!response.ok) throw sessionError(response.status, body);
    return body as SessionState;
  }

  private async request(method: string, path: string, json?: object, headers: Record<string, string> = {}) {
    const init: RequestInit = {
      method,
      // The session token is the only credential. No cookie may ride along,
      // and the API refuses credentialed cross-origin calls in any case.
      credentials: "omit",
      headers: {
        Accept: "application/json",
        Authorization: `Session ${this.token}`,
        "X-SF-Client": CLIENT_HEADER,
        ...(json === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
      ...timeoutSignal(this.timeoutMs),
    };
    return call(this.fetch, this.baseUrl + HOSTED_PATH + path, init);
  }
}

// A 409 on a verification passed through a proxy carries its status, which
// says why it can never succeed.
const DEAD_VERIFICATION_CODES: Record<string, ErrorCode> = {
  EXPIRED: "expired",
  LOCKED: "locked",
  VERIFIED: "already_verified",
};

export class SecondFactor {
  /** A session-mode client for the session whose client token your server
   * handed to this frontend. */
  static withSession(clientToken: string, options: SessionOptions = {}): VerificationSession {
    return new VerificationSession(clientToken, options);
  }

  private readonly baseUrl: string;
  private readonly cooldownSeconds: number;
  private readonly fetch: typeof fetch;
  private lastSendAt = 0;

  /**
   * A proxy-mode client.
   *
   * @param proxyBaseUrl Your own endpoints' base, which serve `/start`,
   *   `/verify` and `/resend` and pass secondfactor.ai's answer through with
   *   its status code.
   * @param resendCooldownSeconds For `resendAvailableIn`; 30 by default, the
   *   same as the API's.
   */
  constructor(proxyBaseUrl: string, resendCooldownSeconds = 30, options: { fetch?: typeof fetch } = {}) {
    if (!proxyBaseUrl) throw new TypeError("proxyBaseUrl is required.");
    this.baseUrl = proxyBaseUrl.replace(/\/+$/, "");
    this.cooldownSeconds = resendCooldownSeconds;
    this.fetch = resolveFetch(options.fetch);
  }

  /** Seconds until `resend` is allowed again, for a "Resend in 27s" button. */
  get resendAvailableIn(): number {
    const elapsed = (Date.now() - this.lastSendAt) / 1000;
    return Math.max(0, Math.ceil(this.cooldownSeconds - elapsed));
  }

  /** Send a code. Resolves with the verification SID to check against. */
  async send(phone: string): Promise<string> {
    return this.sendCode("start", { phone });
  }

  /**
   * Check a code against a verification. A wrong code resolves with
   * `verified: false`. Throws `expired`, `locked` or `already_verified` when
   * the verification can never succeed, so only a resend helps.
   */
  async check(verificationSid: string, code: string): Promise<Verification> {
    const { response, body } = await this.post("verify", { request_id: verificationSid, otp: String(code).trim() });
    if (response.ok) return { ...(body as Verification), verified: (body as Verification).status === "VERIFIED" };
    if (response.status === 422) return { ...(body as Verification), verified: false };
    throw proxyError(response.status, body);
  }

  /** Send a fresh code. A resend is a new verification with a new SID, so
   * check against the SID this resolves with, not the old one. */
  async resend(verificationSid: string): Promise<string> {
    return this.sendCode("resend", { request_id: verificationSid });
  }

  /** @deprecated Use `send`. */
  start(phone: string): Promise<string> {
    return this.send(phone);
  }

  /** @deprecated Use `check`, which also says how many attempts are left. */
  async verify(verificationSid: string, code: string): Promise<boolean> {
    return (await this.check(verificationSid, code)).verified;
  }

  private async sendCode(path: string, json: object): Promise<string> {
    const { response, body } = await this.post(path, json);
    if (!response.ok) throw proxyError(response.status, body);
    const sid = (body as { sid?: unknown }).sid;
    if (typeof sid !== "string") throw new SecondFactorError("The proxy's answer has no sid.", null, response.status);
    this.lastSendAt = Date.now();
    return sid;
  }

  private post(path: string, json: object) {
    return call(this.fetch, `${this.baseUrl}/${path}`, {
      method: "POST",
      // No X-SF-Client here: a custom header would make the browser preflight
      // your proxy, which existing proxies are not set up to answer.
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(json),
    });
  }
}

// ─────────────────────────────────── internals ───────────────────────────────────

function resolveFetch(fetchImpl?: typeof fetch): typeof fetch {
  const resolved = fetchImpl ?? globalThis.fetch;
  if (typeof resolved !== "function") throw new TypeError("No fetch available. Pass options.fetch.");
  // Always called as a plain function (see `call`), never as a method, which
  // is what makes a browser's fetch throw "Illegal invocation".
  return resolved;
}

/** `AbortSignal.timeout` where the platform has it. Older React Native
 * runtimes do not, and there the platform's own timeout applies. */
function timeoutSignal(ms: number): { signal?: AbortSignal } {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? { signal: AbortSignal.timeout(ms) }
    : {};
}

/** A key naming one user action. It needs to be unique, not secret, so the
 * fallback for runtimes without `crypto.randomUUID` (React Native) is fine. */
function newIdempotencyKey(): string {
  const cryptoImpl = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoImpl?.randomUUID) return cryptoImpl.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** A JSON answer, whose shape the caller knows from the status code. */
type Body = Record<string, any>;

async function call(fetchImpl: typeof fetch, url: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (cause) {
    throw new SecondFactorError(`secondfactor.ai unreachable: ${(cause as Error)?.message ?? cause}`, "network_error", null);
  }
  const body: unknown = await response.json().catch(() => ({}));
  return { response, body: (body ?? {}) as Body };
}

function isState(body: unknown): body is SessionState {
  return typeof body === "object" && body !== null && typeof (body as SessionState).status === "string" && "expires_at" in body;
}

/** Why a session refused: the state it is in, or the API's error envelope. */
function sessionError(status: number, body: Body): SecondFactorError {
  if (isState(body)) {
    const code = stateCode(body);
    return new SecondFactorError(`The verification session cannot do this: ${code}.`, code, status, body);
  }
  return envelopeError(status, body);
}

function stateCode(state: SessionState): ErrorCode {
  switch (state.status) {
    case "OPEN":
      return "code_expired";
    case "VERIFIED":
      return "already_verified";
    case "CANCELED":
      return "canceled";
    case "EXPIRED":
      return "expired";
    default:
      return state.failure_reason ?? "send_refused";
  }
}

function proxyError(status: number, body: Body): SecondFactorError {
  const dead = typeof body.status === "string" ? DEAD_VERIFICATION_CODES[body.status] : undefined;
  if (status === 409 && dead) return new SecondFactorError(`The verification can no longer succeed: ${dead}.`, dead, status);
  return envelopeError(status, body);
}

function envelopeError(status: number, body: Body): SecondFactorError {
  const code = typeof body.code === "string" ? body.code : null;
  const message = typeof body.message === "string" ? body.message : `secondfactor.ai answered HTTP ${status}.`;
  return new SecondFactorError(message, code, status);
}
