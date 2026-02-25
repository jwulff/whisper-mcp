import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getModelPath, isModelDownloaded } from "./models.js";

const execFileAsync = promisify(execFile);

// Validate language parameter to prevent injection
const LANGUAGE_REGEX = /^(?:auto|[a-z]{2}(?:-[A-Z]{2})?)$/;

function validateLanguage(language: string): void {
  if (!LANGUAGE_REGEX.test(language)) {
    throw new Error(
      `Invalid language code: "${language}". Expected format: two-letter code (e.g., "en", "es"), optional region (e.g., "pt-BR"), or "auto".`
    );
  }
}

export interface TranscribeOptions {
  filePath: string;
  model?: string;
  language?: string;
  outputFormat?: "text" | "timestamps" | "json";
}

export interface TranscribeResult {
  text: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
  duration?: number;
  model: string;
  file: string;
}

async function convertToWav(inputPath: string): Promise<string> {
  const tempDir = os.tmpdir();
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const wavPath = path.join(tempDir, `${baseName}_whisper.wav`);

  // Check if already a 16kHz mono WAV
  if (inputPath.endsWith(".wav")) {
    // Still convert to ensure correct format
  }

  await execFileAsync("ffmpeg", [
    "-i",
    inputPath,
    "-ar",
    "16000",
    "-ac",
    "1",
    "-f",
    "wav",
    wavPath,
    "-y",
  ]);

  return wavPath;
}

function parseTimestampedOutput(
  output: string
): Array<{ start: number; end: number; text: string }> {
  const segments: Array<{ start: number; end: number; text: string }> = [];
  const lines = output.split("\n");

  for (const line of lines) {
    // Match format: [00:00:00.000 --> 00:00:05.000] text
    const match = line.match(
      /\[(\d{2}):(\d{2}):(\d{2}\.\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}\.\d{3})\]\s*(.*)/
    );
    if (match) {
      const startH = parseInt(match[1]);
      const startM = parseInt(match[2]);
      const startS = parseFloat(match[3]);
      const endH = parseInt(match[4]);
      const endM = parseInt(match[5]);
      const endS = parseFloat(match[6]);
      const text = match[7].trim();

      if (text && !text.startsWith("[")) {
        segments.push({
          start: startH * 3600 + startM * 60 + startS,
          end: endH * 3600 + endM * 60 + endS,
          text,
        });
      }
    }
  }

  return segments;
}

export async function transcribeAudio(
  options: TranscribeOptions
): Promise<TranscribeResult> {
  const {
    filePath,
    model = "base.en",
    language = "en",
    outputFormat = "text",
  } = options;

  // Validate file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  // Validate language parameter
  validateLanguage(language);

  // Check if whisper-cli is installed
  try {
    await execFileAsync("which", ["whisper-cli"]);
  } catch {
    throw new Error(
      "whisper-cli not found. Install with: brew install whisper-cpp"
    );
  }

  // Check if model is downloaded
  const modelPath = getModelPath(model);
  if (!isModelDownloaded(model)) {
    throw new Error(
      `Model ${model} not downloaded. Use download_whisper_model tool first, or download manually: curl -L "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin" -o "${modelPath}"`
    );
  }

  // Convert to WAV format for whisper
  let wavPath: string;
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".wav") {
    // Check if it's already 16kHz mono, if not convert
    wavPath = await convertToWav(filePath);
  } else {
    wavPath = await convertToWav(filePath);
  }

  try {
    // whisper-cli outputs to stdout with timestamps by default
    const { stdout, stderr } = await execFileAsync(
      "whisper-cli",
      ["-m", modelPath, "-f", wavPath, "-l", language],
      { maxBuffer: 50 * 1024 * 1024 } // 50MB buffer for long transcriptions
    );

    const fullOutput = stdout + stderr;

    // Parse the output based on format
    let text = "";
    let segments: Array<{ start: number; end: number; text: string }> = [];

    // Parse timestamped output
    segments = parseTimestampedOutput(fullOutput);

    // Extract plain text
    text = segments
      .map((s) => s.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    // If no segments parsed, use raw output
    if (!text && fullOutput) {
      text = fullOutput
        .split("\n")
        .filter((line) => !line.startsWith("[") && !line.includes("whisper"))
        .join(" ")
        .trim();
    }

    const result: TranscribeResult = {
      text,
      model,
      file: filePath,
    };

    if (outputFormat === "timestamps" || outputFormat === "json") {
      result.segments = segments;
    }

    // Clean up temp wav file
    if (wavPath !== filePath && fs.existsSync(wavPath)) {
      fs.unlinkSync(wavPath);
    }

    return result;
  } catch (error) {
    // Clean up temp wav file on error
    if (wavPath !== filePath && fs.existsSync(wavPath)) {
      fs.unlinkSync(wavPath);
    }
    throw error;
  }
}
