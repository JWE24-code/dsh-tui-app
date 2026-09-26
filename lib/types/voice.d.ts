/**
 * Push-to-talk dictation, transcribed on this machine and nowhere else.
 *
 * The whole point of this feature is that a prompt spoken into the composer
 * never becomes somebody else's training data, so there is no cloud endpoint
 * here and no API key to lose: audio is captured by whatever recorder the
 * system already has and handed to a local `whisper.cpp` binary. That also
 * means the app cannot depend on any of it. A machine with no microphone
 * stack, no whisper build, or no model is the normal case, not the error
 * case — so every probe below reports what is missing in one line a person
 * can act on, and the app is otherwise untouched.
 *
 * Nothing in this module is a runtime dependency of the bundle: the recorder
 * and the transcriber are external processes discovered on `PATH`, and the
 * decision logic is pure so it can be tested without either of them.
 * @module
 */
import type { ChildProcess } from 'node:child_process';
/** How long a transcription may run before it is killed, in milliseconds. */
export declare const TRANSCRIBE_TIMEOUT_MS = 120000;
/** How long a recorder gets to flush its WAV header after a stop, in milliseconds. */
export declare const RECORDER_FLUSH_MS = 2000;
/**
 * A recorder this app knows how to drive.
 *
 * Every entry must produce 16 kHz mono signed 16-bit PCM, because that is the
 * only format whisper.cpp reads without resampling it itself.
 */
export interface RecorderSpec {
    /** Executable to look for on `PATH`. */
    command: string;
    /** Package a person would install to get it, for the missing-dependency line. */
    packageName: string;
    /** Arguments that write the capture to `target`. */
    args: (target: string) => string[];
}
/**
 * Recorders in the order they are preferred.
 *
 * `arecord` comes first because on Linux it is part of alsa-utils, which is
 * already installed anywhere sound works at all, and it talks to ALSA
 * directly. `rec` and `sox` are the same program wearing two names; `rec`
 * defaults to the system input device while `sox` has to be told `-d`, which
 * is why they cannot share one entry.
 */
export declare const RECORDERS: readonly RecorderSpec[];
/**
 * Names whisper.cpp has shipped its command-line front end under.
 *
 * `whisper-cli` is what upstream builds today and `whisper-cpp` is what most
 * distributions rename it to. Plain `main` is last on purpose: it is the
 * historic name of the build output and still what an in-tree build produces,
 * but it is far too generic to trust ahead of anything else on `PATH`.
 */
export declare const WHISPER_COMMANDS: readonly string[];
/** Directories searched for a model when none was configured. */
export declare const MODEL_DIRECTORIES: readonly string[];
/**
 * Model files looked for inside each directory, best first.
 *
 * Dictation is a handful of seconds of one speaker close to the microphone,
 * which `base` already handles, so the ordering trades accuracy for the
 * latency a person is standing there waiting through. English-only weights
 * win their size class because they are measurably better at it.
 */
export declare const MODEL_FILES: readonly string[];
/** What the user configured, from flags and the environment. */
export interface VoiceOptions {
    /** `--voice-model`, an explicit path to a ggml weights file. */
    model?: string;
    /** `--voice-bin`, an explicit path to or name of the whisper executable. */
    binary?: string;
    /** `MOQI_WHISPER_MODEL`, the same thing from the environment. */
    envModel?: string;
    /** `MOQI_WHISPER_BIN`, the same thing from the environment. */
    envBinary?: string;
    /** `MOQI_WHISPER_LANG`; absent lets whisper use its own default. */
    language?: string;
}
/** The filesystem questions {@link resolveVoiceSetup} needs answered. */
export interface VoiceProbe {
    /** Whether this command resolves to something executable on `PATH`. */
    hasCommand: (command: string) => boolean;
    /** Whether this path exists and can be read. */
    exists: (path: string) => boolean;
    /** Home directory the `~` in {@link MODEL_DIRECTORIES} expands to. */
    home: string;
}
/** The one thing that stopped voice input from being usable. */
export type VoiceGap = 
/** Nothing on the system can capture audio. */
{
    kind: 'recorder';
}
/** No whisper.cpp front end could be found. */
 | {
    kind: 'binary';
}
/** A binary was named explicitly and is not there. */
 | {
    kind: 'binary-missing';
    path: string;
    source: 'flag' | 'env';
}
/** A model was named explicitly and is not there. */
 | {
    kind: 'model-missing';
    path: string;
    source: 'flag' | 'env';
}
/** Nothing was named and the default search came up empty. */
 | {
    kind: 'model-unfound';
};
/** Everything needed to record and transcribe, once every probe has passed. */
export interface VoiceSetup {
    recorder: RecorderSpec;
    /** Command or absolute path to spawn for transcription. */
    binary: string;
    /** Absolute path to the ggml weights. */
    model: string;
    /** Language code to force, when one was configured. */
    language: string | undefined;
}
/** Either a usable setup or the first thing missing from it. */
export type VoiceResolution = {
    ok: true;
    setup: VoiceSetup;
} | {
    ok: false;
    gap: VoiceGap;
};
/**
 * Decide whether voice input can run, and with what.
 *
 * Pure apart from the injected probe, because the interesting part is the
 * order the three dependencies are reported in and that is worth testing
 * without a microphone: the recorder comes first because it is the one a
 * person is most likely to already have, then the binary, then the weights —
 * which is also the order in which they get harder to install.
 */
export declare function resolveVoiceSetup(options: VoiceOptions, probe: VoiceProbe): VoiceResolution;
/** Resolve the weights from the flag, the environment, or the default search. */
export declare function resolveModel(options: VoiceOptions, probe: VoiceProbe): {
    ok: true;
    path: string;
} | {
    ok: false;
    gap: VoiceGap;
};
/**
 * One line saying what is missing and how to get it.
 *
 * Deliberately a single sentence with a concrete next step in it: this lands
 * in the footer, which is one line wide, and an error there that only says
 * "voice unavailable" costs the reader a search through the README.
 */
export declare function voiceGapMessage(gap: VoiceGap): string;
/**
 * Arguments for one transcription run.
 *
 * `-np` suppresses whisper.cpp's banner and progress so the only thing left
 * on stdout is the transcript; the segment timestamps are deliberately kept,
 * because they are the one marker that reliably separates a result line from
 * whatever a given build still prints alongside it.
 */
export declare function whisperArgs(setup: VoiceSetup, wavPath: string): string[];
/**
 * Turn whisper's stdout into the text a person meant to say.
 *
 * whisper.cpp prints one line per segment, `[00:00:00.000 --> 00:00:02.000]`
 * and then the words. When any such line is present those lines are the whole
 * answer and everything else is noise from a build that ignored `-np`; when
 * none is, the build was asked for plain output and the lines are the text —
 * minus the log chatter, which is recognisable by its `prefix:` shape.
 */
export declare function parseWhisperText(stdout: string): string;
/**
 * The text to splice into the composer at `cursor`.
 *
 * Dictation is usually appended to something already typed, and two utterances
 * running together into one word is the kind of small wrongness that makes a
 * feature feel broken, so a separator is added when the character before the
 * cursor is not already one.
 */
export declare function insertionFor(value: string, cursor: number, transcript: string): string;
/** Whether a command resolves to an executable somewhere on `PATH`. */
export declare function hasCommand(command: string, env?: NodeJS.ProcessEnv): boolean;
/** Whether a path exists and is readable. */
export declare function fileExists(path: string): boolean;
/** The probe that answers against the real filesystem. */
export declare function systemProbe(env?: NodeJS.ProcessEnv): VoiceProbe;
/** Read the environment half of the configuration. */
export declare function voiceOptionsFromEnv(env?: NodeJS.ProcessEnv): VoiceOptions;
/** A capture in progress: the recorder process and the file it is filling. */
export interface Recording {
    child: ChildProcess;
    wavPath: string;
}
/**
 * Start the recorder.
 *
 * stdio is fully detached from this process's own: the app owns the alternate
 * screen buffer, and a recorder writing a warning onto it would tear the frame
 * apart with no way to repaint the damage.
 */
export declare function startRecording(setup: VoiceSetup, wavPath: string): Recording;
/**
 * Stop the recorder and wait for the file to be finished.
 *
 * SIGINT rather than SIGTERM because both recorders treat it as "wrap up":
 * they close the WAV and go back and write the real length into the header.
 * Killed harder, the file is left claiming a length of zero and whisper reads
 * nothing out of it. The hard kill is only the fallback for a recorder that
 * ignores the polite request.
 */
export declare function stopRecording(recording: Recording): Promise<void>;
/**
 * Transcribe one WAV file and return the text.
 *
 * Rejects with a one-line message rather than an exec error, because the
 * caller puts whatever comes back straight into a status line that is one
 * line wide.
 */
export declare function transcribe(setup: VoiceSetup, wavPath: string): Promise<string>;
/** A one-line reason a transcription run failed. */
export declare function transcribeError(error: unknown, stderr: string): string;
