/**
 * secondfactor.ai OTP client for React Native and web (zero dependencies).
 *
 * Talks to YOUR backend proxy (see sdks/README.md) — never embed your
 * secondfactor.ai API key in the app. The proxy passes secondfactor.ai's
 * response through unchanged, status code included.
 *
 *   const sf = new SecondFactor("https://api.yourapp.com/auth/otp");
 *   let sid = await sf.start("+9779841000001");
 *   const ok = await sf.verify(sid, enteredCode); // false = wrong code, try again
 *   sid = await sf.resend(sid);                   // a resend is a new sid
 */

export class SecondFactorError extends Error {
  constructor(message: string, public code?: string, public status?: number) {
    super(message);
    this.name = "SecondFactorError";
  }
}

export class SecondFactor {
  private lastSendAt = 0;

  constructor(
    private baseUrl: string,
    private resendCooldownSeconds = 30,
  ) {}

  /** Seconds until resend() is allowed again (for "Resend in Ns" UI). */
  get resendAvailableIn(): number {
    const elapsed = (Date.now() - this.lastSendAt) / 1000;
    return Math.max(0, Math.ceil(this.resendCooldownSeconds - elapsed));
  }

  /** Send a code. Returns the verification sid (VE…) to verify against. */
  async start(phone: string): Promise<string> {
    const sid = await this.send("start", { phone });
    this.lastSendAt = Date.now();
    return sid;
  }

  /** True when the code is right, false when it is wrong and the user may try
   * again. Throws when the verification can never be approved — expired,
   * locked or already verified, which `code` names — so only a resend helps. */
  async verify(requestId: string, otp: string): Promise<boolean> {
    const [status, json] = await this.post("verify", { request_id: requestId, otp: otp.trim() });
    if (status === 422) return false;
    if (status >= 400) throw this.error(status, json);
    return json.status === "VERIFIED";
  }

  /** Send a fresh code. A resend is a new verification with a new sid and a
   * new code, so verify against the sid this returns, not the old one. */
  async resend(requestId: string): Promise<string> {
    const sid = await this.send("resend", { request_id: requestId });
    this.lastSendAt = Date.now();
    return sid;
  }

  private async send(path: string, body: object): Promise<string> {
    const [status, json] = await this.post(path, body);
    if (status >= 400) throw this.error(status, json);
    if (!json.sid) throw new SecondFactorError("No sid in response", undefined, status);
    return json.sid;
  }

  /** An error body is either secondfactor.ai's `{code, message}` envelope or a
   * verification body whose `status` names the state it ended in. */
  private error(status: number, json: any): SecondFactorError {
    return new SecondFactorError(json.message ?? json.detail ?? `HTTP ${status}`, json.code ?? json.status, status);
  }

  private async post(path: string, body: object): Promise<[number, any]> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return [res.status, await res.json().catch(() => ({}))];
  }
}
