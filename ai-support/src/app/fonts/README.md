# Fonts

Mission Control's fonts live in the repo so `next build` works offline and never
downloads from Google Fonts. `src/app/layout.tsx` loads them with
`next/font/local` (preload, `font-display: swap`, size-adjusted fallbacks, and
the `--font-display`, `--font-body` and `--font-mono` CSS variables).

| Folder | Family | Weights used | Source | License |
|--------|--------|--------------|--------|---------|
| `syne/` | Syne | 500–800 | `@fontsource-variable/syne@5.3.0`, `files/syne-latin-wght-normal.woff2` | SIL OFL 1.1 (`syne/OFL.txt`) |
| `figtree/` | Figtree | 400–700 | `@fontsource-variable/figtree@5.3.0`, `files/figtree-latin-wght-normal.woff2` | SIL OFL 1.1 (`figtree/OFL.txt`) |
| `jetbrains-mono/` | JetBrains Mono | 400–500 | `@fontsource-variable/jetbrains-mono@5.3.0`, `files/jetbrains-mono-latin-wght-normal.woff2` | SIL OFL 1.1 (`jetbrains-mono/OFL.txt`) |

These are the same latin-subset variable fonts Google Fonts serves (Fontsource
builds them from Google's files). The files are unmodified.

To update: `npm pack @fontsource-variable/<family>@<version>` in a scratch
folder, copy `package/files/<family>-latin-wght-normal.woff2` and
`package/LICENSE` (as `OFL.txt`) here, and update the versions above.
