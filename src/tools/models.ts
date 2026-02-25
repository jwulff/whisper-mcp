import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const execFileAsync = promisify(execFile);

export interface ModelInfo {
  name: string;
  size: string;
  downloaded: boolean;
  path: string;
  downloadUrl: string;
}

const MODELS: Record<string, { size: string; file: string }> = {
  "tiny.en": { size: "75 MB", file: "ggml-tiny.en.bin" },
  "base.en": { size: "142 MB", file: "ggml-base.en.bin" },
  "small.en": { size: "466 MB", file: "ggml-small.en.bin" },
  "medium.en": { size: "1.5 GB", file: "ggml-medium.en.bin" },
  large: { size: "2.9 GB", file: "ggml-large-v3.bin" },
};

const WHISPER_DIR = path.join(os.homedir(), ".whisper");
const HUGGINGFACE_BASE =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

export function getModelPath(model: string): string {
  const modelInfo = MODELS[model];
  if (!modelInfo) {
    throw new Error(
      `Unknown model: ${model}. Available: ${Object.keys(MODELS).join(", ")}`
    );
  }
  return path.join(WHISPER_DIR, modelInfo.file);
}

export function isModelDownloaded(model: string): boolean {
  try {
    const modelPath = getModelPath(model);
    return fs.existsSync(modelPath);
  } catch {
    return false;
  }
}

export async function listModels(): Promise<{
  models: ModelInfo[];
  whisperDir: string;
}> {
  // Ensure whisper directory exists
  if (!fs.existsSync(WHISPER_DIR)) {
    fs.mkdirSync(WHISPER_DIR, { recursive: true });
  }

  const models: ModelInfo[] = [];

  for (const [name, info] of Object.entries(MODELS)) {
    const modelPath = path.join(WHISPER_DIR, info.file);
    const downloaded = fs.existsSync(modelPath);

    models.push({
      name,
      size: info.size,
      downloaded,
      path: modelPath,
      downloadUrl: `${HUGGINGFACE_BASE}/${info.file}`,
    });
  }

  return { models, whisperDir: WHISPER_DIR };
}

export async function downloadModel(
  model: string
): Promise<{ success: boolean; model: string; path: string; message: string }> {
  const modelInfo = MODELS[model];
  if (!modelInfo) {
    throw new Error(
      `Unknown model: ${model}. Available: ${Object.keys(MODELS).join(", ")}`
    );
  }

  // Ensure whisper directory exists
  if (!fs.existsSync(WHISPER_DIR)) {
    fs.mkdirSync(WHISPER_DIR, { recursive: true });
  }

  const modelPath = path.join(WHISPER_DIR, modelInfo.file);
  const downloadUrl = `${HUGGINGFACE_BASE}/${modelInfo.file}`;

  // Check if already downloaded
  if (fs.existsSync(modelPath)) {
    return {
      success: true,
      model,
      path: modelPath,
      message: `Model ${model} is already downloaded`,
    };
  }

  // Download using curl with safe argument passing
  try {
    console.error(`Downloading ${model} (${modelInfo.size})...`);
    await execFileAsync("curl", ["-L", downloadUrl, "-o", modelPath], {
      maxBuffer: 10 * 1024 * 1024,
    });

    // Verify download
    if (!fs.existsSync(modelPath)) {
      throw new Error("Download completed but file not found");
    }

    const stats = fs.statSync(modelPath);
    if (stats.size < 1000000) {
      // Less than 1MB probably means error
      fs.unlinkSync(modelPath);
      throw new Error("Downloaded file is too small, likely an error occurred");
    }

    return {
      success: true,
      model,
      path: modelPath,
      message: `Successfully downloaded ${model} (${modelInfo.size})`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to download model ${model}: ${message}`);
  }
}
