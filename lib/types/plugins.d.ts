/**
 * The plugin set of the profile this app booted from.
 *
 * A Harness profile is a directory under `$DSH_HOME/profiles/<name>` whose
 * `package.json` carries two lists that are easy to confuse: `dependencies`,
 * which is what pnpm put on disk, and `dsh.profile.bundles`, the ordered
 * layer stack the launcher actually composes. A package can sit in the first
 * and not the second, and that gap is exactly what this app calls enabled and
 * disabled — which is why the picker reads a manifest rather than asking the
 * package manager what is installed.
 *
 * Everything that only reads or rewrites that manifest is a pure function
 * over a parsed object, because the alternative is a feature whose only test
 * is a network install. The two operations that cannot be pure — adding and
 * removing a package — are one narrow `execFile` at the bottom of the file.
 *
 * Nothing here takes effect until the app is restarted: the bundle sets
 * `patchReload: "startup"`, so a layer list edited under a running terminal is
 * read at the next launch and not before.
 * @module moqi-tui/plugins
 */
/** The layer every profile composes first; nothing else works without it. */
export declare const BASE_BUNDLE = "@deepseek-ai/dsh-base";
/** This app's own package, as the profile's dependency list spells it. */
export declare const APP_PACKAGE = "moqi-tui";
/**
 * The identifier this package used immediately before `moqi-tui`.
 *
 * A profile installed under the old name still lists it, and the app has to
 * keep recognizing its own bundle as protected — otherwise the plugin pane
 * offers to disable the terminal it is running inside. npm rejected the bare
 * `moqi` as too close to existing packages, so the published name grew a
 * suffix while the command stayed `moqi`.
 */
export declare const LEGACY_APP_PACKAGE = "moqi";
/**
 * Packages the picker lists but refuses to change.
 *
 * Disabling the base layer leaves a profile with no agent, and disabling this
 * app removes the very screen the command was typed on — in both cases the
 * only way back is to hand-edit JSON, so the app does not offer the rope.
 */
export declare const PROTECTED_PACKAGES: readonly string[];
/** The package manager profiles are installed with. */
export declare const PACKAGE_MANAGER = "pnpm";
/** The `dsh.profile` section of a profile manifest. */
export interface ProfileSection {
    /** The ordered layer stack, by package name. */
    bundles?: string[];
    /** When the launcher re-reads the user patch file; this bundle sets `startup`. */
    patchReload?: string;
    /** Anything else the Harness writes there, preserved on the way back out. */
    [key: string]: unknown;
}
/** The `dsh` section of a profile manifest. */
export interface DshSection {
    profile?: ProfileSection;
    /** Anything else the Harness writes there, preserved on the way back out. */
    [key: string]: unknown;
}
/**
 * A profile's `package.json`, as far as this app cares.
 *
 * The index signature is load-bearing rather than lazy typing: the manifest is
 * the user's file and carries fields this app has no business knowing about,
 * and a rewrite that dropped them would be a silent data loss.
 */
export interface ProfileManifest {
    dependencies?: Record<string, string>;
    dsh?: DshSection;
    [key: string]: unknown;
}
/** One package of the active profile, as the picker shows it. */
export interface PluginEntry {
    /** The package name, exactly as the manifest spells it. */
    name: string;
    /** The dependency spec it was installed from; empty for an in-box layer. */
    spec: string;
    /** Whether the profile installed it, as opposed to inheriting it in-box. */
    installed: boolean;
    /** Whether it is in `dsh.profile.bundles`, i.e. composed into the app. */
    enabled: boolean;
    /** Whether this app refuses to change it; see {@link PROTECTED_PACKAGES}. */
    protected: boolean;
}
/** The outcome of an edit to the layer stack. */
export interface BundleEdit {
    /** The manifest to write back; the original when nothing moved. */
    manifest: ProfileManifest;
    /** Whether the layer stack actually changed. */
    changed: boolean;
    /** Why it did not, in a form the status line can print; empty when it did. */
    reason: string;
}
/** A package name, with whatever version suffix came with it. */
export interface PackageRequest {
    /** The bare package name, without a version. */
    name: string;
    /** The single argument handed to the package manager. */
    spec: string;
}
/** Either a package the app is willing to install, or why it is not. */
export type PackageRequestResult = {
    ok: true;
    request: PackageRequest;
} | {
    ok: false;
    reason: string;
};
/** How a package-manager run turned out. */
export interface PackageManagerRun {
    ok: boolean;
    /** One line for the status bar: the manager's own last word, or the failure. */
    message: string;
}
/** Whether this app declines to enable or disable a package. */
export declare function isProtected(packageName: string): boolean;
/** Where a profile of this name lives under a given Harness home. */
export declare function resolveProfileDir(profileName: string, dshHome: string): string;
/**
 * Which profile this process booted, read back off the launcher's own argv.
 *
 * The launcher strips `--profile` before the plugin tree mounts and hands the
 * app only what followed it, so `ctx.cmdlineArgs` cannot answer this and no
 * environment variable carries it either. `process.argv` is untouched, though,
 * and the flag is still sitting in it.
 * @param argv - a launcher command line; `process.argv` by default.
 * @returns the profile name, or undefined when the app was not launched that way.
 */
export declare function activeProfileName(argv?: readonly string[]): string | undefined;
/**
 * Read a profile's manifest, or nothing at all.
 *
 * A profile directory that is missing, unreadable, or holding something other
 * than a JSON object is reported as "no plugins" rather than as an error: the
 * app has to keep running on a home it cannot read, and a broken manifest is
 * not something the terminal can fix anyway.
 * @param dir - the profile directory from {@link resolveProfileDir}.
 */
export declare function readProfileManifest(dir: string): ProfileManifest | undefined;
/**
 * Write a profile's manifest back.
 *
 * Two-space JSON with a trailing newline, which is what both the Harness's own
 * `writeProfileManifest` and this repo's install script emit — matching them
 * keeps an app-side edit out of the diff a user takes of their own profile.
 * @param dir - the profile directory from {@link resolveProfileDir}.
 * @param manifest - the manifest value to persist.
 */
export declare function writeProfileManifest(dir: string, manifest: ProfileManifest): void;
/**
 * Every package of a profile, enabled ones first in composition order.
 *
 * The two lists are unioned rather than intersected because each holds names
 * the other does not: an in-box layer like the base bundle is composed without
 * ever being a dependency, and a package can be installed with no layer of its
 * own. Enabled rows keep their `bundles` order, since that order is what the
 * launcher applies; the rest are alphabetical, having no order to preserve.
 * @param manifest - a parsed manifest, or undefined for an unreadable profile.
 */
export declare function listPlugins(manifest: ProfileManifest | undefined): PluginEntry[];
/** Whether a package is currently composed into the app. */
export declare function isPluginEnabled(manifest: ProfileManifest | undefined, packageName: string): boolean;
/**
 * Add a package to the layer stack, or take it out of it.
 *
 * Enabling appends. Patch layers compose in order and the last one to touch a
 * row wins, so a plugin somebody just turned on should be able to override
 * what was already there rather than be overridden by it. The base layer is
 * then pulled back to the front, because everything else patches over it.
 *
 * Nothing is installed or deleted here — the package stays exactly where the
 * package manager left it, and only the composed stack moves.
 * @param manifest - the profile manifest to edit.
 * @param packageName - the dependency to enable or disable.
 * @param enabled - the membership wanted.
 * @returns the manifest to write, or the original plus the reason it did not move.
 */
export declare function setPluginEnabled(manifest: ProfileManifest | undefined, packageName: string, enabled: boolean): BundleEdit;
/**
 * Drop a package from the layer stack whatever its protection, for use on the
 * way to removing it from disk.
 *
 * A name left in `dsh.profile.bundles` after its package is gone is not a
 * cosmetic leftover: the launcher fails loud on a listed bundle it cannot
 * resolve, so the profile would stop booting. The stack is therefore edited
 * first and the package manager run second — an interrupted removal then
 * leaves a package that is merely disabled, which still starts.
 * @param manifest - the profile manifest to edit.
 * @param packageName - the dependency about to be removed.
 */
export declare function forgetPlugin(manifest: ProfileManifest | undefined, packageName: string): BundleEdit;
/**
 * Decide whether a typed string may be handed to the package manager.
 *
 * There is no registry search behind this app, so the string is whatever
 * somebody typed, and it becomes one argument of a spawned process. The
 * grammar is therefore checked rather than escaped: a name that is not a name
 * is refused with a reason instead of being quoted and hoped about.
 * @param input - the raw `/plugins add` argument.
 */
export declare function parsePackageRequest(input: string): PackageRequestResult;
/**
 * Run the package manager in a profile directory.
 *
 * pnpm and not npm: a profile's dependency on a local checkout is a `link:`
 * spec, which npm rewrites into its own idea of a link and then loses on the
 * next install — so the Harness installs profiles with pnpm and this app has
 * to agree with it or it would quietly break the very profile it is editing.
 *
 * The run never throws and never reaches the terminal: output is piped, not
 * inherited, because the app owns the alternate screen and a package manager's
 * progress bars drawn into it would corrupt the frame. A failure comes back as
 * a line for the status bar.
 * @param dir - the profile directory to run in.
 * @param args - the manager's arguments, already validated.
 */
export declare function runPackageManager(dir: string, args: readonly string[]): Promise<PackageManagerRun>;
