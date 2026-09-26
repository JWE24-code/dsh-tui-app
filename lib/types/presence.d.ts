/**
 * Publishing what this device is doing, for the fleet overview.
 *
 * Each open session gets one small JSON file under `$DSH_HOME/tui-presence`,
 * refreshed on a heartbeat and deleted on exit. The file's age is the liveness
 * signal — `session.lock` in the session store is not, because it is an empty
 * flock target that outlives the process that made it.
 *
 * Nothing here listens on a port. The records are ordinary files, read by
 * another device over SSH, so the fleet overview adds no network surface and
 * no credentials of its own.
 * @module
 */
import { type PresenceRecord, type PresenceStatus } from './tui/fleet.ts';
/** Directory holding this device's presence records. */
export declare function presenceDir(dshHome: string): string;
/** What the app tells the publisher about one session. */
export interface PresenceInput {
    sessionId: string;
    title: string;
    status: PresenceStatus;
    model?: string;
    cwd?: string;
}
/**
 * Writes and refreshes this device's presence records.
 *
 * The publisher is deliberately forgiving: a read-only or missing home must
 * degrade to publishing nothing, never to failing a turn. The overview is a
 * convenience, and a device that cannot publish simply does not appear.
 */
export declare class PresencePublisher {
    private readonly dir;
    private readonly host;
    private readonly owned;
    private timer;
    private snapshot;
    private disabled;
    constructor(dshHome: string, host?: string);
    /** Begin heartbeating. `intervalMs` must be well under the stale threshold. */
    start(intervalMs?: number): void;
    /** Publish the current set of sessions, replacing whatever was there. */
    publish(sessions: readonly PresenceInput[]): void;
    /** Remove every record this process published. Safe to call repeatedly. */
    stop(): void;
}
/** Read every presence record in a directory, skipping anything malformed. */
export declare function readPresenceDir(dir: string): PresenceRecord[];
