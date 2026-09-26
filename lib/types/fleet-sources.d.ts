/**
 * Collecting presence records from this device and its peers.
 *
 * The transport is SSH, for one reason: it is the only channel in this setup
 * that is already authenticated, already encrypted, and already working. The
 * Harness's own web server offers no TLS, no authentication and no origin
 * policy, and binding it off loopback would publish every route on the
 * network — so the overview never does that.
 *
 * Every remote read is one short, non-interactive command. Nothing is
 * installed on the peer beyond dsh itself, and nothing listens anywhere.
 * @module
 */
import { type FleetSource } from './tui/fleet.ts';
/** A peer device the overview should include. */
export interface PeerConfig {
    /** Anything `ssh` accepts: a host, an alias, or user@host. */
    host: string;
    /** `$DSH_HOME` on that device; defaults to `~/.dsh` there. */
    dshHome?: string;
}
/** Resolve this device's Harness home the way the Harness itself does. */
export declare function localDshHome(env?: NodeJS.ProcessEnv): string;
/** Read this device's records. */
export declare function collectLocal(dshHome?: string): FleetSource;
/**
 * Read one peer's records over SSH.
 *
 * `BatchMode=yes` matters: a peer whose key is missing must fail fast with an
 * error in the overview rather than blocking the UI on a password prompt.
 */
export declare function collectPeer(peer: PeerConfig): Promise<FleetSource>;
/** Read every device in parallel; one slow peer must not hold up the rest. */
export declare function collectFleet(peers: readonly PeerConfig[], dshHome?: string): Promise<FleetSource[]>;
