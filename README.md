# astro-agent

Astro documentation index generator for AI coding agents. Mirrors the workflow of `npx @next/codemod agents-md` but targets Astro.

## Usage

```bash
npx github:sungkhum/astro-agent agents-md
npx github:sungkhum/astro-agent agents-md --version 4
npx github:sungkhum/astro-agent agents-md --ref v4
npx github:sungkhum/astro-agent agents-md --output AGENTS.md
npx github:sungkhum/astro-agent agents-md --output AGENTS.md,CLAUDE.md
```

This will:
- Download the Astro docs into `.astro-docs/`
- Build a compact index of markdown files
- Inject it into your target markdown file(s) (prompted if `--output` is omitted)
- Add `.astro-docs/` to `.gitignore` if missing

## Version support

If you omit `--version` and `--ref`, the CLI will try to detect the Astro major version from `package.json` in the current working directory. If it cannot detect a version, it will prompt you.

- `--version 4` uses the `v4` docs ref.
- `--version 5` (or higher) uses the `main` docs ref.
- `--ref <git-ref>` lets you pin a specific branch, tag, or commit.

## Custom docs

Place additional markdown files under `.astro-docs-extra/`. When you run `agents-md`, the contents are copied into `.astro-docs/` before indexing.

## Local development

```bash
npm install
npm run build
node dist/cli/index.js agents-md
```

## License

MIT
