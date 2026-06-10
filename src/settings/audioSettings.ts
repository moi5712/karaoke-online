export const AUDIO_SETTINGS_STORAGE_KEY = "ktv-audio-settings";

export interface PersistedAudioSettings {
  ytVolume: number;
  isMuted: boolean;
  ytPlaybackRate: number;
  ytPitch: number;
  micGainValue: number;
  echoEnabled: boolean;
  echoDelayValue: number;
  echoFeedbackValue: number;
  reverbEnabled: boolean;
  reverbWetValue: number;
  reverbRoomSize: number;
  panEnabled: boolean;
  voicePanValue: number;
  micLatencyMs: number;
  inEarMonitorEnabled: boolean;
  micActive: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: PersistedAudioSettings = {
  ytVolume: 70,
  isMuted: false,
  ytPlaybackRate: 1,
  ytPitch: 0,
  micGainValue: 1.0,
  echoEnabled: true,
  echoDelayValue: 0.25,
  echoFeedbackValue: 0.4,
  reverbEnabled: true,
  reverbWetValue: 0.18,
  reverbRoomSize: 1.8,
  panEnabled: true,
  voicePanValue: 0,
  micLatencyMs: 0,
  inEarMonitorEnabled: true,
  micActive: false,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeSettings(raw: Partial<PersistedAudioSettings>): PersistedAudioSettings {
  return {
    ytVolume: clamp(Number(raw.ytVolume ?? DEFAULT_AUDIO_SETTINGS.ytVolume), 0, 100),
    isMuted: Boolean(raw.isMuted),
    ytPlaybackRate: clamp(Number(raw.ytPlaybackRate ?? DEFAULT_AUDIO_SETTINGS.ytPlaybackRate), 0.5, 1.5),
    ytPitch: clamp(Number(raw.ytPitch ?? DEFAULT_AUDIO_SETTINGS.ytPitch), -6, 6),
    micGainValue: clamp(Number(raw.micGainValue ?? DEFAULT_AUDIO_SETTINGS.micGainValue), 0, 2),
    echoEnabled: raw.echoEnabled !== undefined ? Boolean(raw.echoEnabled) : DEFAULT_AUDIO_SETTINGS.echoEnabled,
    echoDelayValue: clamp(Number(raw.echoDelayValue ?? DEFAULT_AUDIO_SETTINGS.echoDelayValue), 0.05, 0.8),
    echoFeedbackValue: clamp(
      Number(raw.echoFeedbackValue ?? DEFAULT_AUDIO_SETTINGS.echoFeedbackValue),
      0,
      0.85
    ),
    reverbEnabled:
      raw.reverbEnabled !== undefined ? Boolean(raw.reverbEnabled) : DEFAULT_AUDIO_SETTINGS.reverbEnabled,
    reverbWetValue: clamp(
      Number(raw.reverbWetValue ?? DEFAULT_AUDIO_SETTINGS.reverbWetValue),
      0,
      1
    ),
    reverbRoomSize: clamp(
      Number(raw.reverbRoomSize ?? DEFAULT_AUDIO_SETTINGS.reverbRoomSize),
      0.5,
      3
    ),
    panEnabled: raw.panEnabled !== undefined ? Boolean(raw.panEnabled) : DEFAULT_AUDIO_SETTINGS.panEnabled,
    voicePanValue: clamp(Number(raw.voicePanValue ?? DEFAULT_AUDIO_SETTINGS.voicePanValue), -1, 1),
    micLatencyMs: clamp(Number(raw.micLatencyMs ?? DEFAULT_AUDIO_SETTINGS.micLatencyMs), 0, 500),
    inEarMonitorEnabled:
      raw.inEarMonitorEnabled !== undefined
        ? Boolean(raw.inEarMonitorEnabled)
        : DEFAULT_AUDIO_SETTINGS.inEarMonitorEnabled,
    micActive: Boolean(raw.micActive),
  };
}

let cachedSettings: PersistedAudioSettings | null = null;

export function loadAudioSettings(): PersistedAudioSettings {
  if (cachedSettings) return cachedSettings;

  if (typeof window === "undefined") {
    cachedSettings = DEFAULT_AUDIO_SETTINGS;
    return cachedSettings;
  }

  try {
    const raw = localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY);
    if (!raw) {
      cachedSettings = DEFAULT_AUDIO_SETTINGS;
      return cachedSettings;
    }

    cachedSettings = sanitizeSettings(JSON.parse(raw) as Partial<PersistedAudioSettings>);
    return cachedSettings;
  } catch {
    cachedSettings = DEFAULT_AUDIO_SETTINGS;
    return cachedSettings;
  }
}

export function saveAudioSettings(settings: PersistedAudioSettings): void {
  const sanitized = sanitizeSettings(settings);
  cachedSettings = sanitized;

  if (typeof window === "undefined") return;

  localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify(sanitized));
}
