/**
 * secondfactor.ai OTP client for React Native and web (zero dependencies).
 *
 * Talks to YOUR backend proxy (see sdks/README.md) — never embed your
 * secondfactor.ai API key in the app.
 *
 *   const sf = new SecondFactor("https://api.yourapp.com/auth/otp");
 *   const requestId = await sf.start("+9779841000001");
 *   const ok = await sf.verify(requestId, enteredCode);
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

  async start(phone: string): Promise<string> {
    const json = await this.post("start", { phone });
    this.lastSendAt = Date.now();
    if (!json.request_id) throw new SecondFactorError(json.detail ?? "No request_id in response");
    return json.request_id;
  }

  async verify(requestId: string, otp: string): Promise<boolean> {
    const json = await this.post("verify", { request_id: requestId, otp: otp.trim() });
    return json.verified === true;
  }

  async resend(requestId: string): Promise<void> {
    await this.post("resend", { request_id: requestId });
    this.lastSendAt = Date.now();
  }

  private async post(path: string, body: object): Promise<any> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new SecondFactorError(json.detail ?? `HTTP ${res.status}`, json.code, res.status);
    return json;
  }
}
