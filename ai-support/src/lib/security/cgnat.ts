import { trustProxy } from "@/lib/security/config";

/**
 * Tailscale CGNAT range: 100.64.0.0/10 (100.64.0.0 – 100.127.255.255).
 * IPv4-mapped IPv6 (::ffff:100.x.x.x) counts as the same address.
 */
export function isTailscaleCgnat(ip: string): boolean {
  const host = normalizeIp(ip);
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const octets = match.slice(1).map((part) => Number(part));
  if (octets.some((n) => !Number.isInteger(n) || n > 255)) return false;
  const [a, b] = octets;
  return a === 100 && b >= 64 && b <= 127;
}

export function normalizeIp(raw: string): string {
  let ip = raw.trim().toLowerCase();
  if (!ip) return "";
  if (ip.startsWith("[") && ip.includes("]")) {
    ip = ip.slice(1, ip.indexOf("]"));
  }
  const zone = ip.indexOf("%");
  if (zone >= 0) ip = ip.slice(0, zone);
  if (ip.startsWith("::ffff:")) ip = ip.slice("::ffff:".length);
  return ip;
}

export function isLoopback(ip: string): boolean {
  const host = normalizeIp(ip);
  return host === "::1" || host.startsWith("127.");
}

/**
 * Address to test for CGNAT.
 * A non-loopback socket IP (req.ip) wins over headers.
 * X-Real-IP and X-Forwarded-For are client-controlled unless
 * VANOS_TRUST_PROXY is on. Callers must also have
 * VANOS_TRUST_TAILSCALE_CGNAT on before treating the result as identity.
 */
export function tailscaleSourceIp(req: Request): string | undefined {
  const direct = (req as { ip?: string | null }).ip;
  if (typeof direct === "string" && direct.trim()) {
    const ip = normalizeIp(direct);
    if (ip && !isLoopback(ip)) return ip;
  }

  if (!trustProxy()) return undefined;

  const real = req.headers.get("x-real-ip");
  if (real?.trim()) {
    const ip = normalizeIp(real);
    if (ip) return ip;
  }

  const forwarded = req.headers.get("x-forwarded-for");
  if (!forwarded) return undefined;
  const hops = forwarded
    .split(",")
    .map((part) => normalizeIp(part))
    .filter(Boolean);
  return hops[hops.length - 1] || undefined;
}
