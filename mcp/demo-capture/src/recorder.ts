import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { CDPSession, Page } from "playwright";
import { ffmpegPath } from "./encode.js";

export interface Step {
  t: number;
  label: string;
}

/**
 * Records a page through CDP `Page.startScreencast`. Works the same on a Chromium we
 * launched and on a tab of the user's Chrome attached over CDP.
 *
 * Chrome only emits a frame when the page repaints, so a timer re-feeds the latest
 * frame at a constant rate; ffmpeg gets a steady MJPEG stream and writes a
 * near-lossless intermediate that `encodeVideo` later shrinks.
 */
export class Recorder {
  private session?: CDPSession;
  private ffmpeg?: ChildProcessWithoutNullStreams;
  private timer?: NodeJS.Timeout;
  private lastFrame?: Buffer;
  private startedAt = 0;
  private stderr = "";
  readonly steps: Step[] = [];

  constructor(
    private readonly page: Page,
    readonly output: string,
    private readonly fps: number,
    private readonly size: { width: number; height: number },
  ) {}

  get elapsed(): number {
    return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
  }

  async start(): Promise<void> {
    this.ffmpeg = spawn(ffmpegPath(), [
      "-hide_banner", "-y",
      "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(this.fps), "-i", "-",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p",
      this.output,
    ]);
    this.ffmpeg.stderr.on("data", (d) => (this.stderr = (this.stderr + d).slice(-4000)));
    this.ffmpeg.stdin.on("error", () => {}); // reported on close instead

    await this.page.bringToFront(); // background tabs do not paint, so no frames
    this.session = await this.page.context().newCDPSession(this.page);
    this.session.on("Page.screencastFrame", (e: { data: string; sessionId: number }) => {
      this.lastFrame = Buffer.from(e.data, "base64");
      this.session?.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {});
    });
    await this.session.send("Page.startScreencast", {
      format: "jpeg",
      quality: 85,
      maxWidth: this.size.width,
      maxHeight: this.size.height,
      everyNthFrame: 1,
    });

    // Wait for a first frame (a static page may need a nudge to repaint).
    const deadline = Date.now() + 3000;
    while (!this.lastFrame && Date.now() < deadline) {
      await this.page.evaluate(() => window.scrollBy(0, 0)).catch(() => {});
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!this.lastFrame) {
      const buf = await this.page.screenshot({ type: "jpeg", quality: 85 });
      this.lastFrame = buf;
    }

    this.startedAt = Date.now();
    this.timer = setInterval(() => {
      if (this.lastFrame && this.ffmpeg?.stdin.writable) this.ffmpeg.stdin.write(this.lastFrame);
    }, 1000 / this.fps);
  }

  mark(label: string): Step {
    const step = { t: Number(this.elapsed.toFixed(2)), label };
    this.steps.push(step);
    return step;
  }

  async stop(): Promise<{ file: string; durationSec: number; steps: Step[] }> {
    const durationSec = Number(this.elapsed.toFixed(2));
    if (this.timer) clearInterval(this.timer);
    await this.session?.send("Page.stopScreencast").catch(() => {});
    await this.session?.detach().catch(() => {});
    const ff = this.ffmpeg!;
    const done = new Promise<number | null>((resolve) => ff.on("close", resolve));
    ff.stdin.end();
    const code = await done;
    if (code !== 0) throw new Error(`L'encodage de l'enregistrement a échoué (${code}) : ${this.stderr.slice(-800)}`);
    return { file: this.output, durationSec, steps: this.steps };
  }
}
