import { spawn } from "child_process";
import express from "express";
import https from "https";
import path from "path";
import { createServer as createViteServer } from "vite";
import cors from "cors";

const YT_DLP_COMMANDS: Array<{ cmd: string; prefixArgs?: string[] }> = [
  { cmd: "yt-dlp" },
  { cmd: "python3", prefixArgs: ["-m", "yt_dlp"] },
];
const NODE_BIN = process.env.NODE_BIN || process.execPath;
const YT_DLP_TIMEOUT_MS = 90_000;
const YOUTUBE_PLAYER_CLIENTS = ["android", "web", "ios", "mweb"] as const;
let preferredYtDlpCommandIndex: number | null = null;
const HTTPS_AGENT = new https.Agent({ keepAlive: true, maxSockets: 64 });

function runYtDlp(args: string[], timeoutMs = YT_DLP_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    let lastError = "yt-dlp not available";
    const order =
      preferredYtDlpCommandIndex == null
        ? YT_DLP_COMMANDS.map((_, idx) => idx)
        : [
            preferredYtDlpCommandIndex,
            ...YT_DLP_COMMANDS.map((_, idx) => idx).filter((idx) => idx !== preferredYtDlpCommandIndex),
          ];

    const tryNext = (orderPos: number) => {
      if (orderPos >= order.length) {
        reject(new Error(lastError));
        return;
      }

      const candidateIdx = order[orderPos];
      const candidate = YT_DLP_COMMANDS[candidateIdx];
      const fullArgs = [...(candidate.prefixArgs ?? []), ...args];
      const proc = spawn(candidate.cmd, fullArgs, {
        shell: false,
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONUTF8: "1",
          PYTHONIOENCODING: "utf-8",
        },
      });
      const stdoutChunks: Buffer[] = [];
      let stderr = "";
      let finished = false;
      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        proc.kill("SIGKILL");
        lastError = `yt-dlp timeout after ${timeoutMs}ms`;
        tryNext(orderPos + 1);
      }, timeoutMs);

      proc.stdout.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      proc.on("error", (err) => {
        clearTimeout(timer);
        if (finished) return;
        finished = true;
        lastError = err.message;
        tryNext(orderPos + 1);
      });
      proc.on("close", (code) => {
        clearTimeout(timer);
        if (finished) return;
        finished = true;
        const stdout = Buffer.concat(stdoutChunks).toString("utf8");
        if (code === 0 && stdout.trim()) {
          preferredYtDlpCommandIndex = candidateIdx;
          resolve(stdout.trim());
          return;
        }
        lastError = stderr.trim() || `yt-dlp exited with code ${code}`;
        if (preferredYtDlpCommandIndex === candidateIdx) {
          preferredYtDlpCommandIndex = null;
        }
        tryNext(orderPos + 1);
      });
    };

    tryNext(0);
  });
}

function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        agent: HTTPS_AGENT,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }

        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(4000, () => req.destroy(new Error("request timeout")));
  });
}

const CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const audioUrlCache = new Map<string, CacheEntry<string>>();
const videoInfoCache = new Map<string, CacheEntry<{ title: string; artist: string }>>();
const inFlightAudioUrl = new Map<string, Promise<string>>();
const inFlightVideoInfo = new Map<string, Promise<{ title: string; artist: string }>>();

function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function ytDlpCommonArgs(): string[] {
  return [
    "--no-playlist",
    "--no-warnings",
    "--socket-timeout",
    "30",
    "--retries",
    "3",
    "--js-runtimes",
    `node:${NODE_BIN}`,
    "--remote-components",
    "ejs:github",
  ];
}

function spawnYtDlp(args: string[]) {
  const candidateIdx = preferredYtDlpCommandIndex ?? 0;
  const candidate = YT_DLP_COMMANDS[candidateIdx] ?? YT_DLP_COMMANDS[0];
  return spawn(candidate.cmd, [...(candidate.prefixArgs ?? []), ...args], {
    shell: false,
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      NODE_BIN,
    },
  });
}

function pipeYouTubeAudio(videoId: string, res: express.Response): Promise<boolean> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const tryClient = (clientIndex: number): Promise<boolean> => {
    if (clientIndex >= YOUTUBE_PLAYER_CLIENTS.length) {
      return Promise.resolve(false);
    }

    const client = YOUTUBE_PLAYER_CLIENTS[clientIndex];
    return new Promise((resolve) => {
      const proc = spawnYtDlp([
        ...ytDlpCommonArgs(),
        "--extractor-args",
        `youtube:player_client=${client}`,
        "-f",
        "ba/b",
        "-o",
        "-",
        watchUrl,
      ]);

      let stderr = "";
      let piped = false;
      let settled = false;

      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };

      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      proc.stdout.once("data", (chunk: Buffer) => {
        if (res.headersSent) {
          proc.kill("SIGKILL");
          finish(false);
          return;
        }
        piped = true;
        res.status(200);
        res.setHeader("Content-Type", "audio/webm");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "no-store");
        res.write(chunk);
        proc.stdout.pipe(res, { end: true });
        console.log(`yt-dlp pipe stream started via player_client=${client}`);
        finish(true);
      });

      proc.on("error", (err) => {
        console.warn(`yt-dlp pipe spawn error (${client}):`, err.message);
        if (!piped) {
          void tryClient(clientIndex + 1).then(finish);
        } else {
          finish(true);
        }
      });

      proc.on("close", (code) => {
        if (piped) return;
        console.warn(
          `yt-dlp pipe client=${client} failed:`,
          stderr.trim() || `exit code ${code}`
        );
        void tryClient(clientIndex + 1).then(finish);
      });

      res.on("close", () => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      });
    });
  };

  return tryClient(0);
}

async function getYouTubeAudioUrl(videoId: string): Promise<string> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  let lastError: Error | null = null;

  for (const client of YOUTUBE_PLAYER_CLIENTS) {
    try {
      const output = await runYtDlp([
        ...ytDlpCommonArgs(),
        "--extractor-args",
        `youtube:player_client=${client}`,
        "-f",
        "ba/b",
        "-g",
        watchUrl,
      ]);
      const url = output.split("\n")[0]?.trim() ?? "";
      if (url) {
        console.log(`yt-dlp audio URL resolved via player_client=${client}`);
        return url;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = error instanceof Error ? error : new Error(message);
      console.warn(`yt-dlp player_client=${client} failed:`, message);
    }
  }

  throw lastError ?? new Error("無法取得 YouTube 音訊網址");
}

async function getCachedYouTubeAudioUrl(videoId: string): Promise<string> {
  const cached = readCache(audioUrlCache, videoId);
  if (cached) return cached;

  let pending = inFlightAudioUrl.get(videoId);
  if (!pending) {
    pending = getYouTubeAudioUrl(videoId)
      .then((url) => {
        if (url) writeCache(audioUrlCache, videoId, url);
        return url;
      })
      .finally(() => {
        inFlightAudioUrl.delete(videoId);
      });
    inFlightAudioUrl.set(videoId, pending);
  }
  return pending;
}

interface YtDlpVideoJson {
  title?: string;
  uploader?: string;
  channel?: string;
}

interface YouTubeOEmbedJson {
  title?: string;
  author_name?: string;
}

async function getYouTubeVideoInfoFromOEmbed(
  videoId: string
): Promise<{ title: string; artist: string } | null> {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`
  )}&format=json`;
  const data = await fetchJson<YouTubeOEmbedJson>(url);
  const title = data.title?.trim();
  const artist = data.author_name?.trim();
  if (!title) return null;
  return {
    title,
    artist: artist || "未知",
  };
}

async function getYouTubeVideoInfo(videoId: string): Promise<{ title: string; artist: string }> {
  try {
    const fastInfo = await getYouTubeVideoInfoFromOEmbed(videoId);
    if (fastInfo) return fastInfo;
  } catch {
    // fallback to yt-dlp
  }

  const output = await runYtDlp([
    ...ytDlpCommonArgs(),
    "--extractor-args",
    "youtube:player_client=android,web",
    "-j",
    `https://www.youtube.com/watch?v=${videoId}`,
  ]);

  const jsonLine = output
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("{"));

  if (!jsonLine) {
    throw new Error("yt-dlp returned no JSON metadata");
  }

  const data = JSON.parse(jsonLine) as YtDlpVideoJson;

  return {
    title: data.title?.trim() || `YouTube (${videoId})`,
    artist: data.uploader?.trim() || data.channel?.trim() || "未知",
  };
}

async function getCachedYouTubeVideoInfo(videoId: string): Promise<{ title: string; artist: string }> {
  const cached = readCache(videoInfoCache, videoId);
  if (cached) return cached;

  let pending = inFlightVideoInfo.get(videoId);
  if (!pending) {
    pending = getYouTubeVideoInfo(videoId)
      .then((info) => {
        writeCache(videoInfoCache, videoId, info);
        return info;
      })
      .finally(() => {
        inFlightVideoInfo.delete(videoId);
      });
    inFlightVideoInfo.set(videoId, pending);
  }
  return pending;
}

function guessAudioContentType(audioUrl: string): string | undefined {
  if (audioUrl.includes("mime=audio%2Fmp4") || audioUrl.includes(".m4a")) {
    return "audio/mp4";
  }
  if (audioUrl.includes("mime=audio%2Fwebm") || audioUrl.includes(".webm")) {
    return "audio/webm";
  }
  return undefined;
}

function proxyAudioStream(
  audioUrl: string,
  req: express.Request,
  res: express.Response,
  redirectCount = 0
) {
  if (redirectCount > 5) {
    if (!res.headersSent) {
      res.status(502).json({ error: "Audio redirect loop" });
    }
    return;
  }

  const urlObj = new URL(audioUrl);
  const options: https.RequestOptions = {
    hostname: urlObj.hostname,
    path: `${urlObj.pathname}${urlObj.search}`,
    method: "GET",
    agent: HTTPS_AGENT,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Referer: "https://www.youtube.com/",
      Origin: "https://www.youtube.com",
    },
  };

  if (req.headers.range) {
    options.headers = {
      ...options.headers,
      Range: req.headers.range as string,
    };
  }

  const proxyReq = https.request(options, (audioRes) => {
    const status = audioRes.statusCode || 200;

    if (status >= 300 && status < 400 && audioRes.headers.location) {
      audioRes.resume();
      const nextUrl = new URL(audioRes.headers.location, audioUrl).href;
      proxyAudioStream(nextUrl, req, res, redirectCount + 1);
      return;
    }

    if (status >= 400) {
      audioRes.resume();
      if (!res.headersSent) {
        res.status(502).json({ error: `Upstream audio error: ${status}` });
      }
      return;
    }

    if (!res.headersSent) {
      res.status(status === 206 ? 206 : 200);
      res.setHeader("Access-Control-Allow-Origin", "*");
      for (const header of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        if (audioRes.headers[header]) {
          res.setHeader(header, audioRes.headers[header] as string);
        }
      }
      if (!res.getHeader("content-type")) {
        const guessed = guessAudioContentType(audioUrl);
        if (guessed) {
          res.setHeader("Content-Type", guessed);
        }
      }
      if (!res.getHeader("accept-ranges")) {
        res.setHeader("Accept-Ranges", "bytes");
      }
    }
    audioRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    console.error("Audio proxy error:", err);
    if (!res.headersSent) {
      res.status(502).json({ error: "Failed to stream audio" });
    } else {
      res.end();
    }
  });

  proxyReq.end();
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors());

  app.get("/api/health", async (_req, res) => {
    try {
      const version = await runYtDlp(["--version"], 15_000);
      let canExtract = false;
      try {
        const testUrl = await runYtDlp(
          [
            ...ytDlpCommonArgs(),
            "--extractor-args",
            "youtube:player_client=android",
            "-f",
            "ba/b",
            "-g",
            "https://www.youtube.com/watch?v=jNQXAC9IVRw",
          ],
          60_000
        );
        canExtract = Boolean(testUrl.trim());
      } catch (extractError) {
        console.warn("Health extract test failed:", extractError);
      }
      res.json({ ok: true, ytDlp: version.trim(), canExtract });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Health check failed:", message);
      res.status(503).json({ ok: false, error: message });
    }
  });

  app.get("/api/stream", async (req, res) => {
    const videoId = req.query.v as string;
    if (!videoId) {
      return res.status(400).json({ error: "Missing video ID" });
    }

    try {
      const audioUrl = await getCachedYouTubeAudioUrl(videoId);
      if (audioUrl) {
        proxyAudioStream(audioUrl, req, res);
        return;
      }
    } catch (error) {
      console.warn("Audio URL extraction failed, falling back to pipe:", error);
    }

    const piped = await pipeYouTubeAudio(videoId, res);
    if (!piped && !res.headersSent) {
      res.status(503).json({ error: "無法取得 YouTube 音訊，請稍後再試" });
    }
  });

  app.get("/api/video-info", async (req, res) => {
    const videoId = req.query.v as string;
    if (!videoId) {
      return res.status(400).json({ error: "Missing video ID" });
    }

    try {
      const info = await getCachedYouTubeVideoInfo(videoId);
      res.json(info);
    } catch (error) {
      console.error("Metadata fetch error:", error);
      res.status(503).json({ error: "無法取得 YouTube 影片資訊，請確認已安裝 yt-dlp" });
    }
  });

  app.get("/api/prefetch", async (req, res) => {
    const videoId = req.query.v as string;
    if (!videoId) {
      return res.status(400).json({ error: "Missing video ID" });
    }

    try {
      await Promise.all([
        getCachedYouTubeAudioUrl(videoId),
        getCachedYouTubeVideoInfo(videoId).catch(() => null),
      ]);
      res.status(204).end();
    } catch (error) {
      console.error("Prefetch error:", error);
      res.status(503).json({ error: "預載失敗" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
