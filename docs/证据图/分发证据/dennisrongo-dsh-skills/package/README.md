# dsh-skills

[![npm](https://img.shields.io/npm/v/@dennisrongo/dsh-skills)](https://www.npmjs.com/package/@dennisrongo/dsh-skills)

**npm:** [`@dennisrongo/dsh-skills`](https://www.npmjs.com/package/@dennisrongo/dsh-skills) ·
**source:** [dennisrongo/dsh-plugins](https://github.com/dennisrongo/dsh-plugins/tree/main/plugins/dsh-skills)

Serves the [`@dennisrongo/skills`](https://www.npmjs.com/package/@dennisrongo/skills) library
to dsh as a skill provider, so the whole catalog installs and updates as **one npm
dependency**.

> Mind the scope. The **unscoped** `dsh-skills` on npm is an unrelated plugin by another
> author, so `add dsh-skills` fetches theirs, not this one.

```bash
dsh plugin --profile <name> add @dennisrongo/dsh-skills
```

That is the entire install. The library ships as this plugin's own dependency, so there is no
clone to make, no directory to create, and nothing to link.

## Why a plugin and not a link script

Skills are normally dropped into `<agentsHome>/skills` and discovered from there. That works
well for keeping an **already installed** catalog fresh — which is what
`scripts/link-superpowers-skills.mjs` does for a superpowers clone — but it is not an install
path: it presumes `~/.agents/skills` exists, and nothing in the harness creates it. A missing
root is discovered as an *empty list, not an error*, so a fresh machine gets a silently empty
catalog and no diagnostic.

Making the library an npm dependency of a plugin moves the whole problem into pnpm, which
already solves it.

## Updating

```bash
# what is behind, across the whole profile
dsh plugin --profile <name> outdated

# newest CATALOG (the usual case — skills changed, plugin did not)
dsh plugin --profile <name> update @dennisrongo/skills

# newest PLUGIN (provider logic changed)
dsh plugin --profile <name> update @dennisrongo/dsh-skills

# check what is out there first
npm view @dennisrongo/skills version
```

then restart the profile. `dsh plugin` is a thin pnpm forwarder, so every pnpm subcommand
works. The plugin declares `@dennisrongo/skills: ^0.16.0`, so skills move with a normal
dependency bump and the plugin only needs a release for a major.

You will see this on install — it is orientation, not a fault:

> `warning: @dennisrongo/skills declares no dsh.bundle — installed as a plain dependency`

The library is a plain library; only the plugin is a bundle.

## Pointing it at a clone

Contributors editing skills can bypass the packaged copy entirely. Resolution order, first
hit wins:

1. `skillsRoot` in the profile's `cordis.patch.yml`
2. the `DSH_SKILLS_ROOT` environment variable
3. this plugin's own `@dennisrongo/skills` dependency
4. a probe of common clone locations under `$HOME`

```yaml
# <profile>/cordis.patch.yml — a bare id: CONFIGURES the self-mounted row
- id: skills
  config:
    skillsRoot: /absolute/path/to/claude-skills
```

Bodies are read when the catalog is collected, so edits under a clone land without
reinstalling. If nothing resolves, the plugin warns naming every knob and registers nothing —
dsh still boots.

## Config

| key | default | meaning |
|---|---|---|
| `skillsRoot` | `""` → resolved (see above) | root containing `skills/<name>/SKILL.md` |
| `enabled` | `true` | set false for a clean-baseline profile |

## Precedence

Skills register into the profile's global layer, which every agent preset sees. A **nearer
layer wins outright**, so a project's own `.dsh/skills` still shadows a library skill of the
same name — the library is a baseline, not an override.

## Known upstream defect

5 of the 31 skills in `@dennisrongo/skills@0.16.0` — `code-review`, `e2e-verify`,
`maestro-mobile-test`, `nextjs-app-router`, `task-executor` — have frontmatter that is not
valid YAML: an unquoted `description` containing a literal `": "` parses as a nested mapping.
They are skipped with a warning.

This is upstream in `dennisrongo/claude-skills`, not in this plugin: dsh's own
`skill-filesystem` provider uses the same parser and drops them identically. Quoting or
folding those descriptions upstream fixes it, and the plugin picks them up on the next
`update` with no change here.

## Notes

- The folder is `plugins/dsh-skills` but the package is `@dennisrongo/dsh-skills`. Mind the
  scope: the **unscoped** `dsh-skills` on npm is an unrelated plugin by another author, so
  `add dsh-skills` fetches theirs, not this one.
- `@deepseek-ai/cordis` and `@deepseek-ai/schemastery` are peers supplied by your dsh
  install; `yaml` is a real dependency because `scripts/anchor.mjs` only anchors
  `@deepseek-ai/*`.

---

## About the author

Plugins and walkthroughs on [YouTube @codingmenace](https://www.youtube.com/@codingmenace) —
I build AI coding tools in public, including DeepSeek Harness itself. More at
[dennisrongo.com](https://dennisrongo.com/).
