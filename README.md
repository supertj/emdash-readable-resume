# readable-resume

A sandboxed plugin for [EmDash CMS](https://emdashcms.com).

## Develop

```sh
pnpm install
pnpm run validate
pnpm run typecheck
pnpm run test
pnpm run build
```

To test against a running EmDash site, run `pnpm run dev` in this
directory (rebuilds on save) and `pnpm add file:../path/to/this`
in the site. Then `import readableResume from "readable-resume"` and pass
it into `emdash({ sandboxed: [readableResume] })`.

`pnpm run test` builds the plugin and runs its tests through Worker Loader using
EmDash's production sandbox wrapper and host bridge.

## Publish

```sh
pnpm run login -- alice.example.com
pnpm run publish          # builds and uploads artifacts to your PDS
```

To publish from GitHub Actions, run `pnpm run release:setup`. The command
creates one shared workflow at the Git repository root.

## Version bumps

Bump `version` in `package.json` when you ship a release. The
scaffold's `emdash-plugin.jsonc` deliberately omits `version` —
the build pipeline reads it from `package.json` so there's a single
source of truth. **Bump major** for breaking changes, **bump minor**
for new routes or hooks, **bump patch** for fixes.

You MUST bump version whenever you change `capabilities`, `allowedHosts`,
or `storage` in the manifest. Installed users have consented to the
old trust contract; a change without a version bump would let new
behaviour slip past consent.
