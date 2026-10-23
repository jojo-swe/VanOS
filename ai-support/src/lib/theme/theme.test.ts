import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  THEME_STORAGE_KEY,
  buildThemeInitScript,
  parseThemeChoice,
  themeInitScript,
} from "./theme";

const cssPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../app/globals.css",
);

function runInitScript(storage: { getItem(key: string): string | null }): string | null {
  let theme: string | null = null;
  const document = {
    documentElement: {
      setAttribute(name: string, value: string) {
        if (name === "data-theme") theme = value;
      },
    },
  };
  const fn = new Function("document", "localStorage", themeInitScript);
  fn(document, storage);
  return theme;
}

describe("parseThemeChoice", () => {
  test("keeps light, dark, and system", () => {
    assert.equal(parseThemeChoice("light"), "light");
    assert.equal(parseThemeChoice("dark"), "dark");
    assert.equal(parseThemeChoice("system"), "system");
  });

  test("defaults missing and unknown values to system", () => {
    assert.equal(parseThemeChoice(null), "system");
    assert.equal(parseThemeChoice(undefined), "system");
    assert.equal(parseThemeChoice(""), "system");
    assert.equal(parseThemeChoice("blue"), "system");
  });
});

describe("theme init script", () => {
  test("uses the same storage key as the module", () => {
    assert.match(themeInitScript, new RegExp(THEME_STORAGE_KEY));
    assert.equal(themeInitScript, buildThemeInitScript());
  });

  test("applies a stored choice before paint", () => {
    const saved = new Map<string, string>([[THEME_STORAGE_KEY, "dark"]]);
    assert.equal(
      runInitScript({ getItem: (key) => saved.get(key) ?? null }),
      "dark",
    );
  });

  test("falls back to system when storage is empty, invalid, or blocked", () => {
    assert.equal(runInitScript({ getItem: () => null }), "system");
    assert.equal(runInitScript({ getItem: () => "nope" }), "system");
    assert.equal(
      runInitScript({
        getItem() {
          throw new Error("blocked");
        },
      }),
      "system",
    );
  });
});

describe("dark token blocks", () => {
  test("explicit dark and system-dark assign the same variables", () => {
    const css = readFileSync(cssPath, "utf8");
    const explicit = css.match(/html\[data-theme="dark"\] \{([\s\S]*?)\n\}/)?.[1];
    const system = css.match(
      /html\[data-theme="system"\] \{([\s\S]*?)\n {2}\}/,
    )?.[1];
    assert.ok(explicit, "missing html[data-theme=dark] block");
    assert.ok(system, "missing prefers-color-scheme system block");
    const declarations = (block: string) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("--"))
        .sort();
    assert.deepEqual(declarations(explicit), declarations(system));
    assert.match(explicit, /color-scheme:\s*dark/);
    assert.match(system, /color-scheme:\s*dark/);
  });
});
