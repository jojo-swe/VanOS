/**
 * Print a new TOTP secret, otpauth URI, terminal QR, and recovery-code hashes.
 * Run locally. Nothing is written to disk. Do not commit the output.
 *
 *   npm run totp:setup
 *   npm run totp:setup -- --account jojo --issuer VanOS
 */
import QRCode from "qrcode";
import { buildTotpSetup } from "../src/lib/security/totp";

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

async function main(): Promise<void> {
  const setup = buildTotpSetup({
    issuer: arg("issuer"),
    account: arg("account"),
  });
  const qr = await QRCode.toString(setup.uri, {
    type: "terminal",
    small: true,
    errorCorrectionLevel: "M",
  });
  process.stdout.write(
    [
      "VanOS TOTP setup",
      "Copy this into the VPS env. Do not commit it, and do not set it on the Vercel edge host.",
      "",
      `VANOS_TOTP_SECRET=${setup.secret}`,
      "VANOS_SESSION_SECRET=<openssl rand -base64 32>",
      "# optional, default 30 days. Keep the session secret stable across restarts.",
      "# VANOS_SESSION_TTL_DAYS=30",
      "",
      "otpauth URI:",
      setup.uri,
      "",
      qr.endsWith("\n") ? qr.slice(0, -1) : qr,
      "",
      "Recovery codes (shown once — put them in a password manager):",
      ...setup.recoveryCodes,
      "",
      "Store the hashes, not the codes. One hash per line in VANOS_TOTP_RECOVERY_FILE, or:",
      `VANOS_TOTP_RECOVERY_CODES=${setup.recoveryHashes.join(",")}`,
      "",
    ].join("\n"),
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "TOTP setup failed";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
