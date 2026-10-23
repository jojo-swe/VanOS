import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const css = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../app/globals.css"),
  "utf8",
);

type Mode = "light" | "dark";

function srgbToLin(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linToSrgb(channel: number): number {
  const v =
    channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const R = srgbToLin(r);
  const G = srgbToLin(g);
  const B = srgbToLin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    linToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** CSS `color-mix(in oklab, color percent%, other)`. */
function mix(hexA: string, hexB: string, percent: number): string {
  const [r1, g1, b1] = hexToRgb(hexA);
  const [r2, g2, b2] = hexToRgb(hexB);
  const [L1, a1, b1_] = rgbToOklab(r1, g1, b1);
  const [L2, a2, b2_] = rgbToOklab(r2, g2, b2);
  const t = percent / 100;
  const [r, g, b] = oklabToRgb(
    L1 * t + L2 * (1 - t),
    a1 * t + a2 * (1 - t),
    b1_ * t + b2_ * (1 - t),
  );
  return rgbToHex(r, g, b);
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
}

function contrast(foreground: string, background: string): number {
  const hi = Math.max(luminance(foreground), luminance(background));
  const lo = Math.min(luminance(foreground), luminance(background));
  return (hi + 0.05) / (lo + 0.05);
}

function normalizeColor(value: string): string {
  return value.toLowerCase() === "white" ? "#ffffff" : value.toLowerCase();
}

function parseSolids(): Map<string, Record<Mode, string>> {
  const tokens = new Map<string, Record<Mode, string>>();
  const re = /--([a-z0-9-]+)-(light|dark):\s*(#[0-9a-fA-F]{6})\s*;/g;
  for (const match of css.matchAll(re)) {
    const name = match[1];
    const mode = match[2] as Mode;
    const current = tokens.get(name) ?? ({} as Record<Mode, string>);
    current[mode] = match[3].toLowerCase();
    tokens.set(name, current);
  }
  return tokens;
}

function parseMixes(): Map<string, Record<Mode, string>> {
  const tokens = new Map<string, Record<Mode, string>>();
  const re =
    /--([a-z0-9-]+)-(light|dark):\s*color-mix\(in oklab,\s*(#[0-9a-fA-F]{6}|white)\s+(\d+)%\s*,\s*(#[0-9a-fA-F]{6}|white)\s*\)\s*;/g;
  for (const match of css.matchAll(re)) {
    const name = match[1];
    const mode = match[2] as Mode;
    const mixed = mix(normalizeColor(match[3]), normalizeColor(match[5]), Number(match[4]));
    const current = tokens.get(name) ?? ({} as Record<Mode, string>);
    current[mode] = mixed;
    tokens.set(name, current);
  }
  return tokens;
}

const solids = parseSolids();
const mixes = parseMixes();

function solid(name: string, mode: Mode): string {
  const value = solids.get(name)?.[mode];
  assert.ok(value, `missing --${name}-${mode}`);
  return value;
}

function mixed(name: string, mode: Mode): string {
  const value = mixes.get(name)?.[mode];
  assert.ok(value, `missing mix --${name}-${mode}`);
  return value;
}

function assertAtLeast(
  label: string,
  foreground: string,
  background: string,
  minimum: number,
) {
  const ratio = contrast(foreground, background);
  assert.ok(
    ratio >= minimum,
    `${label} is ${ratio.toFixed(2)}:1 (${foreground} on ${background}), need ${minimum}:1`,
  );
}

describe("theme contrast", () => {
  test("light palette matches the original Mission Control colors", () => {
    assert.equal(solid("bg", "light"), "#eef3f1");
    assert.equal(solid("surface", "light"), "#f7faf8");
    assert.equal(solid("ink", "light"), "#14201c");
    assert.equal(solid("muted-fg", "light"), "#5c6d66");
    assert.equal(solid("accent", "light"), "#c45c26");
    assert.equal(solid("accent-ink", "light"), "#9a3f12");
    assert.equal(solid("ok", "light"), "#2f7d5b");
    assert.equal(solid("ok-ink", "light"), "#1d5a40");
    assert.equal(solid("warn", "light"), "#c4921a");
    assert.equal(solid("warn-ink", "light"), "#8a6410");
    assert.equal(solid("danger", "light"), "#c23b3b");
  });

  for (const mode of ["light", "dark"] as const) {
    test(`${mode} text meets WCAG AA on page surfaces`, () => {
      const bg = solid("bg", mode);
      const surface = solid("surface", mode);
      const panel = mix(surface, "#ffffff", 88);
      const ink = solid("ink", mode);
      const muted = solid("muted-fg", mode);
      const pairs: [string, string, string][] = [
        ["ink on background", ink, bg],
        ["ink on surface", ink, surface],
        ["ink on panel", ink, panel],
        ["muted on background", muted, bg],
        ["muted on surface", muted, surface],
        ["muted on panel", muted, panel],
        ["accent ink on background", solid("accent-ink", mode), bg],
        ["accent ink on surface", solid("accent-ink", mode), surface],
        ["accent ink on panel", solid("accent-ink", mode), panel],
        ["accent ink on accent soft", solid("accent-ink", mode), mixed("accent-soft", mode)],
        ["ok ink on ok soft", solid("ok-ink", mode), mixed("ok-soft", mode)],
        ["warn ink on warn soft", solid("warn-ink", mode), mixed("warn-soft", mode)],
        ["danger on background", solid("danger", mode), bg],
        ["danger on surface", solid("danger", mode), surface],
        ["danger on panel", solid("danger", mode), panel],
        ["active nav", bg, ink],
      ];
      for (const [label, foreground, background] of pairs) {
        assertAtLeast(`${mode} ${label}`, foreground, background, 4.5);
      }
    });
  }

  test("dark accent wordmark stays above AA on the background", () => {
    assertAtLeast(
      "dark accent on background",
      solid("accent", "dark"),
      solid("bg", "dark"),
      4.5,
    );
  });

  test("hero wash stays readable in both themes", () => {
    for (const mode of ["light", "dark"] as const) {
      const heroEnd = mix("#f0c49a", solid("surface", mode), 22);
      assertAtLeast(`${mode} ink on hero`, solid("ink", mode), heroEnd, 4.5);
      assertAtLeast(
        `${mode} muted on hero`,
        solid("muted-fg", mode),
        heroEnd,
        4.5,
      );
    }
  });
});
