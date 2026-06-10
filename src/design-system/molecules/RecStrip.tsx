import { useEffect, useRef, useState } from "react";
import { Circle, Download, HeadphoneOff, Headphones, Mic, MicOff, Pause, Play, Square } from "lucide-react";
import { formatRecordingTime } from "../../audio/RecordingPreviewPlayer";
import { cn } from "../utils/cn";
import { IconButton } from "../atoms/IconButton";
import { Slider } from "../atoms/Slider";

const WAVE_SAMPLE_MS = 40; // 每 40ms 採樣一次，約 25fps 捲動速度

function RecordingWave({ analyserNode }: { analyserNode: AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyserNode) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const wa = analyserNode.context.createAnalyser();
    wa.fftSize = 256;
    wa.smoothingTimeConstant = 0.4;
    analyserNode.connect(wa);

    const timeDomain = new Uint8Array(wa.fftSize);
    const dpr = window.devicePixelRatio || 1;
    const BAR_W  = 2 * dpr;
    const GAP    = 1 * dpr;
    const SLOT   = BAR_W + GAP;
    const RADIUS = BAR_W / 2;
    const CANVAS_H = 32 * dpr; // 對應 h-8，固定高度避免 ResizeObserver 迴圈

    canvas.height = CANVAS_H;

    // --ds-interactive-primary 直接是 hex 值（不是 var() 參考），可安全讀取
    const readThemeColor = () =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--ds-interactive-primary").trim() || "#e11d48";

    const ro = new ResizeObserver(() => { canvas.width = canvas.offsetWidth * dpr; });
    ro.observe(canvas);
    canvas.width = canvas.offsetWidth * dpr;

    const ampHistory: number[] = [];
    let lastSampleTime = 0;
    let raf = 0;

    const getRms = () => {
      wa.getByteTimeDomainData(timeDomain);
      let sum = 0;
      for (let i = 0; i < timeDomain.length; i++) {
        const v = (timeDomain[i] - 128) / 128;
        sum += v * v;
      }
      return Math.sqrt(sum / timeDomain.length);
    };

    const draw = (timestamp: number) => {
      raf = requestAnimationFrame(draw);

      if (timestamp - lastSampleTime >= WAVE_SAMPLE_MS) {
        lastSampleTime = timestamp;
        ampHistory.push(getRms());
        const maxSlots = Math.ceil(canvas.width / SLOT) + 4;
        if (ampHistory.length > maxSlots) ampHistory.splice(0, ampHistory.length - maxSlots);
      }

      const w = canvas.width;
      const h = canvas.height;
      if (!w || !h) return;

      ctx.clearRect(0, 0, w, h);
      // canvas.width 變更會重置 ctx 狀態（fillStyle 回到 #000），每幀重設主題色
      ctx.fillStyle = readThemeColor();

      const cy = h / 2;
      const maxHalf = cy * 0.85;
      const minHalf = dpr;

      for (let i = 0; i < ampHistory.length; i++) {
        const amp  = ampHistory[ampHistory.length - 1 - i];
        const cx   = w - i * SLOT;
        if (cx + BAR_W < 0) break;
        const barH = Math.min(Math.max(minHalf, amp * maxHalf * 2.5) * 2, h * 0.9);
        ctx.beginPath();
        ctx.roundRect(cx - BAR_W / 2, cy - barH / 2, BAR_W, barH, RADIUS);
        ctx.fill();
      }
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      try { analyserNode.disconnect(wa); } catch (_) {}
      wa.disconnect();
    };
  }, [analyserNode]);

  return <canvas ref={canvasRef} className="flex-1 min-w-0 lg:hidden h-8" />;
}

export interface RecStripProps {
  isRecording: boolean;
  recordingElapsedSec: number;
  recordedAudioUrl: string | null;
  canRecord: boolean;
  onRecordToggle: () => void;
  micPreferred: boolean;
  onMicToggle: () => void;
  micActive: boolean;
  inEarMonitorEnabled: boolean;
  onMonitorToggle: () => void;
  analyserNode?: AnalyserNode | null;
  className?: string;
}

const previewActionClassName = cn(
  "inline-flex items-center justify-center w-6 h-6 rounded-full transition-colors duration-normal ease-default shrink-0",
  "bg-transparent text-text-secondary hover:text-text-primary hover:bg-interactive-secondary"
);

export function RecStrip({
  isRecording,
  recordingElapsedSec,
  recordedAudioUrl,
  canRecord,
  onRecordToggle,
  micPreferred,
  onMicToggle,
  micActive,
  inEarMonitorEnabled,
  onMonitorToggle,
  analyserNode,
  className,
}: RecStripProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seekingRef = useRef(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const hasRecording = Boolean(recordedAudioUrl);
  const canPreview = hasRecording && !isRecording;

  const endSeeking = () => {
    seekingRef.current = false;
  };

  const syncCurrentTime = () => {
    const audio = audioRef.current;
    if (!audio || seekingRef.current) return;
    setCurrentTime(audio.currentTime);
  };

  useEffect(() => {
    if (!isRecording) return;
    setPreviewPlaying(false);
    setCurrentTime(0);
    seekingRef.current = false;
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }, [isRecording]);

  useEffect(() => {
    setPreviewPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    seekingRef.current = false;
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    audio.load();
  }, [recordedAudioUrl]);

  useEffect(() => {
    if (!previewPlaying) return;

    let rafId = 0;
    const tick = () => {
      syncCurrentTime();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId);
  }, [previewPlaying]);

  const beginSeeking = () => {
    seekingRef.current = true;
    const onPointerUp = () => {
      endSeeking();
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  const handleSeek = (value: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(duration) || duration <= 0) return;
    const nextTime = (value / 100) * duration;
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const togglePreview = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (previewPlaying) {
      audio.pause();
      setPreviewPlaying(false);
      return;
    }

    try {
      await audio.play();
      setPreviewPlaying(true);
    } catch (err) {
      console.error("Preview playback failed:", err);
      setPreviewPlaying(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          "rounded-2xl bg-surface-raised p-3 flex items-center gap-2 min-w-0 shrink-0 h-auto",
          className
        )}
      >
        <span className="text-[11px] font-bold text-neutral-300 shrink-0">REC</span>
        <IconButton
          id="btn-record-toggle"
          size="sm"
          variant={isRecording ? "primary" : "secondary"}
          onClick={onRecordToggle}
          disabled={!canRecord && !isRecording}
          title={isRecording ? "停止錄音" : canRecord ? "開始錄音" : "請先開啟麥克風"}
          aria-label={isRecording ? "停止錄音" : "開始錄音"}
          className="shrink-0 !transition-none"
        >
          {isRecording ? (
            <Square className="w-4 h-4 fill-current" />
          ) : (
            <Circle className="w-4 h-4 fill-current text-interactive-primary" />
          )}
        </IconButton>

        {isRecording ? (
          <span className="text-[11px] font-mono font-bold tabular-nums leading-none shrink-0 text-interactive-primary">
            {formatRecordingTime(recordingElapsedSec)}
          </span>
        ) : null}

        {isRecording
          ? <RecordingWave analyserNode={analyserNode ?? null} />
          : <div className="flex-1 lg:hidden" />
        }

        <IconButton
          id="monitor-quick-switch"
          size="sm"
          variant={inEarMonitorEnabled ? "primary" : "secondary"}
          onClick={onMonitorToggle}
          title={micActive ? "切換監聽" : "監聽設定"}
          aria-label="切換監聽"
          className="shrink-0 ml-auto !transition-none"
        >
          {inEarMonitorEnabled ? (
            <Headphones className="w-4 h-4" />
          ) : (
            <HeadphoneOff className="w-4 h-4" />
          )}
        </IconButton>

        <IconButton
          id="mic-quick-switch"
          size="sm"
          variant={micPreferred ? "primary" : "secondary"}
          onClick={onMicToggle}
          title="麥克風"
          aria-label="麥克風"
          className="shrink-0 !transition-none"
        >
          {micPreferred ? (
            <Mic className="w-4 h-4" />
          ) : (
            <MicOff className="w-4 h-4" />
          )}
        </IconButton>
      </div>

      <div className="rounded-2xl bg-surface-raised p-3 flex flex-col min-w-0 gap-1.5 shrink-0 min-h-12 justify-center">
        {hasRecording ? (
          <audio
            key={recordedAudioUrl}
            ref={audioRef}
            src={recordedAudioUrl!}
            preload="metadata"
            className="hidden"
            onLoadedMetadata={(event) => {
              event.currentTarget.currentTime = 0;
              setCurrentTime(0);
              setDuration(event.currentTarget.duration || 0);
            }}
            onDurationChange={(event) => {
              setDuration(event.currentTarget.duration || 0);
            }}
            onTimeUpdate={() => syncCurrentTime()}
            onEnded={() => setPreviewPlaying(false)}
            onPause={() => setPreviewPlaying(false)}
            onPlay={() => setPreviewPlaying(true)}
          />
        ) : null}

        <div className="flex items-center gap-1.5 w-full min-w-0">
          <IconButton
            size="sm"
            variant="ghost"
            onClick={() => void togglePreview()}
            disabled={!canPreview}
            tabIndex={canPreview ? 0 : -1}
            title={previewPlaying ? "暫停預覽" : "播放預覽"}
            aria-label={previewPlaying ? "暫停預覽" : "播放預覽"}
            className="!w-6 !h-6 !min-w-0"
          >
            {previewPlaying ? (
              <Pause className="w-3 h-3 fill-current" />
            ) : (
              <Play className="w-3 h-3 fill-current ml-px" />
            )}
          </IconButton>

          <Slider
            key={recordedAudioUrl ?? "empty-preview"}
            accent="secondary"
            trackSize="sm"
            className="flex-1 min-w-0"
            min={0}
            max={100}
            step={0.1}
            value={progress}
            disabled={!canPreview}
            onPointerDown={beginSeeking}
            onChange={(event) => {
              const value = parseFloat(event.target.value);
              handleSeek(value);
            }}
            onPointerUp={endSeeking}
            onPointerCancel={endSeeking}
            onLostPointerCapture={endSeeking}
            onBlur={endSeeking}
            aria-label="錄音預覽進度"
          />

          <span className="text-[10px] font-mono tabular-nums text-neutral-500 shrink-0 leading-none">
            {formatRecordingTime(currentTime)}/{formatRecordingTime(duration)}
          </span>

          <a
            href={hasRecording ? recordedAudioUrl! : undefined}
            download={hasRecording ? `ktv-record-${Date.now()}.wav` : undefined}
            title="下載錄音"
            tabIndex={canPreview ? 0 : -1}
            aria-hidden={!canPreview}
            className={cn(previewActionClassName, !canPreview && "pointer-events-none opacity-50")}
          >
            <Download className="w-3 h-3" />
          </a>
        </div>
      </div>
    </>
  );
}
