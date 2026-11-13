import { isIP } from "node:net";

export function normalizeFeedUrl(input: string): string {
  if (typeof input !== "string" || input.length > 2048) throw new Error("URL is missing or too long");
  const u = new URL(input.trim());
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only HTTP(S) feeds are supported");
  if (u.username || u.password) throw new Error("Credentials are not allowed in feed URLs");
  if (u.hostname === "localhost" || u.hostname.endsWith(".localhost") || u.hostname.endsWith(".local") || u.hostname.endsWith(".internal")) {
    throw new Error("Local and internal hosts are forbidden");
  }
  if (isIP(u.hostname.replace(/^\[|\]$/g,"")) && !isPublicIp(u.hostname.replace(/^\[|\]$/g,""))) {
    throw new Error("Private IP addresses are forbidden");
  }
  u.hash = "";
  return u.href;
}
export function isPublicIp(address: string): boolean {
  const a = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (a.startsWith("::ffff:")) return isPublicIp(a.slice(7));
  const kind = isIP(a);
  if (kind === 4) {
    const n = a.split(".").map(Number);
    const p = n[0] ?? 0, q = n[1] ?? 0;
    if (p === 0 || p === 10 || p === 127 || p >= 224 || p === 169 && q === 254 ||
        p === 172 && q >= 16 && q <= 31 || p === 192 && q === 168 ||
        p === 100 && q >= 64 && q <= 127 || p === 192 && q === 0 ||
        p === 198 && (q === 18 || q === 19) || p === 192 && q === 0 ||
        p === 192 && q === 88 || p === 198 && q === 51 || p === 203 && q === 0) return false;
    return true;
  }
  if (kind === 6) {
    if (a === "::" || a === "::1" || a.startsWith("fc") || a.startsWith("fd") ||
      /^fe[89ab]/.test(a) || a.startsWith("2001:db8:") ||
      a.startsWith("2001:0:") || a.startsWith("2001:10:")) return false;
    return true;
  }
  return false;
}
export function emailValue(s: unknown): string {
  if (typeof s !== "string" || s.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim())) throw new Error("Invalid email");
  return s.trim().toLowerCase();
}
