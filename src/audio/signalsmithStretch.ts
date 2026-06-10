import SignalsmithStretch from "signalsmith-stretch";

export interface StretchScheduleOptions {
  output?: number;
  active?: boolean;
  input?: number;
  rate?: number;
  semitones?: number;
  tonalityHz?: number;
  formantSemitones?: number;
  formantCompensation?: boolean;
  formantBaseHz?: number;
  loopStart?: number;
  loopEnd?: number;
}

export interface SignalsmithStretchNode extends AudioNode {
  schedule(options: StretchScheduleOptions, replace?: boolean): void;
  start(when?: number): void;
  stop(when?: number): void;
  latency(): number;
  configure(options: {
    blockMs?: number | null;
    intervalMs?: number;
    splitComputation?: boolean;
    preset?: string;
  }): void;
}

/** Compensate for media-element playbackRate when stretch runs in live-input mode. */
export function computeStretchSemitones(pitchSemitones: number, playbackRate: number): number {
  if (playbackRate <= 0 || playbackRate === 1) return pitchSemitones;
  return pitchSemitones - 12 * Math.log2(playbackRate);
}

export async function createSignalsmithStretchNode(
  audioCtx: AudioContext
): Promise<SignalsmithStretchNode> {
  const node = await SignalsmithStretch(audioCtx);
  return node as SignalsmithStretchNode;
}

export function applyStretchPitchAndRate(
  node: SignalsmithStretchNode,
  pitchSemitones: number,
  playbackRate: number
): void {
  node.schedule({ semitones: computeStretchSemitones(pitchSemitones, playbackRate) });
}
