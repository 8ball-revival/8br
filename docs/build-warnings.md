# The build warning

`npm run build` prints `⚠ Compiled with warnings` on a cold build and lists nothing. This is what
they are, where they come from, and why they are left alone.

---

## The short version

| | |
| --- | --- |
| **How many** | 24, all identical |
| **The text** | `Module Warning (from ./node_modules/next/dist/compiled/sass-loader/cjs.js): Future import deprecation is not yet active, so silencing it is unnecessary.` |
| **Where from** | `@payloadcms/next@3.86.0` — one line in its `withPayload` wrapper |
| **From this branch?** | No. Commit `eb83f3e`, before the site builder existed, produces the same banner |
| **Safely fixable here?** | No, without patching a dependency or suppressing warnings globally |
| **Harmful?** | No. No stylesheet is dropped, no rule changes, the build succeeds |

---

## Getting the text out

Next prints the banner and swallows the bodies. To see them, add a temporary plugin in
`next.config.ts`'s `webpack` hook:

```js
webpackConfig.plugins.push({
  apply(compiler) {
    compiler.hooks.done.tap('PrintWarnings', (stats) => {
      for (const w of stats.compilation.warnings ?? []) {
        console.log(String(w.message))
        if (w.module?.resource) console.log('  module: ' + w.module.resource)
      }
    })
  },
})
```

Then build **cold** — `rm -rf .next` first. With a warm webpack cache the modules are not recompiled,
no module warnings are produced, and the build reports `✓ Compiled successfully`. That is the whole
reason the warning comes and goes and looks intermittent.

Remove the plugin afterwards. It is an investigation tool, not configuration.

---

## What the 24 are

23 of them are stylesheets inside `@payloadcms/ui/dist/` — `Banner`, `Button`, `Card`, `Popup`,
`Tooltip`, the icon sheets, and so on. The 24th is `src/app/(payload)/custom.scss`, a file in this
repository that is **empty**, has existed since the initial commit `6adc6ca`, is required by
Payload's own scaffolding, and is unchanged on this branch.

The site builder added **zero** `.scss` files:

```bash
git diff --name-only eb83f3e..HEAD | grep -c '\.scss$'   # 0
```

## Where it comes from

`node_modules/@payloadcms/next/dist/withPayload/withPayload.js`:

```js
silenceDeprecations: [...(nextConfig.sassOptions?.silenceDeprecations || []), 'import']
```

`withPayload` appends `'import'` to the Sass deprecation-silencing list unconditionally, with a
`@todo` above it saying they intend to move their stylesheets from `@import` to `@use` and drop the
line. The installed Sass is 1.77.4, in which the `import` deprecation is not yet active — so Sass
warns that silencing it is unnecessary, once per stylesheet.

Payload knows. A few lines further up the same file monkey-patches `console.warn` specifically to
swallow this exact string, with the comment *"This warning is a lie"*. That patch works for Sass's
own console output; it cannot work here, because webpack's sass-loader turns the same message into a
`ModuleWarning` on the compilation, which never goes through `console.warn`. So Next still counts 24
warnings and prints the banner.

## Proof it predates the site builder

The merge-base commit — before a single line of the builder existed — produces the identical banner:

```bash
git worktree add /tmp/baseline eb83f3e
# link node_modules, then:
npm run build          # ⚠ Compiled with warnings in 23.4s
```

Run on `eb83f3e` during this work, with the same `node_modules`, on a cold build. Same banner.

## Why it is not fixed here

The `'import'` entry is appended by `withPayload` **after** it reads `nextConfig.sassOptions`, so
anything set in `next.config.ts` is spread into the array and `'import'` is still added. There is no
configuration that removes it. The remaining options are:

- patch the dependency,
- upgrade Payload or pin a different Sass,
- suppress warnings globally.

The first two are unrelated changes for a cosmetic warning in somebody else's stylesheets. The third
is worse than the problem: it would hide the next warning too, and the next one might matter.

## What it does not affect

- The build succeeds; the exit code is 0.
- Every stylesheet compiles. Nothing is dropped and no rule changes.
- It is confined to `@payloadcms/ui`'s admin stylesheets and one empty file.
- It is absent from a warm build entirely.

It will disappear when Payload finishes the `@import` → `@use` migration its own comment describes,
or when the installed Sass activates the deprecation. Neither is this repository's to decide.
