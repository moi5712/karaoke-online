import {
  applyStretchPitchAndRate,
  createSignalsmithStretchNode,
} from "./signalsmithStretch";

// ─── Constants ───────────────────────────────────────────────────────────────

export const PREFERRED_AUDIO_SAMPLE_RATE = 48000;

/** Average delay between hearing the beat and starting to sing. */
export const SINGING_REACTION_MS = 50;
/** Used only when path measurement fails entirely. */
export const SOUNDTOUCH_PIPELINE_MS = 110;

// ─── Basic codec helpers ──────────────────────────────────────────────────────

export async function decodeAudioBlob(ctx: BaseAudioContext, blob: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  return ctx.decodeAudioData(arrayBuffer.slice(0));
}

export async function resampleAudioBuffer(
  buffer: AudioBuffer,
  targetSampleRate: number
): Promise<AudioBuffer> {
  if (buffer.sampleRate === targetSampleRate) return buffer;

  const length = Math.ceil(buffer.duration * targetSampleRate);
  const offline = new OfflineAudioContext(
    buffer.numberOfChannels,
    length,
    targetSampleRate
  );
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start(0);
  return offline.startRendering();
}

export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

export function getRecorderMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

export function isValidAudioBlob(blob: Blob): boolean {
  return blob.size > 32;
}

// ─── Audio analysis ───────────────────────────────────────────────────────────

export function hasAudibleContent(buffer: AudioBuffer, rmsThreshold = 0.002): boolean {
  let sumSquares = 0;
  let count = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      sumSquares += data[i] * data[i];
      count++;
    }
  }
  if (count === 0) return false;
  return Math.sqrt(sumSquares / count) > rmsThreshold;
}

export function bufferToMonoFloat(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0).slice();
  }

  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const channel = buffer.getChannelData(ch);
    for (let i = 0; i < buffer.length; i++) {
      mono[i] += channel[i];
    }
  }
  for (let i = 0; i < mono.length; i++) {
    mono[i] /= buffer.numberOfChannels;
  }
  return mono;
}

// ─── Duration correction ──────────────────────────────────────────────────────

export async function correctBufferToExpectedDuration(
  buffer: AudioBuffer,
  expectedDurationSec: number
): Promise<AudioBuffer> {
  if (!Number.isFinite(expectedDurationSec) || expectedDurationSec <= 0) return buffer;

  const actualDuration = buffer.duration;
  if (actualDuration <= 0) return buffer;

  const drift = Math.abs(actualDuration - expectedDurationSec) / expectedDurationSec;
  if (drift < 0.04) return buffer;

  const playbackRate = actualDuration / expectedDurationSec;
  const targetLength = Math.max(1, Math.round(expectedDurationSec * buffer.sampleRate));
  const offline = new OfflineAudioContext(
    buffer.numberOfChannels,
    targetLength,
    buffer.sampleRate
  );
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = playbackRate;
  src.connect(offline.destination);
  src.start(0);
  return offline.startRendering();
}

export async function blobToWav(blob: Blob, expectedDurationSec?: number): Promise<Blob> {
  const decodeCtx = new AudioContext();
  try {
    let buffer = await decodeAudioBlob(decodeCtx, blob);
    if (expectedDurationSec) {
      buffer = await correctBufferToExpectedDuration(buffer, expectedDurationSec);
    }
    return audioBufferToWav(buffer);
  } finally {
    await decodeCtx.close();
  }
}

// ─── Latency measurement ──────────────────────────────────────────────────────

export function clampLatencyStep(ms: number): number {
  return Math.min(500, Math.max(0, Math.round(ms / 5) * 5));
}

function createLatencyTestReference(sampleRate: number): Float32Array {
  const burstSamples = Math.floor(0.03 * sampleRate);
  const reference = new Float32Array(burstSamples);
  for (let i = 0; i < burstSamples; i++) {
    const t = i / sampleRate;
    const envelope = 1 - i / burstSamples;
    reference[i] = 0.9 * envelope * Math.sin(2 * Math.PI * 1847 * t);
  }
  return reference;
}

function findBestLagSamples(
  reference: Float32Array,
  recorded: Float32Array,
  maxLagSamples: number
): number {
  let bestLag = 0;
  let bestScore = -Infinity;
  const refEnergy = reference.reduce((sum, value) => sum + value * value, 0);
  if (refEnergy < 1e-8) return 0;

  for (let lag = 0; lag < maxLagSamples; lag++) {
    const len = Math.min(reference.length, recorded.length - lag);
    if (len <= 32) break;

    let corr = 0;
    let recEnergy = 0;
    for (let i = 0; i < len; i++) {
      const sample = recorded[i + lag];
      corr += reference[i] * sample;
      recEnergy += sample * sample;
    }
    const score = corr / (Math.sqrt(refEnergy * recEnergy) + 1e-9);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  if (bestScore < 0.25) {
    throw new Error("Latency detection correlation too low");
  }
  return bestLag;
}

export function estimateExportLatencyMs(audioCtx: AudioContext): number {
  const base = audioCtx.baseLatency ?? 0;
  const output = audioCtx.outputLatency ?? 0;
  const input = (audioCtx as AudioContext & { inputLatency?: number }).inputLatency ?? 0;
  return clampLatencyStep((base + output + input) * 1000 + SOUNDTOUCH_PIPELINE_MS + SINGING_REACTION_MS);
}

function measureMarkerLagMs(
  reference: Float32Array,
  backing: Float32Array,
  mic: Float32Array,
  sampleRate: number
): number {
  const maxLagSamples = Math.floor(0.5 * sampleRate);
  const backingLag = findBestLagSamples(
    reference,
    backing,
    Math.min(maxLagSamples, backing.length)
  );
  const micLag = findBestLagSamples(
    reference,
    mic,
    maxLagSamples
  );
  const pathLagMs = ((micLag - backingLag) / sampleRate) * 1000;
  if (pathLagMs < 0) {
    throw new Error("Negative path latency");
  }
  return clampLatencyStep(pathLagMs + SINGING_REACTION_MS);
}

export interface ExportLatencyMeasureOptions {
  micGain: GainNode;
  echoWetGain: GainNode | null;
  reverbWetGain: GainNode | null;
  duckGain: GainNode | null;
  playbackRate: number;
  pitch: number;
}

export async function measureExportPathLatencyMs(
  audioCtx: AudioContext,
  options: ExportLatencyMeasureOptions
): Promise<number> {
  const { micGain, echoWetGain, reverbWetGain, duckGain, playbackRate, pitch } = options;
  const sampleRate = audioCtx.sampleRate;
  const reference = createLatencyTestReference(sampleRate);
  const recordMs = 650;
  const mimeType = getRecorderMimeType();

  const vocalDest = audioCtx.createMediaStreamDestination();
  const backingDest = audioCtx.createMediaStreamDestination();

  micGain.connect(vocalDest);
  if (echoWetGain) {
    echoWetGain.connect(vocalDest);
  }
  if (reverbWetGain) {
    reverbWetGain.connect(vocalDest);
  }

  const calStretchNode = await createSignalsmithStretchNode(audioCtx);
  applyStretchPitchAndRate(calStretchNode, pitch, playbackRate);
  calStretchNode.start();

  const injectGain = audioCtx.createGain();
  injectGain.gain.value = 0.4;
  const routeGain = audioCtx.createGain();
  routeGain.gain.value = 1;

  injectGain.connect(calStretchNode);
  calStretchNode.connect(routeGain);
  routeGain.connect(audioCtx.destination);
  routeGain.connect(backingDest);

  const playBuffer = audioCtx.createBuffer(1, reference.length, sampleRate);
  playBuffer.getChannelData(0).set(reference);
  const testSource = audioCtx.createBufferSource();
  testSource.buffer = playBuffer;
  testSource.playbackRate.value = playbackRate;
  testSource.connect(injectGain);

  const previousDuck = duckGain?.gain.value ?? null;
  if (duckGain) {
    duckGain.gain.setValueAtTime(0, audioCtx.currentTime);
  }

  const vocalRecorder = new MediaRecorder(
    vocalDest.stream,
    mimeType ? { mimeType } : undefined
  );
  const backingRecorder = new MediaRecorder(
    backingDest.stream,
    mimeType ? { mimeType } : undefined
  );

  const vocalChunks: BlobPart[] = [];
  const backingChunks: BlobPart[] = [];
  vocalRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) vocalChunks.push(event.data);
  };
  backingRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) backingChunks.push(event.data);
  };

  vocalRecorder.start();
  backingRecorder.start();

  const startAt = audioCtx.currentTime + 0.1;
  testSource.start(startAt);
  testSource.stop(startAt + reference.length / sampleRate + 0.02);

  await new Promise((resolve) => window.setTimeout(resolve, recordMs));

  vocalRecorder.stop();
  backingRecorder.stop();

  await new Promise((resolve) => window.setTimeout(resolve, 80));

  try {
    micGain.disconnect(vocalDest);
    if (echoWetGain) {
      echoWetGain.disconnect(vocalDest);
    }
    if (reverbWetGain) {
      reverbWetGain.disconnect(vocalDest);
    }
    injectGain.disconnect();
    testSource.disconnect();
    calStretchNode.stop();
    calStretchNode.disconnect();
    routeGain.disconnect();
    if (duckGain && previousDuck !== null) {
      duckGain.gain.setValueAtTime(previousDuck, audioCtx.currentTime);
    }
  } catch {
    // ignore cleanup errors
  }

  const vocalBlob = new Blob(vocalChunks, { type: mimeType ?? "audio/webm" });
  const backingBlob = new Blob(backingChunks, { type: mimeType ?? "audio/webm" });
  if (!isValidAudioBlob(vocalBlob) || !isValidAudioBlob(backingBlob)) {
    throw new Error("Calibration recording is empty");
  }

  const decodeCtx = new AudioContext();
  try {
    const [vocalRaw, backingRaw] = await Promise.all([
      decodeAudioBlob(decodeCtx, vocalBlob),
      decodeAudioBlob(decodeCtx, backingBlob),
    ]);
    const targetRate = Math.max(vocalRaw.sampleRate, backingRaw.sampleRate);
    const [vocalResampled, backingResampled] = await Promise.all([
      resampleAudioBuffer(vocalRaw, targetRate),
      resampleAudioBuffer(backingRaw, targetRate),
    ]);
    const vocal = bufferToMonoFloat(vocalResampled);
    const backing = bufferToMonoFloat(backingResampled);
    return measureMarkerLagMs(reference, backing, vocal, targetRate);
  } finally {
    await decodeCtx.close();
  }
}

// ─── Mix export ───────────────────────────────────────────────────────────────

export async function mergeRecordingWithLatency(
  vocalBlob: Blob,
  backingBlob: Blob,
  latencyMs: number,
  expectedDurationSec?: number
): Promise<Blob> {
  const decodeCtx = new AudioContext();
  try {
    const [vocalRaw, backingRaw] = await Promise.all([
      decodeAudioBlob(decodeCtx, vocalBlob),
      decodeAudioBlob(decodeCtx, backingBlob),
    ]);

    if (!hasAudibleContent(backingRaw)) {
      return blobToWav(vocalBlob, expectedDurationSec);
    }

    const sampleRate = Math.max(vocalRaw.sampleRate, backingRaw.sampleRate);
    let [vocalBuf, backingBuf] = await Promise.all([
      resampleAudioBuffer(vocalRaw, sampleRate),
      resampleAudioBuffer(backingRaw, sampleRate),
    ]);

    if (expectedDurationSec) {
      vocalBuf = await correctBufferToExpectedDuration(vocalBuf, expectedDurationSec);
    }

    // User sings to monitor (output delayed); digital backing in recording is ahead of vocal.
    // Delay backing so exported mix aligns with what the singer heard.
    const backingOffsetSec = Math.max(0, latencyMs / 1000);
    const backingOffsetSamples = Math.round(backingOffsetSec * sampleRate);
    const totalLength = Math.max(vocalBuf.length, backingBuf.length + backingOffsetSamples);

    const offline = new OfflineAudioContext(2, totalLength, sampleRate);

    const vocalSrc = offline.createBufferSource();
    vocalSrc.buffer = vocalBuf;
    vocalSrc.connect(offline.destination);
    vocalSrc.start(0);

    const backingSrc = offline.createBufferSource();
    backingSrc.buffer = backingBuf;
    backingSrc.connect(offline.destination);
    backingSrc.start(backingOffsetSec);

    const rendered = await offline.startRendering();
    return audioBufferToWav(rendered);
  } finally {
    await decodeCtx.close();
  }
}
