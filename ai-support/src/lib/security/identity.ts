import { isTailscaleCgnat, tailscaleSourceIp } from "./cgnat";
import {
  getAllowedTailscaleUsers,
  getEdgeSecret,
  trustProxy,
  trustTailscaleCgnat,
} from "./config";
import { timingSafeEqualString } from "./timing";

export type NetworkIdentity = {
  ok: boolean;
  via: "tailscale" | "tailscale-cgnat" | "edge-secret" | "none";
  login?: string;
  detail: string;
};

/**
 * Trust signals from Tailscale Serve / Funnel identity headers,
 * or a reverse-proxy edge secret (Caddy/nginx injects X-VanOS-Edge).
 *
 * Tailscale-User-Login is a client header unless a trusted proxy strips
 * inbound copies and sets it (VANOS_TRUST_PROXY). It is then trusted only
 * when VANOS_ALLOWED_TAILSCALE_USERS is non-empty and the login is
 * allowlisted. An empty allowlist never grants access. Use
 * VANOS_EDGE_SECRET for proxy-injected trust.
 */
export function resolveNetworkIdentity(req: Request): NetworkIdentity {
  const edge = getEdgeSecret();
  const presented = req.headers.get("x-vanos-edge")?.trim();
  if (edge && presented && timingSafeEqualString(presented, edge)) {
    return {
      ok: true,
      via: "edge-secret",
      detail: "X-VanOS-Edge accepted",
    };
  }

  const login = trustProxy()
    ? req.headers.get("tailscale-user-login")?.trim() ||
      req.headers.get("Tailscale-User-Login")?.trim()
    : undefined;

  if (login) {
    const allowed = getAllowedTailscaleUsers();
    if (allowed.length === 0) {
      return {
        ok: false,
        via: "tailscale",
        login,
        detail:
          "Tailscale-User-Login ignored: set VANOS_ALLOWED_TAILSCALE_USERS (fail closed)",
      };
    }
    if (allowed.includes(login.toLowerCase())) {
      return {
        ok: true,
        via: "tailscale",
        login,
        detail: `Tailscale user allowlisted: ${login}`,
      };
    }
    return {
      ok: false,
      via: "tailscale",
      login,
      detail: `Tailscale user not allowlisted: ${login}`,
    };
  }

  if (trustTailscaleCgnat()) {
    const ip = tailscaleSourceIp(req);
    if (ip && isTailscaleCgnat(ip)) {
      return {
        ok: true,
        via: "tailscale-cgnat",
        detail: "Source address is in Tailscale CGNAT 100.64.0.0/10",
      };
    }
  }

  return {
    ok: false,
    via: "none",
    detail: edge
      ? "Missing Tailscale-User-Login and X-VanOS-Edge"
      : trustTailscaleCgnat()
        ? "Missing Tailscale identity or CGNAT source address"
        : "Missing Tailscale-User-Login (set VANOS_EDGE_SECRET for proxy gate, or VANOS_TRUST_TAILSCALE_CGNAT on the VPS)",
  };
}

export function readBearerToken(req: Request): string | undefined {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const t = auth.slice(7).trim();
    return t || undefined;
  }
  return undefined;
}
