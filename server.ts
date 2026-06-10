import { spawn } from "child_process";
import express from "express";
import https from "https";
import path from "path";
import { createServer as createViteServer } from "vite";
import cors from "cors";

const YT_DLP_COMMANDS: Array<{ cmd: string; prefixArgs?: string[] }> = [
  { cmd: "yt-dlp" },
  { cmd: "python", prefixArgs: ["-m", "yt_dlp"] },
  { cmd: "py", prefixArgs: ["-m", "yt_dlp"] },
];
let preferredYtDlpCommandIndex: number | null = null;
const HTTPS_AGENT = new https.Agent({ keepAlive: true, maxSockets: 64 });

function runYtDlp(args: string[]): Promise<string> {
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

      proc.stdout.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      proc.on("error", (err) => {
        lastError = err.message;
        tryNext(orderPos + 1);
      });
      proc.on("close", (code) => {
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

async function getYouTubeAudioUrl(videoId: string): Promise<string> {
  const output = await runYtDlp([
    "-f",
    "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best",
    "--no-playlist",
    "--no-warnings",
    "-g",
    `https://www.youtube.com/watch?v=${videoId}`,
  ]);
  return output.split("\n")[0]?.trim() ?? "";
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
    "--no-playlist",
    "--no-warnings",
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

  app.get("/api/stream", async (req, res) => {
    const videoId = req.query.v as string;
    if (!videoId) {
      return res.status(400).json({ error: "Missing video ID" });
    }

    try {
      const audioUrl = await getCachedYouTubeAudioUrl(videoId);
      if (!audioUrl) {
        return res.status(503).json({ error: "無法取得 YouTube 音訊網址" });
      }
      proxyAudioStream(audioUrl, req, res);
    } catch (error) {
      console.error("Fetch error:", error);
      if (!res.headersSent) {
        res.status(503).json({ error: "無法取得 YouTube 音訊，請確認已安裝 yt-dlp" });
      }
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
