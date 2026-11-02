/**
 * Escape text for Slack mrkdwn. Bot output is untrusted: without this a
 * message could contain `<!channel>` and ping everyone, or a disguised link.
 */
export function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Trim to `max` characters on a word boundary where possible. */
export function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

/**
 * Turn Slack message markup into plain readable text for the panel:
 * <@U123> → @name, <#C123|general> → #general, <https://x|label> → label,
 * <!here> → @here, and HTML entities back to characters. The result is
 * rendered as text, never as HTML.
 */
export function slackToPlain(text: string, names: Record<string, string> = {}): string {
  const out = text.replace(/<([^<>]+)>/g, (_match, inner: string) => {
    const [target, label] = inner.split("|", 2);
    if (target.startsWith("@")) return `@${label || names[target.slice(1)] || target.slice(1)}`;
    if (target.startsWith("#")) return `#${label || target.slice(1)}`;
    if (target.startsWith("!")) {
      const special = target.slice(1).split("^")[0];
      return special === "subteam" ? `@${label || "group"}` : `@${label || special}`;
    }
    return label || target;
  });
  return out.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Slack `ts` ("1700000000.000200") to ISO time. */
export function tsToIso(ts: string): string {
  const seconds = Number(ts);
  if (!Number.isFinite(seconds)) return "";
  return new Date(seconds * 1000).toISOString();
}
