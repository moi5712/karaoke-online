/// <reference types="vite/client" />

declare module "signalsmith-stretch" {
  interface SignalsmithStretchNode extends AudioNode {
    schedule(options: Record<string, unknown>, replace?: boolean): void;
    start(when?: number): void;
    stop(when?: number): void;
    latency(): number;
    configure(options: Record<string, unknown>): void;
  }

  export default function SignalsmithStretch(
    audioContext: AudioContext,
    channelOptions?: AudioWorkletNodeOptions
  ): Promise<SignalsmithStretchNode>;
}
