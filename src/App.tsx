import { useState, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import {
  Play,
  Pause, 
  SkipForward, 
  Volume2, 
  VolumeX, 
  Trash2, 
  Plus,
  Minus,
  RotateCcw, 
  ListMusic, 
  Sliders, 
  Volume1,
  Gauge,
  Timer,
  Loader2,
  Youtube,
} from "lucide-react";
import {
  applyStretchPitchAndRate,
  createSignalsmithStretchNode,
  type SignalsmithStretchNode,
} from "./audio/signalsmithStretch";
import {
  decodeAudioBlob,
  resampleAudioBuffer,
  audioBufferToWav,
  blobToWav,
  hasAudibleContent,
  correctBufferToExpectedDuration,
  isValidAudioBlob,
  mergeRecordingWithLatency,
  clampLatencyStep,
  getRecorderMimeType,
  estimateExportLatencyMs,
  measureExportPathLatencyMs,
  PREFERRED_AUDIO_SAMPLE_RATE,
  SINGING_REACTION_MS,
  SOUNDTOUCH_PIPELINE_MS,
  type ExportLatencyMeasureOptions,
} from "./audio/audioUtils";
import {
  Badge,
  Button,
  Card,
  IconButton,
  KaraokeLayout,
  PanelHeader,
  SearchInput,
  RecStrip,
  Slider,
  ToggleDot,
  getSpectrumColors,
  Surface,
  SpectrumBars,
  StatusDot,
  Text,
  ThemeToggle,
  ToastContainer,
  useTheme,
  useToast,
  cn,
} from "./design-system";
import { loadAudioSettings, saveAudioSettings } from "./settings/audioSettings";
import { createReverbImpulseResponse } from "./audio/reverbImpulse";

// Each HTMLMediaElement may only be passed to createMediaElementSource once per lifetime.
// We keep BOTH a WeakMap (fast GC-friendly lookup) and an expando property on the element
// itself so the cache survives Vite HMR module reloads (the WeakMap is module-level and
// gets reset on hot-reload, but the DOM element and its properties survive Fast Refresh).
const backingMediaSourceByElement = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
const BACKING_SOURCE_EXPANDO = "__backingMediaSource";

function getOrCreateBackingSource(
  audioEl: HTMLMediaElement,
  audioCtx: AudioContext
): MediaElementAudioSourceNode | null {
  // Fast path: WeakMap hit (normal run, no HMR reset)
  const cached = backingMediaSourceByElement.get(audioEl);
  if (cached) return cached;

  // Fallback: expando property survives HMR module reloads
  const expando = (audioEl as any)[BACKING_SOURCE_EXPANDO] as MediaElementAudioSourceNode | undefined;
  if (expando) {
    // Re-populate the WeakMap so subsequent calls stay on the fast path
    backingMediaSourceByElement.set(audioEl, expando);
    return expando;
  }

  // First time: create the source node
  try {
    const source = audioCtx.createMediaElementSource(audioEl);
    backingMediaSourceByElement.set(audioEl, source);
    (audioEl as any)[BACKING_SOURCE_EXPANDO] = source;
    return source;
  } catch (err) {
    console.error("Failed to create backing audio graph:", err);
    return null;
  }
}

// Types for Song and Playlist item
interface Song {
  id: string;
  title: string;
  artist: string;
  category: string;
  isKtvBacking?: boolean;
}

interface SongPlayStat {
  song: Song;
  count: number;
  lastPlayedAt: number;
}

const SONG_HISTORY_STORAGE_KEY = "ktv-song-history";
const SONG_PLAY_STATS_STORAGE_KEY = "ktv-song-play-stats";

function isSong(value: unknown): value is Song {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Song>;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.artist === "string" &&
    typeof item.category === "string"
  );
}

function loadSongHistory(): Song[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SONG_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSong).slice(0, 10);
  } catch {
    return [];
  }
}

function loadSongPlayStats(): Record<string, SongPlayStat> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(SONG_PLAY_STATS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};

    const entries = Object.entries(parsed as Record<string, unknown>);
    const sanitized: Record<string, SongPlayStat> = {};
    for (const [songId, value] of entries) {
      if (!value || typeof value !== "object") continue;
      const item = value as Partial<SongPlayStat>;
      if (!isSong(item.song)) continue;
      const count = Number(item.count);
      const lastPlayedAt = Number(item.lastPlayedAt);
      if (!Number.isFinite(count) || !Number.isFinite(lastPlayedAt) || count <= 0) continue;
      sanitized[songId] = {
        song: item.song,
        count,
        lastPlayedAt,
      };
    }
    return sanitized;
  } catch {
    return {};
  }
}

// Global window cast helper
declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
    YT: any;
  }
}

interface KnobControlProps {
  label: string;
  value: number;
  displayValue: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  dimmed?: boolean;
  toggleActive?: boolean;
  onToggle?: () => void;
  toggleAccent?: "primary" | "secondary" | "success";
}

function clampValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function KnobControl({
  label,
  value,
  displayValue,
  min,
  max,
  step = 0.01,
  onChange,
  disabled,
  dimmed,
  toggleActive,
  onToggle,
  toggleAccent = "primary",
}: KnobControlProps) {
  const dragStartYRef = useRef(0);
  const dragStartValueRef = useRef(0);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const ratio = (value - min) / (max - min || 1);
  const clampedRatio = clampValue(ratio, 0, 1);
  // arc: 135° (7:30, lower-left) clockwise to 45° (4:30, lower-right), 270° total sweep
  // indicator angle: starts at 135° (min), passes through -90° (12 o'clock, centre), ends at 45° (max)
  const angleDeg = -225 + clampedRatio * 270;
  const angleRad = (angleDeg * Math.PI) / 180;

  // SVG knob geometry (viewBox 0 0 48 48, centre 24 24)
  const R = 20;   // outer ring radius
  const r = 17;   // inner cap radius
  const trackWidth = 2;
  const cx = 24;
  const cy = 24;
  // Arc endpoints for the "track" (from 135° lower-left to 45° lower-right)
  const arcStart = { x: cx + R * Math.cos(( 135 * Math.PI) / 180), y: cy + R * Math.sin(( 135 * Math.PI) / 180) };
  const arcEnd   = { x: cx + R * Math.cos((  45 * Math.PI) / 180), y: cy + R * Math.sin((  45 * Math.PI) / 180) };
  // Value arc endpoint
  const arcVal   = { x: cx + R * Math.cos(angleRad), y: cy + R * Math.sin(angleRad) };
  // Indicator dot — near cap rim with small inset
  const dotR = r - 3;
  const dotX = cx + dotR * Math.cos(angleRad);
  const dotY = cy + dotR * Math.sin(angleRad);

  const applyNextValue = (next: number) => {
    const snapped = Math.round(next / step) * step;
    onChange(clampValue(snapped, min, max));
  };

  // React registers onWheel as a passive listener, so event.preventDefault() inside
  // it is ignored and logs a warning. Attach a native non-passive listener instead.
  const wheelHandlerRef = useRef<(event: WheelEvent) => void>(() => {});
  wheelHandlerRef.current = (event: WheelEvent) => {
    event.preventDefault();
    if (disabled) return;
    const direction = event.deltaY > 0 ? -1 : 1;
    applyNextValue(value + direction * step);
  };
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => wheelHandlerRef.current(event);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const startDrag = (clientY: number) => {
    if (disabled) return;
    dragStartYRef.current = clientY;
    dragStartValueRef.current = value;

    const onMove = (event: MouseEvent) => {
      const deltaY = dragStartYRef.current - event.clientY;
      const deltaRatio = deltaY / 150;
      const next = dragStartValueRef.current + deltaRatio * (max - min);
      applyNextValue(next);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // large-arc-flag: 1 if sweep > 180°
  const sweepDeg = clampedRatio * 270;
  const largeArc = sweepDeg > 180 ? 1 : 0;

  return (
    <div
      className={cn(
        "knob-control flex h-full min-h-0 w-full flex-col items-center rounded-2xl bg-surface-raised p-2",
        dimmed && "knob-control--dimmed"
      )}
    >
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="text-[11px] font-bold text-neutral-300 leading-none">{label}</span>
        {onToggle ? (
          <ToggleDot
            active={Boolean(toggleActive)}
            onToggle={onToggle}
            accent={toggleAccent}
          />
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 w-full items-center justify-center">
        <svg
          ref={svgRef}
          viewBox="0 0 48 48"
          className={cn(
            "aspect-square h-full w-auto max-w-full cursor-ns-resize select-none",
            disabled && "opacity-40 cursor-not-allowed"
          )}
          onMouseDown={(event) => {
            event.preventDefault();
            startDrag(event.clientY);
          }}
          aria-label={`${label} ${displayValue}`}
          role="slider"
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
        >
          {/* Background track (full 270° arc) */}
          <path
            d={`M ${arcStart.x} ${arcStart.y} A ${R} ${R} 0 1 1 ${arcEnd.x} ${arcEnd.y}`}
            fill="none"
            stroke="var(--color-knob-track)"
            strokeWidth={trackWidth}
            strokeLinecap="round"
          />
          {/* Value track */}
          {clampedRatio > 0 && (
            <path
              d={`M ${arcStart.x} ${arcStart.y} A ${R} ${R} 0 ${largeArc} 1 ${arcVal.x} ${arcVal.y}`}
              fill="none"
              stroke="var(--color-knob-value)"
              strokeWidth={trackWidth}
              strokeLinecap="round"
            />
          )}
          {/* Knob cap */}
          <circle cx={cx} cy={cy} r={r} fill="var(--color-knob-cap)" />
          {/* Indicator dot */}
          <circle cx={dotX} cy={dotY} r={1.75} fill="var(--color-knob-value)" />
        </svg>
      </div>

      <span className="shrink-0 text-[11px] font-mono font-bold tabular-nums text-neutral-300 leading-none">
        {displayValue}
      </span>
    </div>
  );
}

export default function App() {
  const initialAudioSettings = loadAudioSettings();
  const micRestorePendingRef = useRef(initialAudioSettings.micActive);

  const [playlist, setPlaylist] = useState<Song[]>([]);
  const [history, setHistory] = useState<Song[]>(() => loadSongHistory());
  const [quickSongTab, setQuickSongTab] = useState<"frequent" | "history">("frequent");
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [mobileAdjustPanel, setMobileAdjustPanel] = useState<"pitch" | "speed" | "volume" | null>(null);
  const mobileAdjustButtonsRef = useRef<HTMLDivElement | null>(null);
  const mobileAdjustPanelRef = useRef<HTMLDivElement | null>(null);
  const [mobileSheetDragY, setMobileSheetDragY] = useState(0);
  const [isMobileSheetDragging, setIsMobileSheetDragging] = useState(false);
  const mobileSheetDragStartYRef = useRef(0);
  const isMobileSheetDraggingRef = useRef(false);
  const [songPlayStats, setSongPlayStats] = useState<Record<string, SongPlayStat>>(() => loadSongPlayStats());
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [backingStreamRetry, setBackingStreamRetry] = useState(0);
  const [customInput, setCustomInput] = useState<string>("");
  const playlistRef = useRef<Song[]>(playlist);
  const currentSongRef = useRef<Song | null>(currentSong);

  // YouTube Player states
  const [ytReady, setYtReady] = useState(false);
  const [playerState, setPlayerState] = useState<number>(-1); // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering
  const [ytVolume, setYtVolume] = useState<number>(initialAudioSettings.ytVolume);
  const [isMuted, setIsMuted] = useState(initialAudioSettings.isMuted);

  // Audio Processing and Microphone States
  const [micPreferred, setMicPreferred] = useState(initialAudioSettings.micActive);
  const [micActive, setMicActive] = useState(false);
  const [micGainValue, setMicGainValue] = useState<number>(initialAudioSettings.micGainValue);
  const [echoEnabled, setEchoEnabled] = useState<boolean>(initialAudioSettings.echoEnabled);
  const [echoDelayValue, setEchoDelayValue] = useState<number>(initialAudioSettings.echoDelayValue);
  const [echoFeedbackValue, setEchoFeedbackValue] = useState<number>(initialAudioSettings.echoFeedbackValue);
  const [reverbEnabled, setReverbEnabled] = useState<boolean>(initialAudioSettings.reverbEnabled);
  const [reverbWetValue, setReverbWetValue] = useState<number>(initialAudioSettings.reverbWetValue);
  const [reverbRoomSize, setReverbRoomSize] = useState<number>(initialAudioSettings.reverbRoomSize);
  const [panEnabled, setPanEnabled] = useState<boolean>(initialAudioSettings.panEnabled);
  const [voicePanValue, setVoicePanValue] = useState<number>(initialAudioSettings.voicePanValue);
  const [inEarMonitorEnabled, setInEarMonitorEnabled] = useState<boolean>(
    initialAudioSettings.inEarMonitorEnabled
  );
  const [micLatencyMs, setMicLatencyMs] = useState<number>(initialAudioSettings.micLatencyMs);
  const [isDetectingLatency, setIsDetectingLatency] = useState(false);

  // Recording and Pitch functionality
  const [isRecording, setIsRecording] = useState(false);
  const [recordingElapsedSec, setRecordingElapsedSec] = useState(0);
  const recordingStartedAtRef = useRef<number | null>(null);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const recordedAudioUrlRef = useRef<string | null>(null);
  const [ytPlaybackRate, setYtPlaybackRate] = useState<number>(initialAudioSettings.ytPlaybackRate);
  const [ytPitch, setYtPitch] = useState<number>(0);
  type BackingSource = "stream" | "youtube";
  const [backingSource, setBackingSource] = useState<BackingSource>("stream");
  const ytPlaybackRateRef = useRef<number>(initialAudioSettings.ytPlaybackRate);
  const ytPitchRef = useRef<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const backingRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const backingRecordedChunksRef = useRef<BlobPart[]>([]);
  const recordDestNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const backingRecordDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const micLatencyMsRef = useRef(0);
  const isFinalizingRecordingRef = useRef(false);
  const recordingHadBackingRef = useRef(false);
  const recordingDurationSecRef = useRef(0);
  const monitorGainRef = useRef<GainNode | null>(null);
  const dryMonitorSendRef = useRef<GainNode | null>(null);
  const wetMonitorSendRef = useRef<GainNode | null>(null);
  const reverbMonitorSendRef = useRef<GainNode | null>(null);

  const { toasts, dismiss, toast } = useToast();
  const { theme } = useTheme();

  useEffect(() => {
    micLatencyMsRef.current = micLatencyMs;
  }, [micLatencyMs]);

  useEffect(() => {
    ytPlaybackRateRef.current = ytPlaybackRate;
  }, [ytPlaybackRate]);

  useEffect(() => {
    ytPitchRef.current = ytPitch;
  }, [ytPitch]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    ytVolumeRef.current = ytVolume;
  }, [ytVolume]);

  useEffect(() => {
    playlistRef.current = playlist;
  }, [playlist]);

  useEffect(() => {
    currentSongRef.current = currentSong;
  }, [currentSong]);

  useEffect(() => {
    setBackingStreamRetry(0);
  }, [currentSong?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(SONG_HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, 10)));
  }, [history]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(SONG_PLAY_STATS_STORAGE_KEY, JSON.stringify(songPlayStats));
  }, [songPlayStats]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const handleDesktopEnter = (event: MediaQueryListEvent) => {
      if (event.matches) setIsMobileSidebarOpen(false);
    };
    if (mediaQuery.matches) {
      setIsMobileSidebarOpen(false);
    }
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleDesktopEnter);
      return () => mediaQuery.removeEventListener("change", handleDesktopEnter);
    }
    mediaQuery.addListener(handleDesktopEnter);
    return () => mediaQuery.removeListener(handleDesktopEnter);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!isMobileSidebarOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isMobileSidebarOpen]);

  useEffect(() => {
    if (!isMobileSidebarOpen) {
      isMobileSheetDraggingRef.current = false;
      setIsMobileSheetDragging(false);
      setMobileSheetDragY(0);
    }
  }, [isMobileSidebarOpen]);

  useEffect(() => {
    if (!mobileAdjustPanel) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const inPanel = mobileAdjustPanelRef.current?.contains(target);
      const inButtons = mobileAdjustButtonsRef.current?.contains(target);
      if (!inPanel && !inButtons) {
        setMobileAdjustPanel(null);
      }
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer);
  }, [mobileAdjustPanel]);

  const setRecordedPreviewUrl = (url: string | null) => {
    if (recordedAudioUrlRef.current) {
      URL.revokeObjectURL(recordedAudioUrlRef.current);
      recordedAudioUrlRef.current = null;
    }
    if (url) {
      recordedAudioUrlRef.current = url;
    }
    setRecordedAudioUrl(url);
  };

  const frequentSongs = useMemo(
    () =>
      Object.values(songPlayStats)
        .sort((a, b) => b.count - a.count || b.lastPlayedAt - a.lastPlayedAt)
        .slice(0, 4),
    [songPlayStats]
  );

  useEffect(() => {
    return () => {
      if (recordedAudioUrlRef.current) {
        URL.revokeObjectURL(recordedAudioUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isRecording) {
      recordingStartedAtRef.current = null;
      return;
    }

    recordingStartedAtRef.current = performance.now();
    setRecordingElapsedSec(0);

    const tick = () => {
      if (recordingStartedAtRef.current == null) return;
      setRecordingElapsedSec(
        Math.floor((performance.now() - recordingStartedAtRef.current) / 1000)
      );
    };

    tick();
    const intervalId = window.setInterval(tick, 250);
    return () => clearInterval(intervalId);
  }, [isRecording]);

  useEffect(() => {
    saveAudioSettings({
      ytVolume,
      isMuted,
      ytPlaybackRate,
      ytPitch,
      micGainValue,
      echoEnabled,
      echoDelayValue,
      echoFeedbackValue,
      reverbEnabled,
      reverbWetValue,
      reverbRoomSize,
      panEnabled,
      voicePanValue,
      micLatencyMs,
      inEarMonitorEnabled,
      micActive: micPreferred,
    });
  }, [
    ytVolume,
    isMuted,
    ytPlaybackRate,
    ytPitch,
    micGainValue,
    echoEnabled,
    echoDelayValue,
    echoFeedbackValue,
    reverbEnabled,
    reverbWetValue,
    reverbRoomSize,
    panEnabled,
    voicePanValue,
    micLatencyMs,
    inEarMonitorEnabled,
    micPreferred,
  ]);

  // REFS
  const playerRef = useRef<any>(null); // YT.Player instance
  const backingAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const backingSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const stretchNodeRef = useRef<SignalsmithStretchNode | null>(null);
  const backingGainNodeRef = useRef<GainNode | null>(null);
  const backingMonitorGainRef = useRef<GainNode | null>(null);
  const syncingIntervalRef = useRef<number | null>(null);
  const prepareBackingPromiseRef = useRef<Promise<void> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micGainRef = useRef<GainNode | null>(null);
  const delayNodeRef = useRef<DelayNode | null>(null);
  const feedbackGainRef = useRef<GainNode | null>(null);
  const echoWetGainRef = useRef<GainNode | null>(null);
  const convolverNodeRef = useRef<ConvolverNode | null>(null);
  const reverbSendGainRef = useRef<GainNode | null>(null);
  const reverbMakeupGainRef = useRef<GainNode | null>(null);
  const reverbWetGainRef = useRef<GainNode | null>(null);
  const pannerNodeRef = useRef<StereoPannerNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playerStateCheckInterval = useRef<any>(null);
  const pendingVideoLoadRef = useRef<string | null>(null);
  const backingGraphSongIdRef = useRef<string | null>(null);
  const backingGraphSetupIdRef = useRef(0);
  const beginSyncedPlaybackRef = useRef<(player: any, ytTime?: number) => Promise<void>>(
    async () => {}
  );
  const playNextRef = useRef<() => void>(() => {});
  const isMutedRef = useRef(isMuted);
  const ytVolumeRef = useRef(ytVolume);
  const backingSourceRef = useRef<BackingSource>("stream");

  const applyYoutubePlayerVolume = (player: any = playerRef.current) => {
    if (!player || backingSourceRef.current !== "youtube") return;
    try {
      if (isMutedRef.current || ytVolumeRef.current === 0) {
        player.mute();
      } else {
        player.unMute();
        player.setVolume(ytVolumeRef.current);
      }
    } catch {
      // ignore player API errors during init
    }
  };

  const switchToYoutubeBacking = (reason?: string) => {
    if (backingSourceRef.current === "youtube") return;
    backingSourceRef.current = "youtube";
    setBackingSource("youtube");
    backingAudioElementRef.current = null;
    teardownBackingAudioGraph();
    toast.info(
      reason ??
        "雲端環境改用 YouTube 原聲伴奏（音高調整暫不可用）",
      5000
    );
    applyYoutubePlayerVolume();
    const player = playerRef.current;
    if (player && playerState === 1) {
      void player.playVideo?.();
    }
  };

  const ensureYoutubeSilent = (player: any = playerRef.current) => {
    if (!player) return;
    if (backingSourceRef.current === "youtube") {
      applyYoutubePlayerVolume(player);
      return;
    }
    try {
      player.mute();
      player.setVolume(0);
    } catch {
      // ignore player API errors during init
    }
  };

  // Load YouTube IFrame API script once
  useEffect(() => {
    if (window.YT?.Player) return;
    if (document.querySelector('script[src*="youtube.com/iframe_api"]')) return;

    const tag = document.createElement("script");
    tag.src = `https://www.youtube.com/iframe_api?origin=${encodeURIComponent(window.location.origin)}`;
    const firstScriptTag = document.getElementsByTagName("script")[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
  }, []);

  useEffect(() => {
    if (window.location.hostname.includes("onrender.com")) {
      switchToYoutubeBacking();
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);

    void fetch("/api/health?extract=1", { signal: controller.signal })
      .then((res) => res.json())
      .then((data: { canExtract?: boolean }) => {
        if (cancelled || data.canExtract !== false) return;
        switchToYoutubeBacking();
      })
      .catch(() => {
        if (cancelled) return;
        switchToYoutubeBacking("無法連線伴奏伺服器，改用 YouTube 原聲伴奏");
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
      });

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    applyYoutubePlayerVolume();
  }, [ytVolume, isMuted, backingSource, ytReady]);

  useEffect(() => {
    const links: HTMLLinkElement[] = [];
    const origins = [
      "https://www.youtube.com",
      "https://i.ytimg.com",
      "https://rr1---sn.googlevideo.com",
    ];
    origins.forEach((origin) => {
      const selector = `link[rel="preconnect"][href="${origin}"]`;
      if (document.head.querySelector(selector)) return;
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = origin;
      link.crossOrigin = "";
      document.head.appendChild(link);
      links.push(link);
    });
    return () => {
      links.forEach((link) => link.remove());
    };
  }, []);

  const destroyYoutubePlayer = () => {
    if (syncingIntervalRef.current) {
      clearInterval(syncingIntervalRef.current);
      syncingIntervalRef.current = null;
    }
    if (playerRef.current) {
      try {
        playerRef.current.destroy();
      } catch {
        // ignore destroy errors
      }
      playerRef.current = null;
    }
    pendingVideoLoadRef.current = null;
    setYtReady(false);
    setPlayerState(-1);
  };

  // Mount YouTube player once and keep iframe alive for faster startup/switching
  useEffect(() => {
    const initPlayer = () => {
      const container = document.getElementById("yt-player-container");
      if (!container || playerRef.current) return;

      try {
        playerRef.current = new window.YT.Player("yt-player-container", {
          height: "100%",
          width: "100%",
          playerVars: {
            enablejsapi: 1,
            origin: window.location.origin,
            autoplay: 0,
            controls: 1,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            mute: 1,
          },
          events: {
            onReady: () => {
              setYtReady(true);
            },
            onStateChange: (event: any) => {
              const state = event.data;
              setPlayerState(state);

              if (state === 1) {
                if (backingSourceRef.current === "youtube") {
                  applyYoutubePlayerVolume(event.target);
                } else {
                  ensureYoutubeSilent(event.target);
                }
              }

              const backing =
                backingSourceRef.current === "stream"
                  ? backingAudioElementRef.current
                  : null;
              const pendingVideoId = pendingVideoLoadRef.current;

              if (pendingVideoId && (state === 5 || state === 3 || state === 1)) {
                const loadedId = event.target.getVideoData?.()?.video_id;
                if (loadedId === pendingVideoId) {
                  pendingVideoLoadRef.current = null;
                  void beginSyncedPlaybackRef.current(event.target, 0);
                  return;
                }
              }

              if (state === 1) {
                if (backing) {
                  if (backing.paused) {
                    void beginSyncedPlaybackRef.current(event.target, event.target.getCurrentTime());
                  } else {
                    startBackingSyncInterval(event.target, backing);
                    const curYtTime = event.target.getCurrentTime();
                    if (Math.abs(backing.currentTime - curYtTime) > 0.3) {
                      backing.currentTime = curYtTime;
                    }
                  }
                }
              } else if (state === 2) {
                if (backing) backing.pause();
                if (syncingIntervalRef.current) clearInterval(syncingIntervalRef.current);
              } else if (state === 0) {
                const endedVideoId = event.target.getVideoData?.()?.video_id;
                if (endedVideoId !== currentSongRef.current?.id) {
                  return;
                }
                if (backing) backing.pause();
                if (syncingIntervalRef.current) clearInterval(syncingIntervalRef.current);
                playNextRef.current();
              }
            },
            onError: (event: any) => {
              console.error("YT Error", event);
              pendingVideoLoadRef.current = null;
              const errorMessages: Record<number, string> = {
                2: "無效的 YouTube 連結",
                5: "HTML5 播放器錯誤",
                100: "找不到影片或影片已刪除",
                101: "此影片不允許嵌入播放",
                150: "此影片不允許嵌入播放",
              };
              toast.error(errorMessages[event.data] ?? `YouTube 播放失敗（錯誤 ${event.data}）`, 6000);
            },
          },
        });
      } catch (err) {
        console.error("YouTube Player Initialization Error:", err);
      }
    };

    let cancelled = false;
    const tryInit = () => {
      if (cancelled) return;
      if (window.YT?.Player) {
        requestAnimationFrame(initPlayer);
        return;
      }
      const previousReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previousReady?.();
        tryInit();
      };
    };

    tryInit();
    return () => {
      cancelled = true;
    };
  }, []);

  // Switch tracks by loading into existing player (no iframe teardown)
  useEffect(() => {
    const player = playerRef.current;

    if (!currentSong?.id) {
      pendingVideoLoadRef.current = null;
      if (syncingIntervalRef.current) {
        clearInterval(syncingIntervalRef.current);
        syncingIntervalRef.current = null;
      }
      const backing = backingAudioElementRef.current;
      if (backing) backing.pause();
      if (player) {
        try {
          player.stopVideo();
        } catch {
          // ignore player API errors
        }
      }
      setPlayerState(-1);
      return;
    }

    if (!player || !ytReady) return;

    const videoId = currentSong.id;
    const loadedId = player.getVideoData?.()?.video_id;
    if (loadedId === videoId && !pendingVideoLoadRef.current) {
      // Re-selecting a song whose iframe is still loaded (e.g. after stop/end) must
      // restart playback — loadVideoById is a no-op in that case.
      const state = typeof player.getPlayerState === "function" ? player.getPlayerState() : -1;
      if (state !== 1) {
        requestAnimationFrame(() => {
          if (currentSongRef.current?.id !== videoId || !playerRef.current) return;
          void beginSyncedPlaybackRef.current(playerRef.current, 0);
        });
      }
      return;
    }

    pendingVideoLoadRef.current = videoId;
    player.loadVideoById({ videoId, startSeconds: 0 });

    const fallbackTimer = window.setTimeout(() => {
      if (pendingVideoLoadRef.current !== videoId || !playerRef.current) return;
      pendingVideoLoadRef.current = null;
      void beginSyncedPlaybackRef.current(playerRef.current, 0);
    }, 2000);

    return () => {
      window.clearTimeout(fallbackTimer);
    };
  }, [currentSong?.id, ytReady]);

  useEffect(() => {
    return () => {
      destroyYoutubePlayer();
    };
  }, []);

  const applyBackingPitchAndRate = () => {
    const backing = backingAudioElementRef.current;
    const stretchNode = stretchNodeRef.current;
    if (backing) {
      backing.preservesPitch = false;
      backing.playbackRate = ytPlaybackRateRef.current;
    }
    if (stretchNode) {
      applyStretchPitchAndRate(stretchNode, ytPitchRef.current, ytPlaybackRateRef.current);
    }
  };

  const disconnectBackingDownstream = () => {
    try {
      stretchNodeRef.current?.stop();
      stretchNodeRef.current?.disconnect();
      backingGainNodeRef.current?.disconnect();
      backingMonitorGainRef.current?.disconnect();
    } catch {
      // ignore disconnect errors during cleanup
    }
    stretchNodeRef.current = null;
    backingGainNodeRef.current = null;
    backingMonitorGainRef.current = null;
  };

  const teardownBackingAudioGraph = () => {
    backingGraphSetupIdRef.current += 1;
    disconnectBackingDownstream();
    backingSourceNodeRef.current = null;
    backingGraphSongIdRef.current = null;
    prepareBackingPromiseRef.current = null;
  };

  const waitForBackingAudioReady = (backing: HTMLAudioElement) => {
    if (backing.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      return Promise.resolve();
    }
    if (backing.networkState === HTMLMediaElement.NETWORK_EMPTY) {
      backing.load();
    }
    return new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("backing audio failed to load"));
      };
      const cleanup = () => {
        backing.removeEventListener("canplay", onReady);
        backing.removeEventListener("error", onError);
      };
      backing.addEventListener("canplay", onReady);
      backing.addEventListener("error", onError);
    });
  };

  const prepareBackingPlayback = async (): Promise<void> => {
    const backing = backingAudioElementRef.current;
    const songId = currentSongRef.current?.id;
    if (!backing || !songId) return;

    if (prepareBackingPromiseRef.current) {
      return prepareBackingPromiseRef.current;
    }

    const task = (async () => {
      await initAudioContextAction();
      if (backingGraphSongIdRef.current !== songId || !backingSourceNodeRef.current) {
        teardownBackingAudioGraph();
        await setupBackingAudioGraph(songId);
      }
      await waitForBackingAudioReady(backing);
      applyBackingPitchAndRate();
    })();

    prepareBackingPromiseRef.current = task;
    try {
      await task;
    } finally {
      if (prepareBackingPromiseRef.current === task) {
        prepareBackingPromiseRef.current = null;
      }
    }
  };

  const startBackingSyncInterval = (player: any, backing: HTMLAudioElement) => {
    if (syncingIntervalRef.current) clearInterval(syncingIntervalRef.current);
    syncingIntervalRef.current = window.setInterval(() => {
      if (player?.getCurrentTime && backing && !backing.paused) {
        const curYtTime = player.getCurrentTime();
        if (Math.abs(backing.currentTime - curYtTime) > 0.5) {
          backing.currentTime = curYtTime;
        }
      }
    }, 1000);
  };

  const beginSyncedPlayback = async (player: any, ytTime = 0) => {
    if (!player) return;

    try {
      const currentYt = typeof player.getCurrentTime === "function" ? player.getCurrentTime() : 0;
      const targetTime = typeof ytTime === "number" ? ytTime : currentYt;

      if (Math.abs(currentYt - targetTime) > 0.05) {
        player.seekTo(targetTime, true);
      }

      if (player.getPlayerState() !== 1) {
        player.playVideo();
      }

      if (backingSourceRef.current === "youtube") {
        if (syncingIntervalRef.current) clearInterval(syncingIntervalRef.current);
        applyYoutubePlayerVolume(player);
        return;
      }

      ensureYoutubeSilent(player);

      const backing = backingAudioElementRef.current;
      if (!backing) {
        requestAnimationFrame(() => {
          const retryBacking = backingAudioElementRef.current;
          const retryPlayer = playerRef.current;
          if (!retryBacking || !retryPlayer || retryPlayer !== player) return;
          void beginSyncedPlaybackRef.current(retryPlayer, targetTime);
        });
        return;
      }

      await prepareBackingPlayback();
      applyBackingPitchAndRate();

      if (Math.abs(backing.currentTime - targetTime) > 0.05) {
        backing.currentTime = targetTime;
      }
      if (backing.paused) {
        await backing.play();
      }

      startBackingSyncInterval(player, backing);
    } catch (err) {
      console.error("Synced playback error:", err);
      if (backingSourceRef.current === "stream") {
        switchToYoutubeBacking("伴奏串流失敗，改用 YouTube 原聲伴奏");
        await beginSyncedPlayback(player, ytTime);
        return;
      }
      toast.error("伴奏音訊無法播放，請稍後再試", 6000);
    }
  };

  const syncBackingPlayback = async (ytTime?: number) => {
    const player = playerRef.current;
    if (!player) return;
    await beginSyncedPlayback(player, typeof ytTime === "number" ? ytTime : player.getCurrentTime());
  };

  const setupBackingAudioGraph = async (songId: string) => {
    const audioEl = backingAudioElementRef.current;
    if (!audioEl) return;
    if (
      backingSourceNodeRef.current &&
      backingGraphSongIdRef.current === songId &&
      stretchNodeRef.current
    ) {
      return;
    }

    const setupId = backingGraphSetupIdRef.current + 1;
    backingGraphSetupIdRef.current = setupId;
    disconnectBackingDownstream();

    const audioCtx = await initAudioContextAction();
    if (setupId !== backingGraphSetupIdRef.current || backingAudioElementRef.current !== audioEl) {
      return;
    }

    audioEl.preservesPitch = false;
    audioEl.playbackRate = ytPlaybackRateRef.current;

    const source = getOrCreateBackingSource(audioEl, audioCtx);
    if (!source) return;
    backingSourceNodeRef.current = source;

    const stretchNode = await createSignalsmithStretchNode(audioCtx);
    if (setupId !== backingGraphSetupIdRef.current || backingAudioElementRef.current !== audioEl) {
      try {
        stretchNode.stop();
        stretchNode.disconnect();
      } catch {
        // ignore cleanup errors for aborted setup
      }
      return;
    }

    stretchNodeRef.current = stretchNode;
    applyStretchPitchAndRate(stretchNode, ytPitchRef.current, ytPlaybackRateRef.current);
    stretchNode.start();

    backingGainNodeRef.current = audioCtx.createGain();
    backingGainNodeRef.current.gain.value = isMutedRef.current ? 0 : ytVolumeRef.current / 100;
    backingMonitorGainRef.current = audioCtx.createGain();
    backingMonitorGainRef.current.gain.value = 1;

    source.connect(stretchNode);
    stretchNode.connect(backingGainNodeRef.current);
    backingGainNodeRef.current.connect(backingMonitorGainRef.current);
    backingMonitorGainRef.current.connect(audioCtx.destination);
    backingGraphSongIdRef.current = songId;
  };

  // Warm server cache + browser buffer for upcoming queue items
  useEffect(() => {
    if (backingSource !== "stream") return;
    playlist.slice(0, 3).forEach((song) => prefetchSongStream(song.id));
  }, [playlist, backingSource]);

  // Preload backing audio and build the pitch-shift graph as soon as a song is selected
  useEffect(() => {
    if (backingSource !== "stream") return;
    if (!currentSong) {
      teardownBackingAudioGraph();
      return;
    }

    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled || !backingAudioElementRef.current) return;
      try {
        await prepareBackingPlayback();
      } catch (err) {
        console.error("Backing preload failed:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentSong?.id, backingSource]);

  useEffect(() => {
    if (stretchNodeRef.current) {
      applyStretchPitchAndRate(stretchNodeRef.current, ytPitch, ytPlaybackRate);
    }
  }, [ytPitch, ytPlaybackRate]);

  // Watch audio node updates
  useEffect(() => {
    if (micGainRef.current) {
      micGainRef.current.gain.value = micGainValue;
    }
  }, [micGainValue]);

  useEffect(() => {
    if (delayNodeRef.current) {
      delayNodeRef.current.delayTime.value = echoDelayValue;
    }
  }, [echoDelayValue]);

  useEffect(() => {
    if (feedbackGainRef.current) {
      feedbackGainRef.current.gain.value = echoFeedbackValue;
    }
  }, [echoFeedbackValue]);

  useEffect(() => {
    if (echoWetGainRef.current) {
      echoWetGainRef.current.gain.value = echoEnabled ? 1 : 0;
    }
    if (wetMonitorSendRef.current && inEarMonitorEnabled) {
      wetMonitorSendRef.current.gain.value = echoEnabled ? 1 : 0;
    }
  }, [echoEnabled, inEarMonitorEnabled]);

  useEffect(() => {
    if (reverbWetGainRef.current) {
      reverbWetGainRef.current.gain.value = reverbEnabled ? reverbWetValue : 0;
    }
    if (reverbMonitorSendRef.current) {
      reverbMonitorSendRef.current.gain.value = inEarMonitorEnabled && reverbEnabled ? 1 : 0;
    }
  }, [reverbEnabled, reverbWetValue, inEarMonitorEnabled]);

  useEffect(() => {
    const convolver = convolverNodeRef.current;
    const audioCtx = audioCtxRef.current;
    if (!convolver || !audioCtx) return;

    convolver.buffer = createReverbImpulseResponse(audioCtx, reverbRoomSize, reverbRoomSize);
  }, [reverbRoomSize, micActive]);

  useEffect(() => {
    applyInEarMonitorState(inEarMonitorEnabled);
  }, [inEarMonitorEnabled]);

  useEffect(() => {
    if (pannerNodeRef.current && pannerNodeRef.current.pan) {
      pannerNodeRef.current.pan.value = panEnabled ? voicePanValue : 0;
    }
  }, [voicePanValue, panEnabled]);

  // Canvas visualizer loop
  useEffect(() => {
    if (micActive && analyserNodeRef.current) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const analyser = analyserNodeRef.current;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      const smoothedHeights = new Float32Array(bufferLength);
      const BAR_ATTACK = 0.42;
      const BAR_DECAY = 0.14;

      const draw = () => {
        if (!micActive) return;
        animationFrameRef.current = requestAnimationFrame(draw);

        analyser.getByteFrequencyData(dataArray);

        const width = canvas.width;
        const height = canvas.height;
        const spectrum = getSpectrumColors();

        ctx.fillStyle = spectrum.background;
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = spectrum.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < width; i += 20) {
          ctx.moveTo(i, 0);
          ctx.lineTo(i, height);
        }
        for (let i = 0; i < height; i += 15) {
          ctx.moveTo(0, i);
          ctx.lineTo(width, i);
        }
        ctx.stroke();

        const slotWidth = width / bufferLength;
        const barDrawWidth = Math.max(3, slotWidth * 0.82);
        const barGap = (slotWidth - barDrawWidth) / 2;

        for (let i = 0; i < bufferLength; i++) {
          const targetHeight = (dataArray[i] / 255) * height * 0.92;
          const prevHeight = smoothedHeights[i];
          const smoothFactor = targetHeight > prevHeight ? BAR_ATTACK : BAR_DECAY;
          smoothedHeights[i] = prevHeight + (targetHeight - prevHeight) * smoothFactor;
          const barHeight = Math.max(2, smoothedHeights[i]);

          ctx.fillStyle = spectrum.bar;
          const x = i * slotWidth + barGap;
          const barRadius = Math.min(1.5, barDrawWidth / 2);
          drawRoundedRect(ctx, x, height - barHeight, barDrawWidth, barHeight, barRadius);
        }
      };

      draw();
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = getSpectrumColors().background;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [micActive, theme]);

  // Helper helper to draw rounded bars
  const drawRoundedRect = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) => {
    if (height < 2) return;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height);
    ctx.lineTo(x, y + height);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
  };

  // Extract YouTube ID from link or fallback to raw ID
  const extractVideoID = (url: string) => {
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    const match = url.match(regExp);
    const extracted = (match && match[7].length === 11) ? match[7] : url.trim();
    return extracted.length === 11 ? extracted : null;
  };

  const isPlaceholderSongTitle = (title: string, videoId: string) => {
    const trimmed = title.trim();
    return !trimmed || trimmed === `YouTube (${videoId})` || /^YouTube \(.+\)$/.test(trimmed);
  };

  const looksLikeCorruptedTitle = (title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return false;
    return (
      trimmed.includes("\uFFFD") ||
      /[ÃÂ][\u0080-\u00ff]/.test(trimmed) ||
      /[\u0080-\u009f]/.test(trimmed)
    );
  };

  const isSongTitleReady = (song: Song) => {
    const title = song.title.trim();
    if (!title) return false;
    if (isPlaceholderSongTitle(title, song.id)) return false;
    if (looksLikeCorruptedTitle(title)) return false;
    return true;
  };

  const titleResolveInFlightRef = useRef<Set<string>>(new Set());

  const prefetchSongStream = (videoId: string) => {
    void fetch(`/api/prefetch?v=${encodeURIComponent(videoId)}`).catch(() => {
      // prefetch is best-effort
    });
  };

  const resolveSongMetadata = async (
    videoId: string,
    titleStr: string,
    artistName: string
  ): Promise<{ title: string; artist: string }> => {
    const trimmedTitle = titleStr.trim();
    const trimmedArtist = artistName.trim();

    try {
      const res = await fetch(`/api/video-info?v=${encodeURIComponent(videoId)}`);
      if (res.ok) {
        const data = (await res.json()) as { title?: string; artist?: string };
        return {
          title: data.title?.trim() || trimmedTitle || `YouTube (${videoId})`,
          artist: data.artist?.trim() || trimmedArtist || "未知",
        };
      }
    } catch (error) {
      console.error("Failed to fetch YouTube metadata:", error);
    }

    if (
      trimmedTitle &&
      trimmedArtist &&
      trimmedArtist !== "未知" &&
      !isPlaceholderSongTitle(trimmedTitle, videoId) &&
      !looksLikeCorruptedTitle(trimmedTitle)
    ) {
      return { title: trimmedTitle, artist: trimmedArtist };
    }

    return {
      title: trimmedTitle || `YouTube (${videoId})`,
      artist: trimmedArtist || "未知",
    };
  };

  const applySongMetadataPatch = (videoId: string, resolved: { title: string; artist: string }) => {
    const patch = (song: Song): Song =>
      song.id === videoId ? { ...song, title: resolved.title, artist: resolved.artist } : song;

    const nextPlaylist = playlistRef.current.map(patch);
    playlistRef.current = nextPlaylist;
    setPlaylist(nextPlaylist);
    setCurrentSong((prev) => (prev?.id === videoId ? patch(prev) : prev));
    setHistory((prev) => prev.map(patch));
    setSongPlayStats((prev) => {
      const existing = prev[videoId];
      if (!existing) return prev;
      return { ...prev, [videoId]: { ...existing, song: patch(existing.song) } };
    });
  };

  const refreshSongMetadata = (videoId: string, titleStr: string, artistName: string) => {
    if (titleResolveInFlightRef.current.has(videoId)) return;
    titleResolveInFlightRef.current.add(videoId);
    void resolveSongMetadata(videoId, titleStr, artistName)
      .then((resolved) => {
        applySongMetadataPatch(videoId, resolved);
      })
      .finally(() => {
        titleResolveInFlightRef.current.delete(videoId);
      });
  };

  const ensureSongTitleResolved = (song: Song) => {
    if (isSongTitleReady(song)) return;
    refreshSongMetadata(song.id, song.title, song.artist);
  };

  const renderQuickSongTitle = (song: Song) => {
    if (!isSongTitleReady(song)) {
      return (
        <span className="truncate text-neutral-500 inline-flex items-center gap-1 min-w-0">
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          <span className="truncate">載入中…</span>
        </span>
      );
    }
    return <span className="truncate">{song.title.split("(")[0].trim()}</span>;
  };

  const renderSongTitle = (song: Song) => {
    if (!isSongTitleReady(song)) {
      return (
        <span className="inline-flex items-center gap-1 min-w-0 text-neutral-500 truncate">
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          <span className="truncate">載入中…</span>
        </span>
      );
    }
    return song.title;
  };

  const commitPlaylist = (next: Song[]) => {
    playlistRef.current = next;
    setPlaylist(next);
  };

  // Add a music track manually to the waitlist queue
  const handleAddSong = (songId: string, titleStr: string, artistName: string, isPriority = false) => {
    const vidId = extractVideoID(songId);
    if (!vidId) {
      toast.error("請輸入有效的 YouTube 連結或影片 ID");
      return;
    }

    const newSong: Song = {
      id: vidId,
      title: titleStr.trim() || `YouTube (${vidId})`,
      artist: artistName.trim() || "未知",
      category: "自訂",
    };

    const deduped = playlistRef.current.filter((song) => song.id !== newSong.id);
    const next = isPriority ? [newSong, ...deduped] : [...deduped, newSong];
    commitPlaylist(next);

    setCustomInput("");
    prefetchSongStream(vidId);
    refreshSongMetadata(vidId, titleStr, artistName);

    // If there is nothing playing currently, start right away (keep user-gesture chain)
    if (!currentSongRef.current) {
      void playSongInstance(newSong);
    }
  };

  useEffect(() => {
    const seen = new Set<string>();
    const candidates = [
      ...frequentSongs.map((entry) => entry.song),
      ...history,
      ...playlist,
      ...(currentSong ? [currentSong] : []),
    ];
    candidates.forEach((song) => {
      if (seen.has(song.id)) return;
      seen.add(song.id);
      ensureSongTitleResolved(song);
    });
  }, [frequentSongs, history, playlist, currentSong]);

  const preservePlaybackAfterQueueChange = () => {
    if (!currentSong || playerState !== 1) return;

    requestAnimationFrame(() => {
      const player = playerRef.current;
      if (!player || !ytReady) return;

      try {
        const ytState = player.getPlayerState();
        if (ytState === 2) {
          void beginSyncedPlayback(player, player.getCurrentTime());
        } else if (player.getPlayerState() === 1) {
          void syncBackingPlayback(player.getCurrentTime());
        }
      } catch {
        // ignore player API errors during queue edits
      }
    });
  };

  // Remove a song from the pending queue list
  const handleRemoveSong = (index: number) => {
    commitPlaylist(playlistRef.current.filter((_, i) => i !== index));
    preservePlaybackAfterQueueChange();
  };

  // Shift priority and insert current
  const handleMoveToTop = (index: number) => {
    const list = [...playlistRef.current];
    const target = list.splice(index, 1)[0];
    commitPlaylist([target, ...list]);
  };

  // Play a song right now
  const playSongInstance = async (song: Song) => {
    void initAudioContextAction().catch((e) => {
      console.error("AudioContext init error:", e);
    });

    const songToPlay: Song = { ...song };
    prefetchSongStream(songToPlay.id);

    setSongPlayStats((prev) => {
      const existing = prev[songToPlay.id];
      return {
        ...prev,
        [songToPlay.id]: {
          song: songToPlay,
          count: (existing?.count ?? 0) + 1,
          lastPlayedAt: Date.now(),
        },
      };
    });

    // 一開始播放就寫入紀錄，並將同曲目移到最前面避免重複
    setHistory((prev) => [songToPlay, ...prev.filter((h) => h.id !== songToPlay.id)].slice(0, 10));

    // Remove from playlist wait list if it was in there
    commitPlaylist(playlistRef.current.filter((s) => s.id !== songToPlay.id));

    const previousId = currentSongRef.current?.id;
    if (previousId !== songToPlay.id) {
      ytPitchRef.current = 0;
      setYtPitch(0);
    }
    currentSongRef.current = songToPlay;
    setCurrentSong(songToPlay);

    // Same video ID: effect won't re-run — reload on existing player
    if (previousId === songToPlay.id && playerRef.current && ytReady) {
      pendingVideoLoadRef.current = songToPlay.id;
      playerRef.current.loadVideoById({ videoId: songToPlay.id, startSeconds: 0 });
    }

    if (
      isPlaceholderSongTitle(songToPlay.title, songToPlay.id) ||
      !songToPlay.artist.trim() ||
      looksLikeCorruptedTitle(songToPlay.title)
    ) {
      refreshSongMetadata(songToPlay.id, songToPlay.title, songToPlay.artist);
    }
  };

  // Skip / Cut song (播下一首)
  const playNext = () => {
    const currentQueue = playlistRef.current;
    if (currentQueue.length > 0) {
      const nextSong = currentQueue[0];
      void playSongInstance(nextSong);
    } else {
      currentSongRef.current = null;
      setCurrentSong(null);
    }
  };

  beginSyncedPlaybackRef.current = beginSyncedPlayback;
  playNextRef.current = playNext;

  // Restart current song
  const restartCurrentTrack = () => {
    if (playerRef.current && ytReady) {
      void beginSyncedPlayback(playerRef.current, 0);
    }
  };

  // Control Player volume
  const handleVolumeChange = (value: number) => {
    setYtVolume(value);
    if (backingGainNodeRef.current) {
        backingGainNodeRef.current.gain.value = value / 100;
    }
  };

  // Toggle Mute — only controls backing track; YouTube stays silent
  const toggleMute = () => {
    if (backingSourceRef.current === "youtube" && playerRef.current) {
      const nextMuted = !isMuted;
      setIsMuted(nextMuted);
      try {
        if (nextMuted) {
          playerRef.current.mute();
        } else {
          playerRef.current.unMute();
          playerRef.current.setVolume(ytVolume);
        }
      } catch {
        // ignore player API errors
      }
      return;
    }
    if (backingGainNodeRef.current) {
      if (isMuted) {
        backingGainNodeRef.current.gain.value = ytVolume / 100;
        setIsMuted(false);
      } else {
        backingGainNodeRef.current.gain.value = 0;
        setIsMuted(true);
      }
    } else {
      setIsMuted(!isMuted);
    }
  };

  // Toggle play/pause state
  const togglePlayPause = () => {
    if (playerRef.current && ytReady) {
      if (playerState === 1) {
        playerRef.current.pauseVideo();
      } else {
        if (backingSourceRef.current === "stream") {
          ensureYoutubeSilent();
        }
        playerRef.current.playVideo();
        if (backingSourceRef.current === "youtube") {
          applyYoutubePlayerVolume();
        } else {
          ensureYoutubeSilent();
        }
      }
    }
  };

  const applyInEarMonitorState = (enabled: boolean) => {
    const ctx = audioCtxRef.current;
    const monitorGain = monitorGainRef.current;
    if (!ctx || !monitorGain) return;

    const now = ctx.currentTime;
    dryMonitorSendRef.current?.gain.setValueAtTime(enabled ? 1 : 0, now);
    wetMonitorSendRef.current?.gain.setValueAtTime(
      enabled && echoEnabled ? 1 : 0,
      now
    );
    reverbMonitorSendRef.current?.gain.setValueAtTime(
      enabled && reverbEnabled ? 1 : 0,
      now
    );
    monitorGain.gain.setValueAtTime(enabled ? 1 : 0, now);

    try {
      monitorGain.disconnect(ctx.destination);
    } catch {
      // not connected yet
    }

    if (enabled) {
      monitorGain.connect(ctx.destination);
    }
  };

  const toggleInEarMonitor = (nextEnabled?: boolean) => {
    const next = nextEnabled ?? !inEarMonitorEnabled;
    setInEarMonitorEnabled(next);
    applyInEarMonitorState(next);
  };

  // Initialize Audio Context safely on user gesture
  const initAudioContextAction = async () => {
    if (!audioCtxRef.current) {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      try {
        audioCtxRef.current = new AudioContextCtor({
          sampleRate: PREFERRED_AUDIO_SAMPLE_RATE,
        });
      } catch {
        audioCtxRef.current = new AudioContextCtor();
      }
    }
    const audioCtx = audioCtxRef.current;
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }
    return audioCtx;
  };

  const activateMicStream = async (options?: { silent?: boolean }) => {
    if (micActive) return;

    try {
        const audioCtx = await initAudioContextAction();

        // Get live microphone stream with processing bypass for raw professional feedback
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: audioCtx.sampleRate,
            echoCancellation: false,   // Prevents modern browser from fighting our artificial echo
            noiseSuppression: false,   // Gives a warm live microphone feel
            autoGainControl: false     // Keeps singer's dynamics natural
          },
          video: false
        });

        micStreamRef.current = stream;

        // Build Audio Effects Graph
        const sourceNode = audioCtx.createMediaStreamSource(stream);
        sourceNodeRef.current = sourceNode;

        const micGain = audioCtx.createGain();
        micGain.gain.value = micGainValue;
        micGainRef.current = micGain;

        const delayNode = audioCtx.createDelay(1.2);
        delayNode.delayTime.value = echoDelayValue;
        delayNodeRef.current = delayNode;

        const feedbackGain = audioCtx.createGain();
        feedbackGain.gain.value = echoFeedbackValue;
        feedbackGainRef.current = feedbackGain;

        const echoWetGain = audioCtx.createGain();
        echoWetGain.gain.value = echoEnabled ? 1 : 0;
        echoWetGainRef.current = echoWetGain;

        const convolverNode = audioCtx.createConvolver();
        convolverNode.normalize = false;
        convolverNode.buffer = createReverbImpulseResponse(audioCtx, reverbRoomSize, reverbRoomSize);
        convolverNodeRef.current = convolverNode;

        const reverbSendGain = audioCtx.createGain();
        reverbSendGain.gain.value = 0.5;
        reverbSendGainRef.current = reverbSendGain;

        const reverbMakeupGain = audioCtx.createGain();
        reverbMakeupGain.gain.value = 0.85;
        reverbMakeupGainRef.current = reverbMakeupGain;

        const reverbWetGain = audioCtx.createGain();
        reverbWetGain.gain.value = reverbEnabled ? reverbWetValue : 0;
        reverbWetGainRef.current = reverbWetGain;

        const analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 32;
        analyserNode.smoothingTimeConstant = 0.88;
        analyserNodeRef.current = analyserNode;

        // Create Stereo Panner for positioning user vocals
        let pannerNode: StereoPannerNode | null = null;
        if (audioCtx.createStereoPanner) {
          pannerNode = audioCtx.createStereoPanner();
          pannerNode.pan.value = panEnabled ? voicePanValue : 0;
          pannerNodeRef.current = pannerNode;
        }

        const monitorGain = audioCtx.createGain();
        monitorGain.gain.value = 0;
        monitorGainRef.current = monitorGain;

        const dryMonitorSend = audioCtx.createGain();
        dryMonitorSend.gain.value = inEarMonitorEnabled ? 1 : 0;
        dryMonitorSendRef.current = dryMonitorSend;

        const wetMonitorSend = audioCtx.createGain();
        wetMonitorSend.gain.value = inEarMonitorEnabled && echoEnabled ? 1 : 0;
        wetMonitorSendRef.current = wetMonitorSend;

        const reverbMonitorSend = audioCtx.createGain();
        reverbMonitorSend.gain.value = inEarMonitorEnabled && reverbEnabled ? 1 : 0;
        reverbMonitorSendRef.current = reverbMonitorSend;

        // 1. Route Microphone Source into Volume Gain
        sourceNode.connect(micGain);

        // 2. Connect Volume Gain to Visualizer Analyser (always active once mic is on)
        micGain.connect(analyserNode);

        // 3. Build Delay / Feedback loop for echo
        micGain.connect(delayNode);
        delayNode.connect(feedbackGain);
        feedbackGain.connect(delayNode);
        delayNode.connect(echoWetGain);

        // 4. Build convolution reverb (separate from delay echo)
        micGain.connect(reverbSendGain);
        reverbSendGain.connect(convolverNode);
        convolverNode.connect(reverbMakeupGain);
        reverbMakeupGain.connect(reverbWetGain);

        // 5. Monitor path (耳返): dry/wet -> send gains -> panner -> monitor -> destination
        if (pannerNode) {
          micGain.connect(dryMonitorSend);
          echoWetGain.connect(wetMonitorSend);
          reverbWetGain.connect(reverbMonitorSend);
          dryMonitorSend.connect(pannerNode);
          wetMonitorSend.connect(pannerNode);
          reverbMonitorSend.connect(pannerNode);
          pannerNode.connect(monitorGain);
        } else {
          micGain.connect(dryMonitorSend);
          echoWetGain.connect(wetMonitorSend);
          reverbWetGain.connect(reverbMonitorSend);
          dryMonitorSend.connect(monitorGain);
          wetMonitorSend.connect(monitorGain);
          reverbMonitorSend.connect(monitorGain);
        }

        applyInEarMonitorState(inEarMonitorEnabled);

        setMicActive(true);
    } catch (err) {
      console.error("Microphone Access Error:", err);
      if (!options?.silent) {
        toast.error("無法存取麥克風，請確認瀏覽器權限", 6000);
      }
      throw err;
    }
  };

  const activateMicStreamRef = useRef(activateMicStream);
  activateMicStreamRef.current = activateMicStream;

  const toggleMicStream = async () => {
    if (micPreferred) {
      if (micActive) {
        deactivateMic();
      }
      setMicPreferred(false);
      return;
    }

    try {
      await activateMicStream();
      setMicPreferred(true);
    } catch {
      setMicPreferred(false);
    }
  };

  useEffect(() => {
    if (!micRestorePendingRef.current) return;

    const restoreMic = () => {
      micRestorePendingRef.current = false;
      document.removeEventListener("pointerdown", restoreMic);
      void activateMicStreamRef.current({ silent: true }).catch(() => {
        setMicPreferred(false);
      });
    };

    document.addEventListener("pointerdown", restoreMic);
    return () => document.removeEventListener("pointerdown", restoreMic);
  }, []);

  const deactivateMic = () => {
    setMicActive(false);

    // Cancel dynamic visualizer loop
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    // Stop streams
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }

    // Disconnect routing
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch (e) {}
      sourceNodeRef.current = null;
    }

    if (micGainRef.current) {
      try { micGainRef.current.disconnect(); } catch (e) {}
      micGainRef.current = null;
    }

    if (delayNodeRef.current) {
      try { delayNodeRef.current.disconnect(); } catch (e) {}
      delayNodeRef.current = null;
    }

    if (feedbackGainRef.current) {
      try { feedbackGainRef.current.disconnect(); } catch (e) {}
      feedbackGainRef.current = null;
    }

    if (echoWetGainRef.current) {
      try { echoWetGainRef.current.disconnect(); } catch (e) {}
      echoWetGainRef.current = null;
    }

    if (convolverNodeRef.current) {
      try { convolverNodeRef.current.disconnect(); } catch (e) {}
      convolverNodeRef.current = null;
    }

    if (reverbSendGainRef.current) {
      try { reverbSendGainRef.current.disconnect(); } catch (e) {}
      reverbSendGainRef.current = null;
    }

    if (reverbMakeupGainRef.current) {
      try { reverbMakeupGainRef.current.disconnect(); } catch (e) {}
      reverbMakeupGainRef.current = null;
    }

    if (reverbWetGainRef.current) {
      try { reverbWetGainRef.current.disconnect(); } catch (e) {}
      reverbWetGainRef.current = null;
    }

    if (pannerNodeRef.current) {
      try { pannerNodeRef.current.disconnect(); } catch (e) {}
      pannerNodeRef.current = null;
    }

    if (analyserNodeRef.current) {
      try { analyserNodeRef.current.disconnect(); } catch (e) {}
      analyserNodeRef.current = null;
    }

    if (monitorGainRef.current) {
      try { monitorGainRef.current.disconnect(); } catch (e) {}
      monitorGainRef.current = null;
    }

    if (dryMonitorSendRef.current) {
      try { dryMonitorSendRef.current.disconnect(); } catch (e) {}
      dryMonitorSendRef.current = null;
    }

    if (wetMonitorSendRef.current) {
      try { wetMonitorSendRef.current.disconnect(); } catch (e) {}
      wetMonitorSendRef.current = null;
    }

    if (reverbMonitorSendRef.current) {
      try { reverbMonitorSendRef.current.disconnect(); } catch (e) {}
      reverbMonitorSendRef.current = null;
    }
  };

  const disconnectRecordingGraph = () => {
    const vocalDest = recordDestNodeRef.current;
    const backingDest = backingRecordDestRef.current;

    if (micGainRef.current && vocalDest) {
      try { micGainRef.current.disconnect(vocalDest); } catch { /* ignore */ }
    }
    if (echoWetGainRef.current && vocalDest) {
      try { echoWetGainRef.current.disconnect(vocalDest); } catch { /* ignore */ }
    }
    if (reverbWetGainRef.current && vocalDest) {
      try { reverbWetGainRef.current.disconnect(vocalDest); } catch { /* ignore */ }
    }
    if (backingMonitorGainRef.current && backingDest) {
      try { backingMonitorGainRef.current.disconnect(backingDest); } catch { /* ignore */ }
    }

    recordDestNodeRef.current = null;
    backingRecordDestRef.current = null;
  };

  const connectRecordingGraph = async () => {
    if (!audioCtxRef.current) return;

    if (currentSong && !backingMonitorGainRef.current) {
      await setupBackingAudioGraph(currentSong.id);
    }

    disconnectRecordingGraph();

    const ctx = audioCtxRef.current;
    recordDestNodeRef.current = ctx.createMediaStreamDestination();
    backingRecordDestRef.current = ctx.createMediaStreamDestination();

    micGainRef.current?.connect(recordDestNodeRef.current);
    echoWetGainRef.current?.connect(recordDestNodeRef.current);
    reverbWetGainRef.current?.connect(recordDestNodeRef.current);
    backingMonitorGainRef.current?.connect(backingRecordDestRef.current);
  };

  const handleAutoDetectLatency = async () => {
    if (!micActive || !audioCtxRef.current || !micGainRef.current) {
      toast.error("請先開啟麥克風", 4000);
      return;
    }
    if (isRecording) {
      toast.error("錄音中無法偵測延遲", 4000);
      return;
    }

    setIsDetectingLatency(true);
    toast.info("正在校正錄音路徑延遲（請保持環境安靜）...", 3500);

    try {
      const audioCtx = audioCtxRef.current;
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      let detectedMs: number;
      try {
        detectedMs = await measureExportPathLatencyMs(audioCtx, {
          micGain: micGainRef.current,
          echoWetGain: echoWetGainRef.current,
          reverbWetGain: reverbWetGainRef.current,
          duckGain: backingGainNodeRef.current,
          playbackRate: ytPlaybackRate,
          pitch: ytPitch,
        });
        setMicLatencyMs(detectedMs);
        toast.success(`已校正錄音延遲：${detectedMs} ms`);
      } catch (measureErr) {
        console.warn("Export path measurement failed, using estimate:", measureErr);
        detectedMs = estimateExportLatencyMs(audioCtx);
        setMicLatencyMs(detectedMs);
        toast.info(`無法量測錄音路徑，已改用估算 ${detectedMs} ms`, 4500);
      }
    } catch (err) {
      console.error("Auto latency detection error:", err);
      toast.error("延遲偵測失敗，請確認喇叭／耳機音量", 4500);
    } finally {
      setIsDetectingLatency(false);
    }
  };

  const resolveExportLatencyMs = async (): Promise<number> => {
    const audioCtx = audioCtxRef.current;
    const micGain = micGainRef.current;
    if (!audioCtx || !micGain) {
      return clampLatencyStep(micLatencyMsRef.current);
    }

    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }
    try {
      const detectedMs = await measureExportPathLatencyMs(audioCtx, {
        micGain,
        echoWetGain: echoWetGainRef.current,
        reverbWetGain: reverbWetGainRef.current,
        duckGain: backingGainNodeRef.current,
        playbackRate: ytPlaybackRate,
        pitch: ytPitch,
      });
      setMicLatencyMs(detectedMs);
      return detectedMs;
    } catch (measureErr) {
      console.warn("Export latency auto-detect failed, using estimate:", measureErr);
      const estimatedMs = estimateExportLatencyMs(audioCtx);
      setMicLatencyMs(estimatedMs);
      return estimatedMs;
    }
  };

  const handleRecordToggle = async () => {
    if (isRecording) {
      if (recordingStartedAtRef.current != null) {
        recordingDurationSecRef.current =
          (performance.now() - recordingStartedAtRef.current) / 1000;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (backingRecorderRef.current && backingRecorderRef.current.state !== "inactive") {
        backingRecorderRef.current.stop();
      }
      setIsRecording(false);
    } else {
      if (!micPreferred) {
        toast.error("請先開啟麥克風", 4000);
        return;
      }

      if (!micActive) {
        try {
          await activateMicStream();
        } catch {
          toast.error("無法存取麥克風，請確認瀏覽器權限", 6000);
          return;
        }
      }

      if (!audioCtxRef.current) {
        toast.error("請先開啟麥克風", 4000);
        return;
      }

      recordedChunksRef.current = [];
      backingRecordedChunksRef.current = [];
      isFinalizingRecordingRef.current = false;

      try {
        await connectRecordingGraph();
        recordingHadBackingRef.current = Boolean(
          currentSong && backingMonitorGainRef.current
        );

        const vocalDest = recordDestNodeRef.current!;
        const backingDest = backingRecordDestRef.current!;
        const recorderMimeType = getRecorderMimeType();
        const recorderOptions = recorderMimeType ? { mimeType: recorderMimeType } : undefined;

        const vocalRecorder = new MediaRecorder(vocalDest.stream, recorderOptions);
        vocalRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            recordedChunksRef.current.push(e.data);
          }
        };

        let backingRecorder: MediaRecorder | null = null;
        if (recordingHadBackingRef.current) {
          backingRecorder = new MediaRecorder(backingDest.stream, recorderOptions);
          backingRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
              backingRecordedChunksRef.current.push(e.data);
            }
          };
        }

        let vocalStopped = false;
        let backingStopped = !recordingHadBackingRef.current;

        const finalizeRecording = async () => {
          if (!vocalStopped || !backingStopped || isFinalizingRecordingRef.current) return;
          isFinalizingRecordingRef.current = true;

          const expectedDurationSec = recordingDurationSecRef.current;

          try {
            const vocalBlob = new Blob(recordedChunksRef.current, {
              type: recorderMimeType ?? "audio/webm",
            });
            const backingBlob = new Blob(backingRecordedChunksRef.current, {
              type: recorderMimeType ?? "audio/webm",
            });

            if (!isValidAudioBlob(vocalBlob)) {
              throw new Error("Vocal recording is empty");
            }

            const latencyMs = clampLatencyStep(micLatencyMsRef.current);

            if (recordingHadBackingRef.current && isValidAudioBlob(backingBlob)) {
              const merged = await mergeRecordingWithLatency(
                vocalBlob,
                backingBlob,
                latencyMs,
                expectedDurationSec
              );
              setRecordedPreviewUrl(URL.createObjectURL(merged));
              toast.success(`錄音完成，已套用延遲補償 ${latencyMs} ms`);
            } else {
              const vocalWav = await blobToWav(vocalBlob, expectedDurationSec);
              setRecordedPreviewUrl(URL.createObjectURL(vocalWav));
              toast.info("無伴奏軌，已匯出人聲（無延遲補償）", 4000);
            }
          } catch (err) {
            console.error("Merge recording error:", err);
            try {
              const vocalBlob = new Blob(recordedChunksRef.current, {
                type: recorderMimeType ?? "audio/webm",
              });
              const vocalWav = await blobToWav(vocalBlob, expectedDurationSec);
              setRecordedPreviewUrl(URL.createObjectURL(vocalWav));
              toast.error("合併失敗，已匯出未補償人聲 WAV", 5000);
            } catch (fallbackErr) {
              console.error("Vocal export fallback error:", fallbackErr);
              toast.error("錄音匯出失敗", 5000);
            }
          } finally {
            disconnectRecordingGraph();
            isFinalizingRecordingRef.current = false;
          }
        };

        vocalRecorder.onstop = () => {
          vocalStopped = true;
          finalizeRecording();
        };
        if (backingRecorder) {
          backingRecorder.onstop = () => {
            backingStopped = true;
            finalizeRecording();
          };
        }

        vocalRecorder.start(100);
        backingRecorder?.start(100);
        mediaRecorderRef.current = vocalRecorder;
        backingRecorderRef.current = backingRecorder;
        setIsRecording(true);
      } catch (err) {
        console.error("Recording error:", err);
        disconnectRecordingGraph();
        toast.error("錄音啟動失敗", 4000);
      }
    }
  };

  const handlePlaybackRateChange = (rate: number) => {
    ytPlaybackRateRef.current = rate;
    setYtPlaybackRate(rate);
    if (playerRef.current && ytReady) {
      playerRef.current.setPlaybackRate(rate);
    }
    const backing = backingAudioElementRef.current;
    if (backing) {
      backing.preservesPitch = false;
      backing.playbackRate = rate;
    }
    if (stretchNodeRef.current) {
      applyStretchPitchAndRate(stretchNodeRef.current, ytPitchRef.current, rate);
    }
  };

  const handlePitchChange = async (pitch: number) => {
    if (backingSourceRef.current === "youtube") {
      toast.info("雲端模式無法調整伴奏音高", 3000);
      return;
    }
    ytPitchRef.current = pitch;
    setYtPitch(pitch);
    if (!currentSong) return;
    if (!backingSourceNodeRef.current) {
      await setupBackingAudioGraph(currentSong.id);
    }
    applyBackingPitchAndRate();
  };

  const nextQueuedSong = playlist[0];
  const closeMobileSidebar = () => {
    setIsMobileSidebarOpen(false);
    isMobileSheetDraggingRef.current = false;
    setIsMobileSheetDragging(false);
  };
  const handleMobileSheetDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isMobileSidebarOpen) return;
    isMobileSheetDraggingRef.current = true;
    setIsMobileSheetDragging(true);
    mobileSheetDragStartYRef.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handleMobileSheetDragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isMobileSheetDraggingRef.current) return;
    const delta = Math.max(0, event.clientY - mobileSheetDragStartYRef.current);
    setMobileSheetDragY(delta);
  };
  const handleMobileSheetDragEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isMobileSheetDraggingRef.current) return;
    isMobileSheetDraggingRef.current = false;
    setIsMobileSheetDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
    const delta = Math.max(0, event.clientY - mobileSheetDragStartYRef.current);
    if (delta >= 40) {
      closeMobileSidebar();
      return;
    }
    setMobileSheetDragY(0);
  };
  const handleMobileSheetDragCancel = () => {
    isMobileSheetDraggingRef.current = false;
    setIsMobileSheetDragging(false);
    setMobileSheetDragY(0);
  };
  const sidebarContent = (
    <>
      <Card id="add-song-widget" padding="md" className="space-y-2 flex-shrink-0">
        <div className="space-y-2">
          <div>
            <SearchInput
              id="input-youtube-id"
              icon={Youtube}
              placeholder="YouTube 連結"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              className="!bg-interactive-secondary focus:!bg-interactive-secondary hover:!bg-interactive-secondary-hover"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button
              id="btn-add-regular"
              onClick={() => handleAddSong(customInput, "", "", false)}
              fullWidth
            >
              加入
            </Button>
            <Button
              id="btn-add-priority"
              variant="primary"
              onClick={() => handleAddSong(customInput, "", "", true)}
              fullWidth
            >
              插播
            </Button>
          </div>
        </div>
      </Card>

      <Card id="queue-playlist-widget" padding="md" className="flex flex-col lg:flex-1 lg:min-h-0 lg:overflow-hidden">
        <PanelHeader
          title={`待播清單 (${playlist.length})`}
          className="mb-2"
          action={
            playlist.length > 0 ? (
              <button
                onClick={() => {
                  commitPlaylist([]);
                  preservePlaybackAfterQueueChange();
                }}
                className="text-[10px] text-neutral-500 hover:text-primary-400 font-bold transition-colors duration-normal ease-default cursor-pointer"
              >
                清空
              </button>
            ) : undefined
          }
        />

        <div className="flex-1 min-h-0 overflow-y-auto pr-1 scrollbar-thin">
          {!currentSong && playlist.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-4 my-auto">
              <ListMusic className="w-8 h-8 text-neutral-700 mb-2" />
              <Text variant="body" color="muted" as="p" className="font-bold text-sm">尚無歌曲</Text>
            </div>
          ) : (
            <>
              {currentSong && (
                <div className="pt-5 pb-3 mb-3 rounded-xl px-2">
                  <div className="py-1 pl-0.5 flex items-center gap-2.5 min-w-0">
                    <SpectrumBars active={playerState === 1} />
                    <div className="truncate flex-1 min-w-0">
                      <Text variant="h3" color="primary" as="h4" className="truncate leading-tight">
                        {renderSongTitle(currentSong)}
                      </Text>
                      <p className="text-[9px] text-neutral-400 mt-0.5 truncate flex items-center gap-1.5">
                        <span>{currentSong.artist || "未知"}</span>
                        <Badge variant="brand" size="sm">播放中</Badge>
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {playlist.length > 0 && (
                <div className="space-y-1">
                  {playlist.map((song, index) => (
                    <div
                      key={`${song.id}-${index}`}
                      className="py-2.5 pl-0.5 flex items-center justify-between gap-2 rounded-lg"
                    >
                      <div className="flex items-center gap-2.5 truncate flex-1 min-w-0">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center font-mono text-[9px] font-black shrink-0 bg-surface-idle text-neutral-500">
                          {index + 1}
                        </div>
                        <div className="truncate">
                          <Text variant="h3" color="primary" as="h4" className="truncate leading-tight">
                            {renderSongTitle(song)}
                          </Text>
                          <p className="text-[9px] text-neutral-400 mt-0.5 truncate flex items-center gap-1.5">
                            <span>{song.artist || "未知"}</span>
                            {index === 0 && currentSong && (
                              <Badge variant="brand" size="sm">下一首</Badge>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {index > 0 && (
                          <Button
                            size="sm"
                            onClick={() => handleMoveToTop(index)}
                            className="p-1 px-1.5 min-w-0 text-[9px]"
                            title="插播"
                          >
                            插播
                          </Button>
                        )}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleRemoveSong(index);
                          }}
                          className="p-1.5 text-neutral-500 hover:text-primary-400 transition-colors duration-normal ease-default cursor-pointer"
                          title="刪除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      <Card id="quick-song-widget" padding="md" className="flex-shrink-0">
        <div id="quick-song-panel">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-base font-black tracking-wide text-neutral-200">快速點歌</span>
            <div className="inline-flex items-center p-0.5 rounded-lg bg-surface-inset">
              <button
                type="button"
                onClick={() => setQuickSongTab("frequent")}
                className={cn(
                  "px-2 py-1 rounded-md text-[10px] font-bold transition-colors duration-fast ease-default cursor-pointer",
                  quickSongTab === "frequent"
                    ? "bg-interactive-primary text-text-inverse"
                    : "text-neutral-400 hover:text-neutral-200"
                )}
              >
                常用
              </button>
              <button
                type="button"
                onClick={() => setQuickSongTab("history")}
                className={cn(
                  "px-2 py-1 rounded-md text-[10px] font-bold transition-colors duration-fast ease-default cursor-pointer",
                  quickSongTab === "history"
                    ? "bg-interactive-primary text-text-inverse"
                    : "text-neutral-400 hover:text-neutral-200"
                )}
              >
                紀錄
              </button>
            </div>
          </div>

          <div
            className={cn(
              "h-[calc(1.75rem*4+0.25rem*3)] pr-1",
              quickSongTab === "history" ? "overflow-y-auto scrollbar-thin" : "overflow-hidden"
            )}
          >
            <div className="flex flex-col gap-1">
              {quickSongTab === "frequent" &&
                frequentSongs.map((entry) => (
                  <button
                    key={`${entry.song.id}-freq`}
                    onClick={() => handleAddSong(entry.song.id, entry.song.title, entry.song.artist, false)}
                    className="w-full h-7 px-2.5 bg-neutral-900 hover:bg-neutral-800 hover:text-neutral-100 text-neutral-300 rounded-xl text-[10px] font-bold transition-colors duration-normal ease-default cursor-pointer flex items-center gap-1.5 text-left shrink-0"
                  >
                    <RotateCcw className="w-3 h-3 flex-shrink-0" />
                    {renderQuickSongTitle(entry.song)}
                  </button>
                ))}

              {quickSongTab === "history" &&
                history.map((song, i) => (
                  <button
                    key={`${song.id}-hist-${i}`}
                    onClick={() => handleAddSong(song.id, song.title, song.artist, false)}
                    className="w-full h-7 px-2.5 bg-neutral-900 hover:bg-neutral-800 hover:text-neutral-100 text-neutral-300 rounded-xl text-[10px] font-bold transition-colors duration-normal ease-default cursor-pointer flex items-center gap-1.5 text-left shrink-0"
                  >
                    <RotateCcw className="w-3 h-3 flex-shrink-0" />
                    {renderQuickSongTitle(song)}
                  </button>
                ))}
            </div>

            {quickSongTab === "frequent" && frequentSongs.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center p-2">
                <ListMusic className="w-8 h-8 text-neutral-700 mb-2" />
                <Text variant="body" color="muted" as="p" className="font-bold text-sm">
                  尚無常用歌曲
                </Text>
              </div>
            )}
            {quickSongTab === "history" && history.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center p-2">
                <ListMusic className="w-8 h-8 text-neutral-700 mb-2" />
                <Text variant="body" color="muted" as="p" className="font-bold text-sm">
                  尚無演唱紀錄
                </Text>
              </div>
            )}
          </div>
        </div>
      </Card>
    </>
  );

  const backingUsesYoutubeNative = backingSource === "youtube";

  return (
    <>
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
      {backingSource === "stream" && nextQueuedSong && nextQueuedSong.id !== currentSong?.id ? (
        <audio
          key={`prefetch-${nextQueuedSong.id}`}
          preload="auto"
          src={`/api/stream?v=${nextQueuedSong.id}`}
          className="hidden"
          aria-hidden
        />
      ) : null}
      <ThemeToggle className="fixed top-3 right-3 sm:top-4 sm:right-4 z-50" />
      <KaraokeLayout
      playerSection={
        <div className="flex flex-col lg:min-h-0 lg:flex-1 gap-3 lg:overflow-hidden">
          <div className="relative flex-shrink-0">
          <Card id="ktv-player-container-block" padding="none" radius="3xl" className="overflow-hidden flex flex-col relative group">
            <div
              className={`relative w-full aspect-video overflow-hidden flex items-center justify-center flex-shrink-0 ${
                currentSong ? "bg-black" : "bg-surface-idle"
              }`}
            >
              <div className={`absolute inset-0 w-full h-full ${currentSong ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
                <div id="yt-player-container" className="w-full h-full" />
              </div>
              {currentSong && backingSource === "stream" ? (
                <audio
                  key={`${currentSong.id}-${backingStreamRetry}`}
                  ref={backingAudioElementRef}
                  src={`/api/stream?v=${encodeURIComponent(currentSong.id)}&_r=${backingStreamRetry}`}
                  crossOrigin="anonymous"
                  preload="auto"
                  className="hidden"
                  onError={() => {
                    if (backingStreamRetry < 3) {
                      window.setTimeout(() => {
                        setBackingStreamRetry((retry) => retry + 1);
                      }, 2000 * (backingStreamRetry + 1));
                      return;
                    }
                    switchToYoutubeBacking("伴奏串流失敗，改用 YouTube 原聲伴奏");
                    const player = playerRef.current;
                    if (player) {
                      void beginSyncedPlaybackRef.current(
                        player,
                        player.getCurrentTime?.() ?? 0
                      );
                    }
                  }}
                />
              ) : null}
              {!currentSong ? (
                <div id="idle-player-screen" className="absolute inset-0 w-full h-full flex flex-col items-center justify-center p-4 text-center">
                  <span aria-hidden className="idle-mic-icon h-24 w-auto mb-4" />
                  <Text variant="h3" color="subtle" as="h3" className="text-2xl tracking-wide">
                    請點歌開始
                  </Text>
                </div>
              ) : null}
            </div>

            <div className="bg-surface-panel px-3 py-2 flex flex-row items-center justify-between gap-2 flex-shrink-0">
              <div className="flex items-center gap-2 sm:gap-3">
                <IconButton
                  id="btn-play-pause"
                  variant="primary"
                  onClick={togglePlayPause}
                  disabled={!currentSong}
                  title={playerState === 1 ? "暫停" : "播放"}
                >
                  {playerState === 1 ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                </IconButton>

                <IconButton
                  id="btn-restart-track"
                  size="sm"
                  round={false}
                  onClick={restartCurrentTrack}
                  disabled={!currentSong}
                  title="重播"
                  className="!w-8 !h-8"
                >
                  <RotateCcw className="w-4.5 h-4.5" />
                </IconButton>

                <IconButton
                  id="btn-next-track"
                  size="sm"
                  round={false}
                  onClick={playNext}
                  disabled={playlist.length === 0}
                  title="下一首"
                  className="!w-8 !h-8"
                >
                  <SkipForward className="w-4 h-4" />
                </IconButton>
              </div>

              {/* 桌機：完整控制列 */}
              <div className="hidden sm:flex flex-row items-center gap-2 flex-1 justify-end flex-wrap">
                <div className="flex items-center gap-2 h-8" title="變調">
                  <div className="flex items-center justify-center gap-0.5 w-[100px] h-8">
                    <IconButton
                      id="btn-pitch-down"
                      size="sm"
                      onClick={() => handlePitchChange(ytPitch - 1)}
                      disabled={backingUsesYoutubeNative || ytPitch <= -6}
                      title="降 Key"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </IconButton>
                    <span
                      id="label-accompany-pitch"
                      className="inline-flex items-center justify-center text-[10px] font-mono leading-none w-8 h-8 text-neutral-400 tabular-nums shrink-0"
                    >
                      {ytPitch > 0 ? `+${ytPitch}` : ytPitch}
                    </span>
                    <IconButton
                      id="btn-pitch-up"
                      size="sm"
                      onClick={() => handlePitchChange(ytPitch + 1)}
                      disabled={backingUsesYoutubeNative || ytPitch >= 6}
                      title="升 Key"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </IconButton>
                  </div>
                </div>

                <div className="flex items-center gap-2 h-8" title="速度">
                  <Gauge className="w-4 h-4 shrink-0 text-neutral-400" />
                  <div className="flex items-center gap-2 w-[100px] h-8">
                    <Slider
                      id="slider-accompany-speed"
                      accent="primary"
                      min={0.5}
                      max={1.5}
                      step={0.05}
                      value={ytPlaybackRate}
                      onChange={(e) => handlePlaybackRateChange(parseFloat(e.target.value))}
                      className="flex-1 min-w-0"
                    />
                    <span className="inline-flex items-center justify-end text-[10px] font-mono leading-none w-8 h-8 text-neutral-400 tabular-nums shrink-0">
                      {ytPlaybackRate.toFixed(2)}x
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 h-8" title="音量">
                  <button
                    onClick={toggleMute}
                    className="inline-flex shrink-0 items-center justify-center w-4 h-4 text-neutral-400 hover:text-text-primary transition-colors duration-normal ease-default"
                  >
                    {isMuted || ytVolume === 0 ? (
                      <VolumeX className="w-4 h-4 text-neutral-400" />
                    ) : ytVolume < 40 ? (
                      <Volume1 className="w-4 h-4 text-neutral-400" />
                    ) : (
                      <Volume2 className="w-4 h-4 text-neutral-400" />
                    )}
                  </button>
                  <div className="flex items-center gap-2 w-[100px] h-8">
                    <Slider
                      id="slider-accompany-volume"
                      accent="primary"
                      min={0}
                      max={100}
                      value={ytVolume}
                      onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
                      className="flex-1 min-w-0"
                    />
                    <span className="inline-flex items-center justify-end text-[10px] font-mono leading-none w-8 h-8 text-neutral-400 tabular-nums shrink-0">
                      {ytVolume}%
                    </span>
                  </div>
                </div>
              </div>

              {/* 手機：符號按鈕（同排） */}
              <div ref={mobileAdjustButtonsRef} className="sm:hidden flex items-center gap-1">
                {(
                  [
                    { key: "pitch",  title: "變調", icon: <Sliders className="w-4 h-4" /> },
                    { key: "speed",  title: "速度", icon: <Gauge   className="w-4 h-4" /> },
                    {
                      key: "volume", title: "音量",
                      icon: isMuted || ytVolume === 0
                        ? <VolumeX className="w-4 h-4" />
                        : ytVolume < 40
                          ? <Volume1 className="w-4 h-4" />
                          : <Volume2 className="w-4 h-4" />,
                    },
                  ] as const
                ).map(({ key, title, icon }) => (
                  <button
                    key={key}
                    type="button"
                    title={title}
                    onClick={() => setMobileAdjustPanel((prev) => (prev === key ? null : key))}
                    className={cn(
                      "w-9 h-9 rounded-lg inline-flex items-center justify-center transition-colors duration-normal ease-default",
                      mobileAdjustPanel === key
                        ? "bg-surface-inset text-neutral-100"
                        : "text-neutral-400 hover:text-neutral-200"
                    )}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {/* 手機懸浮調整面板（在 Card 外，absolute 浮在 mixer 上方） */}
          {mobileAdjustPanel && (
            <div
              className={cn(
                "sm:hidden absolute top-full z-20 mt-1.5",
                mobileAdjustPanel === "pitch"
                  ? "right-20"
                  : mobileAdjustPanel === "speed"
                    ? "right-10"
                    : "right-0"
              )}
            >
              <div ref={mobileAdjustPanelRef} className="bg-surface-raised rounded-xl shadow-sm shadow-black/10 w-14 p-2">
                {mobileAdjustPanel === "pitch" && (
                  <div className="h-full flex items-center justify-center">
                    <button
                      type="button"
                      id="btn-pitch-down-mobile"
                      onClick={() => handlePitchChange(ytPitch - 1)}
                      title="降 Key"
                      disabled={backingUsesYoutubeNative || ytPitch <= -6}
                      className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-neutral-300 hover:text-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-normal ease-default"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="text-sm font-mono font-bold text-neutral-200 tabular-nums leading-none w-10 text-center">
                      {ytPitch > 0 ? `+${ytPitch}` : ytPitch}
                    </span>
                    <button
                      type="button"
                      id="btn-pitch-up-mobile"
                      onClick={() => handlePitchChange(ytPitch + 1)}
                      title="升 Key"
                      disabled={backingUsesYoutubeNative || ytPitch >= 6}
                      className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-neutral-300 hover:text-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-normal ease-default"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                )}
                {mobileAdjustPanel === "speed" && (
                  <div className="flex flex-col items-center gap-1.5 py-1">
                    <span className="text-[10px] font-mono text-neutral-400 leading-none tabular-nums">
                      {ytPlaybackRate.toFixed(2)}x
                    </span>
                    <div className="h-20 flex items-center justify-center">
                      <Slider
                        id="slider-accompany-speed-mobile"
                        orientation="vertical"
                        accent="primary"
                        min={0.5}
                        max={1.5}
                        step={0.05}
                        value={ytPlaybackRate}
                        onChange={(e) => handlePlaybackRateChange(parseFloat(e.target.value))}
                        className="h-full"
                      />
                    </div>
                  </div>
                )}
                {mobileAdjustPanel === "volume" && (
                  <div className="flex flex-col items-center gap-1.5 py-1">
                    <span className="text-[10px] font-mono text-neutral-400 leading-none tabular-nums">
                      {ytVolume}%
                    </span>
                    <div className="h-20 flex items-center justify-center">
                      <Slider
                        id="slider-accompany-volume-mobile"
                        orientation="vertical"
                        accent="primary"
                        min={0}
                        max={100}
                        value={ytVolume}
                        onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
                        className="h-full"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          </div>

          <div id="karaoke-mixer-dashboard" className="flex flex-col lg:flex-1 lg:min-h-0 lg:overflow-hidden">
            <div className="flex flex-col lg:flex-row flex-1 min-h-0 gap-2 overflow-visible lg:overflow-hidden">
              <div className="w-full min-w-0 max-w-none lg:w-[36%] lg:min-w-[13rem] lg:max-w-[16rem] flex flex-col gap-2 flex-shrink-0">
                <RecStrip
                  isRecording={isRecording}
                  recordingElapsedSec={recordingElapsedSec}
                  recordedAudioUrl={recordedAudioUrl}
                  canRecord={micPreferred}
                  onRecordToggle={handleRecordToggle}
                  micPreferred={micPreferred}
                  onMicToggle={toggleMicStream}
                  micActive={micActive}
                  inEarMonitorEnabled={inEarMonitorEnabled}
                  onMonitorToggle={() => toggleInEarMonitor()}
                  analyserNode={analyserNodeRef.current}
                />

                <Surface padding="sm" radius="2xl" className="flex-1 min-h-0 flex flex-col justify-center gap-1.5 bg-surface-raised">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-neutral-300">補償</span>
                    <div className="inline-flex items-center gap-1">
                      <span className="text-[11px] font-mono font-bold text-secondary-400">{micLatencyMs} ms</span>
                      <IconButton
                        id="btn-auto-detect-latency"
                        size="sm"
                        variant="ghost"
                        onClick={handleAutoDetectLatency}
                        disabled={!micActive || isDetectingLatency}
                        title="自動偵測延遲"
                        aria-label="自動偵測延遲"
                        className="!w-6 !h-6 !min-w-0"
                      >
                        {isDetectingLatency ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Timer className="w-3 h-3" />
                        )}
                      </IconButton>
                    </div>
                  </div>
                  <Slider
                    id="slider-mic-latency"
                    accent="secondary"
                    min={0}
                    max={500}
                    step={5}
                    value={micLatencyMs}
                    onChange={(e) => setMicLatencyMs(parseInt(e.target.value, 10))}
                    disabled={isDetectingLatency}
                    className="w-full"
                  />
                </Surface>
              </div>

              <div className="flex flex-col sm:flex-row flex-1 min-w-0 gap-2 overflow-visible lg:overflow-hidden">
                <div className="grid h-full min-h-0 flex-1 grid-cols-3 grid-rows-2 gap-2">
                  <KnobControl
                    label="人聲"
                    value={micGainValue}
                    displayValue={`${(micGainValue * 100).toFixed(0)}%`}
                    min={0}
                    max={2}
                    step={0.1}
                    onChange={setMicGainValue}
                  />
                  <KnobControl
                    label="迴音"
                    value={echoFeedbackValue}
                    displayValue={`${(echoFeedbackValue * 100).toFixed(0)}%`}
                    min={0}
                    max={0.85}
                    step={0.05}
                    onChange={setEchoFeedbackValue}
                    disabled={!echoEnabled}
                    dimmed={!echoEnabled}
                    toggleActive={echoEnabled}
                    onToggle={() => setEchoEnabled(!echoEnabled)}
                  />
                  <KnobControl
                    label="延遲"
                    value={echoDelayValue}
                    displayValue={`${(echoDelayValue * 1000).toFixed(0)}ms`}
                    min={0.05}
                    max={0.8}
                    step={0.05}
                    onChange={setEchoDelayValue}
                    disabled={!echoEnabled}
                    dimmed={!echoEnabled}
                  />
                  <KnobControl
                    label="平衡"
                    value={voicePanValue}
                    displayValue={
                      voicePanValue === 0
                        ? "C"
                        : voicePanValue < 0
                          ? `L${(Math.abs(voicePanValue) * 100).toFixed(0)}`
                          : `R${(voicePanValue * 100).toFixed(0)}`
                    }
                    min={-1}
                    max={1}
                    step={0.1}
                    onChange={setVoicePanValue}
                    disabled={!panEnabled}
                    dimmed={!panEnabled}
                    toggleActive={panEnabled}
                    onToggle={() => setPanEnabled(!panEnabled)}
                  />
                  <KnobControl
                    label="混響"
                    value={reverbWetValue}
                    displayValue={`${(reverbWetValue * 100).toFixed(0)}%`}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={setReverbWetValue}
                    disabled={!reverbEnabled}
                    dimmed={!reverbEnabled}
                    toggleActive={reverbEnabled}
                    onToggle={() => setReverbEnabled(!reverbEnabled)}
                  />
                  <KnobControl
                    label="空間"
                    value={reverbRoomSize}
                    displayValue={`${reverbRoomSize.toFixed(1)}s`}
                    min={0.5}
                    max={3}
                    step={0.1}
                    onChange={setReverbRoomSize}
                    disabled={!reverbEnabled}
                    dimmed={!reverbEnabled}
                  />
                </div>

                <Surface padding="sm" radius="2xl" className="hidden sm:flex sm:h-auto sm:w-[30%] sm:min-w-[7rem] sm:max-w-[10rem] flex-col flex-shrink-0 min-h-0 bg-surface-raised">
                  <div className="w-full flex flex-row items-center justify-between gap-2 pb-1.5 mb-1 flex-shrink-0">
                    <Text variant="label" color="muted" as="span" className="text-xs shrink-0">頻譜</Text>
                    <div className="inline-flex items-center gap-1.5 shrink-0">
                      <StatusDot variant={micActive ? "recording" : "inactive"} className="size-2" />
                      <span className="text-xs font-mono leading-none text-neutral-500">
                        {micActive ? "收訊" : "靜音"}
                      </span>
                    </div>
                  </div>

                  <div className="w-full flex-1 min-h-0 bg-surface-inset rounded-xl overflow-hidden relative">
                    <canvas
                      ref={canvasRef}
                      className="w-full h-full"
                      width={220}
                      height={140}
                    />
                  </div>
                </Surface>
              </div>
            </div>
          </div>
        </div>
      }
      sidebar={
        <div className="hidden lg:flex lg:flex-col lg:min-h-0 lg:flex-1 gap-3 lg:overflow-hidden">
          {sidebarContent}
        </div>
      }
    />
      <button
        type="button"
        onClick={() => setIsMobileSidebarOpen(true)}
        className="fixed bottom-3 right-3 z-40 lg:hidden inline-flex items-center gap-2 rounded-full bg-interactive-primary text-text-inverse px-4 py-2"
      >
        <Sliders className="w-4 h-4" />
        <span className="text-sm font-bold">點歌清單</span>
      </button>

      {isMobileSidebarOpen && (
        <button
          type="button"
          aria-label="關閉點歌面板"
          onClick={closeMobileSidebar}
          className="fixed inset-0 z-40 bg-black/25 lg:hidden"
        />
      )}

      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 lg:hidden transition-transform ease-default",
          isMobileSheetDragging ? "duration-0" : "duration-normal",
          isMobileSidebarOpen ? "translate-y-0" : "translate-y-full pointer-events-none"
        )}
        style={isMobileSidebarOpen ? { transform: `translateY(${mobileSheetDragY}px)` } : undefined}
      >
        <Card padding="none" radius="3xl" className="max-h-[82dvh] rounded-b-none flex flex-col overflow-hidden">
          <div
            className="px-4 pt-2 pb-1.5 cursor-grab active:cursor-grabbing touch-none"
            onClick={closeMobileSidebar}
            onPointerDown={handleMobileSheetDragStart}
            onPointerMove={handleMobileSheetDragMove}
            onPointerUp={handleMobileSheetDragEnd}
            onPointerCancel={handleMobileSheetDragCancel}
          >
            <div className="mx-auto h-1 w-12 rounded-full bg-neutral-600/70" />
          </div>
          <div className="overflow-y-auto p-3">
            <div className="flex flex-col gap-3">
              {sidebarContent}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
