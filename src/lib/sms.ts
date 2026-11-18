/**
 * Sends text messages (verification codes). Pick a provider with SMS_PROVIDER:
 *   hubtel  - HUBTEL_CLIENT_ID, HUBTEL_CLIENT_SECRET
 *   arkesel - ARKESEL_API_KEY
 *   demo    - nothing is sent; the code is shown on screen (development only)
 * SMS_SENDER_ID is the name the message comes from (registered with the provider, max 11 chars).
 */

export type SmsResult = { ok: true; demoCode?: string } | { ok: false; error: string };

export interface SmsProvider {
  name: string;
  send(toE164: string, message: string): Promise<SmsResult>;
}

const sender = () => (process.env.SMS_SENDER_ID || "Bidwell").slice(0, 11);

const hubtel: SmsProvider = {
  name: "hubtel",
  async send(to, message) {
    const q = new URLSearchParams({
      clientid: process.env.HUBTEL_CLIENT_ID ?? "",
      clientsecret: process.env.HUBTEL_CLIENT_SECRET ?? "",
      from: sender(),
      to: to.replace(/^\+/, ""),
      content: message,
    });
    const r = await fetch(`https://smsc.hubtel.com/v1/messages/send?${q}`);
    return r.ok ? { ok: true } : { ok: false, error: `Hubtel answered ${r.status}` };
  },
};

const arkesel: SmsProvider = {
  name: "arkesel",
  async send(to, message) {
    const r = await fetch("https://sms.arkesel.com/api/v2/sms/send", {
      method: "POST",
      headers: { "api-key": process.env.ARKESEL_API_KEY ?? "", "Content-Type": "application/json" },
      body: JSON.stringify({ sender: sender(), message, recipients: [to.replace(/^\+/, "")] }),
    });
    const body = (await r.json().catch(() => ({}))) as { status?: string; message?: string };
    return r.ok && body.status === "success" ? { ok: true } : { ok: false, error: body.message ?? `Arkesel answered ${r.status}` };
  },
};

/** Development stand-in: nothing leaves the server. The caller shows the code on screen. */
const demo: SmsProvider = {
  name: "demo",
  async send(_to, message) {
    return { ok: true, demoCode: message.match(/\d{6}/)?.[0] };
  },
};

export function smsProvider(): SmsProvider {
  const p = process.env.SMS_PROVIDER ?? "";
  if (p === "hubtel") return hubtel;
  if (p === "arkesel") return arkesel;
  if (p === "demo" || (!p && process.env.NODE_ENV !== "production") || process.env.PAYMENTS_DEMO === "1") return demo;
  throw new Error("SMS_PROVIDER is not set. Set it to hubtel or arkesel to send verification codes.");
}

/** "024 123 4567", "+233241234567" or "233241234567" -> "+233241234567". Other countries need the +code. */
export function normalizePhone(input: string): string | null {
  let d = input.replace(/[\s\-().]/g, "");
  if (/^0\d{9}$/.test(d)) d = "+233" + d.slice(1);
  else if (/^233\d{9}$/.test(d)) d = "+" + d;
  return /^\+\d{8,15}$/.test(d) ? d : null;
}
