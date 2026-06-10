/** Synthetic stereo impulse response with early reflections + diffuse tail. */
export function createReverbImpulseResponse(
  ctx: BaseAudioContext,
  durationSec: number,
  roomSize = 1.5
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * durationSec));
  const impulse = ctx.createBuffer(2, length, sampleRate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);

  // Keep the impulse energetic enough to hear, but not so hot that wet mix overwhelms dry vocals.
  left[0] = 0.35;
  right[0] = 0.33;

  const roomScale = 0.65 + roomSize * 0.25;
  const decay = 2.2 + (3 - roomSize) * 0.45;
  const earlyReflectionTimesSec = [
    0.007, 0.013, 0.019, 0.027, 0.036, 0.046, 0.058, 0.071,
    0.086, 0.103, 0.122, 0.145, 0.172, 0.203, 0.24, 0.285,
  ];

  for (const timeSec of earlyReflectionTimesSec) {
    const index = Math.floor(timeSec * roomScale * sampleRate);
    if (index <= 0 || index >= length) continue;
    const strength = 0.08 + Math.random() * 0.1;
    left[index] += (Math.random() < 0.5 ? 1 : -1) * strength;
    right[index] += (Math.random() < 0.5 ? 1 : -1) * strength * 0.94;
  }

  for (let i = 1; i < length; i++) {
    const progress = i / length;
    const envelope = Math.pow(1 - progress, decay);
    left[i] += (Math.random() * 2 - 1) * envelope * 0.24;
    right[i] += (Math.random() * 2 - 1) * envelope * 0.22;
  }

  return impulse;
}
