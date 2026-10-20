import { readdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse } from "yaml";
import z from "@deepseek-ai/schemastery";

/**
 * dsh-skills: serve the @dennisrongo/skills library to dsh as a skill provider.
 *
 * The library is a DEPENDENCY of this package, so `dsh plugin add
 * @dennisrongo/dsh-skills` installs the plugin and the whole catalog in one
 * command, and `dsh plugin update` moves both. That is the entire reason this
 * is a provider rather than a link script: a script can keep an ALREADY
 * INSTALLED catalog fresh, but it cannot install one — it presumes
 * <agentsHome>/skills exists, and nothing in the harness creates it. A missing
 * root is discovered as an empty list, not an error, so the failure mode of
 * getting this wrong is a silently empty catalog.
 *
 * Registration files into the calling context's layer. Applied at profile
 * level that is the GLOBAL layer, which every agent preset's scope chain
 * includes — so one row reaches every agent without touching the presets'
 * own `skill-filesystem` rows.
 *
 * Nothing is vendored: SKILL.md bodies are read from the resolved library at
 * catalog-collection time, so a `skillsRoot` pointed at a working clone picks
 * up edits without reinstalling anything.
 *
 * @module dsh-skills
 */

/** Stable Cordis plugin name. */
const name = "skills";

/** Provider identity. Every candidate must echo this in `provider` or the registry throws. */
const PROVIDER = "dennisrongo-skills";

/** The npm package that ships the library. */
const PACKAGE = "@dennisrongo/skills";

/** Directory, relative to the library root, holding <name>/SKILL.md bundles. */
const CATALOG = "skills";

/**
 * Precedence rank. Ties are broken only WITHIN one layer; a nearer layer wins
 * outright regardless, so a project's .dsh/skills still shadows these.
 */
const RANK = 600;

const inject = ["skills"];

/**
 * Probe locations, used only when the library is not a resolvable dependency.
 *
 * A global `npm i -g` lands outside anything derivable from homedir(), which
 * is why require() is tried first. All entries here are homedir()-relative so
 * they work on Windows, macOS and Linux alike.
 * @returns candidate absolute paths.
 */
function candidateRoots() {
  const home = homedir();
  return [
    join(home, ".dsh-skills", "node_modules", PACKAGE),
    join(home, "src", "claude-skills"),
    join(home, "code", "claude-skills"),
    join(home, "dev", "claude-skills"),
    join(home, "git", "claude-skills"),
    join(home, "repos", "claude-skills"),
    join(home, "Projects", "claude-skills"),
    join(home, "Documents", "claude-skills"),
    join(home, "Documents", "GitHub", "claude-skills"),
    join(home, "Documents", "Experimental Projects", "claude-skills"),
  ];
}

/**
 * Resolve the library root: explicit config, then environment, then this
 * package's own dependency, then a probe.
 *
 * The dependency is tried before the probe because it is the intended path
 * and its location is not guessable — resolving the manifest rather than the
 * entry point avoids caring that the library is CommonJS.
 * @param configured - `skillsRoot` from the profile, if set.
 * @returns the resolved root, or null when nothing looks like a library.
 */
function resolveRoot(configured) {
  if (typeof configured === "string" && configured.length > 0) return configured;
  const fromEnv = process.env.DSH_SKILLS_ROOT;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  try {
    const require_ = createRequire(import.meta.url);
    const root = join(require_.resolve(PACKAGE + "/package.json"), "..");
    if (existsSync(join(root, CATALOG))) return root;
  } catch {
    // Not installed alongside this plugin — fall through to the probe.
  }
  for (const candidate of candidateRoots()) {
    if (existsSync(join(candidate, CATALOG))) return candidate;
  }
  return null;
}

const Config = z.object({
  /**
   * Directory containing a `skills/` folder of <name>/SKILL.md bundles.
   * Empty means "resolve it": DSH_SKILLS_ROOT, then the bundled
   * @dennisrongo/skills dependency, then a probe of common clone locations.
   */
  skillsRoot: z.string().default(""),
  /** Master switch, e.g. for a scratch profile that wants a clean baseline. */
  enabled: z.boolean().default(true)
});

/** Skill names are kebab-case; the registry rejects anything else outright. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Split YAML frontmatter from a SKILL.md body.
 *
 * dsh-skill-filesystem parses the same shape but exports no parser, so this
 * is the one unavoidable duplication in this package.
 * @returns parsed frontmatter and body, or null when malformed.
 */
function parseFrontmatter(raw) {
  const firstLineEnd = raw.indexOf("\n");
  if (firstLineEnd < 0) return null;
  if (raw.slice(0, firstLineEnd).replace(/\r$/, "") !== "---") return null;
  const start = firstLineEnd + 1;
  const closing = raw.indexOf("\n---", start);
  if (closing < 0) return null;
  const bodyStart = raw.indexOf("\n", closing + 1);
  const data = parse(raw.slice(start, closing + 1)) ?? {};
  return {
    data: typeof data === "object" && data !== null ? data : {},
    body: bodyStart < 0 ? "" : raw.slice(bodyStart + 1)
  };
}

function stringField(data, key) {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Read and validate one skill bundle.
 * @returns the parsed skill, or null when it is not a usable skill.
 */
async function readSkill(catalog, dirName, logger) {
  const path = join(catalog, dirName, "SKILL.md");
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null; // No SKILL.md: not a skill bundle, not an error.
  }
  let parsed;
  try {
    parsed = parseFrontmatter(raw);
  } catch (error) {
    logger?.warn(`[dsh-skills] ${path} ignored: invalid YAML frontmatter: ${error.message}`);
    return null;
  }
  if (parsed === null) {
    logger?.warn(`[dsh-skills] ${path} ignored: missing YAML frontmatter`);
    return null;
  }
  const skillName = stringField(parsed.data, "name") ?? dirName;
  const description = stringField(parsed.data, "description");
  if (description === undefined) {
    logger?.warn(`[dsh-skills] ${path} ignored: frontmatter requires a description`);
    return null;
  }
  if (!SKILL_NAME.test(skillName)) {
    logger?.warn(`[dsh-skills] ${path} ignored: invalid skill name "${skillName}"`);
    return null;
  }
  return {
    name: skillName,
    description,
    whenToUse: stringField(parsed.data, "whenToUse"),
    directory: join(catalog, dirName),
    path,
    content: parsed.body.trim()
  };
}

/**
 * Build the candidate the registry validates. `provider` MUST equal the
 * provider's own name, and `invocation` must carry two booleans, or
 * validateCandidate throws and the entire provider is skipped.
 */
function toCandidate(skill) {
  return {
    name: skill.name,
    description: skill.description,
    ...skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {},
    invocation: { modelInvocable: true, userInvocable: true },
    source: "custom",
    provider: PROVIDER,
    rank: RANK,
    // Resolves the skill's own references/ and scripts/ for the model.
    resourceBase: { kind: "directory", path: skill.directory },
    path: skill.path,
    locator: { path: skill.path, directory: skill.directory }
  };
}

/** Provider serving every SKILL.md bundle under the resolved library. */
class SkillsLibraryProvider {
  constructor(root, logger) {
    this.name = PROVIDER;
    this.catalog = join(root, CATALOG);
    this.logger = logger;
  }

  /**
   * Discover every skill bundle in the library.
   *
   * An unreadable catalog returns an INCOMPLETE observation rather than
   * throwing: the registry caches complete results, so reporting a transient
   * read error as an empty catalog would pin emptiness until invalidation.
   */
  async list() {
    let entries;
    try {
      entries = await readdir(this.catalog, { withFileTypes: true });
    } catch (error) {
      this.logger?.warn(`[dsh-skills] cannot read ${this.catalog}: ${error.message}`);
      return { candidates: [], complete: false };
    }
    const names = [];
    for (const entry of entries) {
      if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) { names.push(entry.name); continue; }
      // Follow links: a contributor may link individual skills into a clone.
      if (!entry.isSymbolicLink()) continue;
      try {
        if ((await stat(join(this.catalog, entry.name))).isDirectory()) names.push(entry.name);
      } catch {
        // Broken link: skip it rather than failing the whole catalog.
      }
    }
    names.sort();
    const skills = await Promise.all(names.map((n) => readSkill(this.catalog, n, this.logger)));
    return skills.filter((s) => s !== null).map(toCandidate);
  }

  /**
   * Load one skill body, re-reading from disk so a clone edit is picked up
   * without a restart.
   * @returns the full definition, or undefined when the file disappeared.
   */
  async get(candidate) {
    const { path, directory } = candidate.locator;
    let raw;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      return undefined;
    }
    const parsed = parseFrontmatter(raw);
    if (parsed === null) return undefined;
    return {
      name: candidate.name,
      description: candidate.description,
      ...candidate.whenToUse !== undefined ? { whenToUse: candidate.whenToUse } : {},
      invocation: candidate.invocation,
      source: candidate.source,
      provider: PROVIDER,
      resourceBase: { kind: "directory", path: directory },
      path,
      content: parsed.body.trim()
    };
  }
}

function apply(ctx, config) {
  if (config.enabled === false) return;

  const root = resolveRoot(config.skillsRoot);
  if (root === null) {
    // Name every knob: an unresolved library is a configuration gap, not a
    // bug, and a silently empty catalog is the failure this warning prevents.
    ctx.logger?.warn(
      "[dsh-skills] no skills library found. It normally ships as this " +
      `plugin's own ${PACKAGE} dependency — reinstall the plugin, or set ` +
      "`skillsRoot` in this profile's cordis.patch.yml, or the " +
      `DSH_SKILLS_ROOT environment variable, to a root containing ${CATALOG}/`
    );
    return;
  }

  ctx.effect(
    () => ctx.skills.registerProvider(() => new SkillsLibraryProvider(root, ctx.logger)),
    "skills.registerProvider()"
  );
}

export { Config, SkillsLibraryProvider, apply, inject, name };
