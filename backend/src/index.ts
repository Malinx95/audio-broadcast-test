import express from "express";
import http from "http";
import { Server as IOServer } from "socket.io";
import { createReadStream, appendFile } from "fs";
import { readdir } from "fs/promises";
import { extname, join } from "path";
import { PassThrough } from "stream";
import Throttle from "throttle";
import { v4 as uuidv4 } from "uuid";
import { ffprobe } from "@dropb/ffprobe";
import ffprobeStatic from "ffprobe-static";
import cors from "cors";

ffprobe.path = ffprobeStatic.path;

const PORT: number = 3000;
const app: express.Application = express();
app.use(cors());
const server: http.Server = http.createServer(app);
const io: IOServer = new IOServer(server);

// Define the structure of a track
interface Track {
  filepath: string;
  bitrate: number;
}

// Custom logging function
function log(
  message: string,
  level: "info" | "error" | "debug" = "info"
): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

  // Log to console
  console.log(logMessage);

  // Log to file
  appendFile("app.log", logMessage + "\n", (err) => {
    if (err) console.error("Failed to write to log file:", err);
  });
}

class Queue {
  private clients: Map<string, PassThrough>;
  private tracks: Track[];
  private currentTrack: Track | null;
  private index: number;
  private playing: boolean;
  private stream: NodeJS.ReadableStream | null;
  private throttle: Throttle | null;

  constructor() {
    this.clients = new Map();
    this.tracks = [];
    this.currentTrack = null;
    this.index = 0;
    this.playing = false;
    this.stream = null;
    this.throttle = null;
  }

  // Send audio chunk to all connected clients
  broadcast(chunk: Buffer): void {
    this.clients.forEach((client) => {
      client.write(chunk);
    });
  }

  // Add a new client to the broadcast list
  addClient(): { id: string; client: PassThrough } {
    const id = uuidv4();
    const client = new PassThrough();
    this.clients.set(id, client);
    log(`New client connected: ${id}`);
    return { id, client };
  }

  // Remove a client from the broadcast list
  removeClient(id: string): void {
    this.clients.delete(id);
    log(`Client disconnected: ${id}`);
  }

  // Load all MP3 tracks from a directory
  async loadTracks(dir: string): Promise<void> {
    let filenames = await readdir(dir);
    filenames = filenames.filter((filename) => extname(filename) === ".mp3");
    const filepaths = filenames.map((filename) => join(dir, filename));
    const promises = filepaths.map(async (filepath) => {
      const bitrate = await this.getTrackBitrate(filepath);
      return { filepath, bitrate };
    });
    this.tracks = await Promise.all(promises);
    log(`Loaded ${this.tracks.length} tracks`);
  }

  // Get the bitrate of a track using ffprobe
  async getTrackBitrate(filepath: string): Promise<number> {
    const data = await ffprobe(filepath);
    const bitrate = data?.format?.bit_rate;
    return bitrate ? parseInt(bitrate) : 128000;
  }

  // Get the next track in the playlist
  getNextTrack(): Track {
    if (this.index >= this.tracks.length - 1) {
      this.index = 0;
    }
    const track = this.tracks[this.index++];
    this.currentTrack = track;
    log(`Now playing: ${track.filepath}`);
    return track;
  }

  // Load the current track into the stream
  loadTrackStream(): void {
    const track = this.currentTrack;
    if (!track) return;
    log("Starting audio stream");
    this.stream = createReadStream(track.filepath);
  }

  // Start playing the current track
  async start(): Promise<void> {
    const track = this.currentTrack;
    if (!track || !this.stream) return;
    this.playing = true;
    this.throttle = new Throttle(track.bitrate / 8);
    this.stream
      .pipe(this.throttle)
      .on("data", (chunk: Buffer) => this.broadcast(chunk))
      .on("end", () => this.play(true))
      .on("error", (err) => {
        log(`Error playing track: ${err}`, "error");
        this.play(true);
      });
  }

  // Pause the current track
  pause(): void {
    if (!this.started() || !this.playing) return;
    this.playing = false;
    log("Playback paused");
    this.throttle?.removeAllListeners("end");
    this.throttle?.end();
  }

  // Check if playback has started
  started(): boolean {
    return !!(this.stream && this.throttle && this.currentTrack);
  }

  // Resume playback
  resume(): void {
    if (!this.started() || this.playing) return;
    log("Playback resumed");
    this.start();
  }

  // Play a track (either the current one or a new one)
  play(useNewTrack: boolean = false): void {
    if (useNewTrack || !this.currentTrack) {
      log("Playing new track");
      this.getNextTrack();
      this.loadTrackStream();
      this.start();
    } else {
      this.resume();
    }
  }
}

const queue = new Queue();

(async () => {
  await queue.loadTracks("tracks");
  queue.play();

  io.on("connection", (socket) => {
    log("New listener connected");
  });

  app.get("/stream", (req: express.Request, res: express.Response) => {
    const { id, client } = queue.addClient();

    res
      .set({
        "Content-Type": "audio/mpeg",
        "Transfer-Encoding": "chunked",
      })
      .status(200);

    client.pipe(res);

    req.on("close", () => {
      queue.removeClient(id);
    });
  });

  server.listen(PORT, () => {
    log(`Server listening on port ${PORT}`);
  });
})();
