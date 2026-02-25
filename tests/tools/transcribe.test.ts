import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";

// Mock dependencies
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock("os", () => ({
  tmpdir: vi.fn(() => "/tmp"),
  homedir: vi.fn(() => "/Users/testuser"),
}));

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("util", () => ({
  promisify: vi.fn((fn) => {
    // execFile callback signature: (err, stdout, stderr)
    // promisify should return { stdout, stderr }
    return async (...args: unknown[]) => {
      return new Promise((resolve, reject) => {
        fn(...args, (err: Error | null, stdout: string, stderr: string) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        });
      });
    };
  }),
}));

vi.mock("../../src/tools/models.js", () => ({
  getModelPath: vi.fn(() => "/Users/testuser/.whisper/ggml-base.en.bin"),
  isModelDownloaded: vi.fn(() => true),
}));

import { execFile } from "child_process";
import { getModelPath, isModelDownloaded } from "../../src/tools/models.js";

const mockedExistsSync = vi.mocked(fs.existsSync);
const mockedUnlinkSync = vi.mocked(fs.unlinkSync);
const mockedExecFile = vi.mocked(execFile);
const mockedIsModelDownloaded = vi.mocked(isModelDownloaded);

describe("transcribe utility", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockedExistsSync.mockReturnValue(true);
    mockedIsModelDownloaded.mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("transcribeAudio", () => {
    it("should throw error if file not found", async () => {
      mockedExistsSync.mockImplementation((path) => {
        if (typeof path === "string" && path === "/path/to/audio.m4a") {
          return false;
        }
        return true;
      });

      const { transcribeAudio } = await import("../../src/tools/transcribe.js");

      await expect(
        transcribeAudio({ filePath: "/path/to/audio.m4a" })
      ).rejects.toThrow("File not found");
    });

    it("should throw error if whisper-cli not installed", async () => {
      mockedExistsSync.mockReturnValue(true);

      mockedExecFile.mockImplementation((cmd, cmdArgs, ...rest) => {
        // Find the callback - it can be in different positions
        const callback = [cmdArgs, ...rest].find(a => typeof a === "function") as Function | undefined;
        if (typeof cmd === "string" && cmd === "which") {
          if (callback) {
            callback(new Error("not found"), "", "");
          }
        }
        return {} as never;
      });

      const { transcribeAudio } = await import("../../src/tools/transcribe.js");

      await expect(
        transcribeAudio({ filePath: "/path/to/audio.m4a" })
      ).rejects.toThrow("whisper-cli not found");
    });

    it("should throw error if model not downloaded", async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedIsModelDownloaded.mockReturnValue(false);

      mockedExecFile.mockImplementation((cmd, cmdArgs, ...rest) => {
        const callback = [cmdArgs, ...rest].find(a => typeof a === "function") as Function | undefined;
        if (typeof cmd === "string" && cmd === "which") {
          if (callback) {
            callback(null, "/usr/local/bin/whisper-cli", "");
          }
        }
        return {} as never;
      });

      const { transcribeAudio } = await import("../../src/tools/transcribe.js");

      await expect(
        transcribeAudio({ filePath: "/path/to/audio.m4a" })
      ).rejects.toThrow("Model base.en not downloaded");
    });

    it("should convert audio and transcribe", async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedIsModelDownloaded.mockReturnValue(true);

      const whisperOutput = `[00:00:00.000 --> 00:00:05.000] Hello world
[00:00:05.000 --> 00:00:10.000] This is a test`;

      mockedExecFile.mockImplementation((cmd, cmdArgs, ...rest) => {
        const callback = [cmdArgs, ...rest].find(a => typeof a === "function") as Function | undefined;
        if (typeof cmd === "string") {
          if (cmd === "which") {
            if (callback) callback(null, "/usr/local/bin/whisper-cli", "");
          } else if (cmd === "ffmpeg") {
            if (callback) callback(null, "", "");
          } else if (cmd === "whisper-cli") {
            if (callback) callback(null, whisperOutput, "");
          }
        }
        return {} as never;
      });

      const { transcribeAudio } = await import("../../src/tools/transcribe.js");
      const result = await transcribeAudio({ filePath: "/path/to/audio.m4a" });

      expect(result.text).toBe("Hello world This is a test");
      expect(result.model).toBe("base.en");
      expect(result.file).toBe("/path/to/audio.m4a");
    });

    it("should include segments for timestamps format", async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedIsModelDownloaded.mockReturnValue(true);

      const whisperOutput = `[00:00:00.000 --> 00:00:05.000] Hello world`;

      mockedExecFile.mockImplementation((cmd, cmdArgs, ...rest) => {
        const callback = [cmdArgs, ...rest].find(a => typeof a === "function") as Function | undefined;
        if (typeof cmd === "string" && callback) {
          if (cmd === "which") {
            callback(null, "/usr/local/bin/whisper-cli", "");
          } else {
            callback(null, whisperOutput, "");
          }
        }
        return {} as never;
      });

      const { transcribeAudio } = await import("../../src/tools/transcribe.js");
      const result = await transcribeAudio({
        filePath: "/path/to/audio.m4a",
        outputFormat: "timestamps",
      });

      expect(result.segments).toBeDefined();
      expect(result.segments).toHaveLength(1);
      expect(result.segments![0].text).toBe("Hello world");
      expect(result.segments![0].start).toBe(0);
      expect(result.segments![0].end).toBe(5);
    });

    it("should include segments for json format", async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedIsModelDownloaded.mockReturnValue(true);

      const whisperOutput = `[00:00:00.000 --> 00:00:05.000] Test`;

      mockedExecFile.mockImplementation((cmd, cmdArgs, ...rest) => {
        const callback = [cmdArgs, ...rest].find(a => typeof a === "function") as Function | undefined;
        if (typeof cmd === "string" && callback) {
          if (cmd === "which") {
            callback(null, "/bin/whisper-cli", "");
          } else {
            callback(null, whisperOutput, "");
          }
        }
        return {} as never;
      });

      const { transcribeAudio } = await import("../../src/tools/transcribe.js");
      const result = await transcribeAudio({
        filePath: "/path/to/audio.m4a",
        outputFormat: "json",
      });

      expect(result.segments).toBeDefined();
    });

    it("should clean up temp wav file after success", async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedIsModelDownloaded.mockReturnValue(true);

      mockedExecFile.mockImplementation((cmd, cmdArgs, ...rest) => {
        const callback = [cmdArgs, ...rest].find(a => typeof a === "function") as Function | undefined;
        if (typeof cmd === "string" && callback) {
          if (cmd === "which") {
            callback(null, "/bin/whisper-cli", "");
          } else {
            callback(null, "[00:00:00.000 --> 00:00:01.000] test", "");
          }
        }
        return {} as never;
      });

      const { transcribeAudio } = await import("../../src/tools/transcribe.js");
      await transcribeAudio({ filePath: "/path/to/audio.m4a" });

      expect(mockedUnlinkSync).toHaveBeenCalled();
    });

    it("should clean up temp wav file on error", async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedIsModelDownloaded.mockReturnValue(true);

      mockedExecFile.mockImplementation((cmd, cmdArgs, ...rest) => {
        const callback = [cmdArgs, ...rest].find(a => typeof a === "function") as Function | undefined;
        if (typeof cmd === "string" && callback) {
          if (cmd === "which") {
            callback(null, "/bin/whisper-cli", "");
          } else if (cmd === "ffmpeg") {
            callback(null, "", "");
          } else if (cmd === "whisper-cli") {
            callback(new Error("Transcription failed"), "", "");
          }
        }
        return {} as never;
      });

      const { transcribeAudio } = await import("../../src/tools/transcribe.js");

      await expect(
        transcribeAudio({ filePath: "/path/to/audio.m4a" })
      ).rejects.toThrow();

      expect(mockedUnlinkSync).toHaveBeenCalled();
    });

    it("should use custom model", async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedIsModelDownloaded.mockReturnValue(true);

      mockedExecFile.mockImplementation((cmd, cmdArgs, ...rest) => {
        const callback = [cmdArgs, ...rest].find(a => typeof a === "function") as Function | undefined;
        if (typeof cmd === "string" && callback) {
          if (cmd === "which") {
            callback(null, "/bin/whisper-cli", "");
          } else {
            callback(null, "[00:00:00.000 --> 00:00:01.000] test", "");
          }
        }
        return {} as never;
      });

      const { transcribeAudio } = await import("../../src/tools/transcribe.js");
      const result = await transcribeAudio({
        filePath: "/path/to/audio.m4a",
        model: "medium.en",
      });

      expect(result.model).toBe("medium.en");
    });

    it("should use custom language", async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedIsModelDownloaded.mockReturnValue(true);

      let whisperArgs: string[] = [];
      mockedExecFile.mockImplementation((cmd, cmdArgs, ...rest) => {
        const callback = [cmdArgs, ...rest].find(a => typeof a === "function") as Function | undefined;
        if (typeof cmd === "string") {
          if (cmd === "whisper-cli" && Array.isArray(cmdArgs)) {
            whisperArgs = cmdArgs as string[];
          }
          if (callback) {
            if (cmd === "which") {
              callback(null, "/bin/whisper-cli", "");
            } else {
              callback(null, "[00:00:00.000 --> 00:00:01.000] test", "");
            }
          }
        }
        return {} as never;
      });

      const { transcribeAudio } = await import("../../src/tools/transcribe.js");
      await transcribeAudio({
        filePath: "/path/to/audio.m4a",
        language: "es",
      });

      expect(whisperArgs).toContain("-l");
      expect(whisperArgs).toContain("es");
    });

    it("should reject invalid language codes", async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedIsModelDownloaded.mockReturnValue(true);

      const { transcribeAudio } = await import("../../src/tools/transcribe.js");

      await expect(
        transcribeAudio({
          filePath: "/path/to/audio.m4a",
          language: '; rm -rf /',
        })
      ).rejects.toThrow("Invalid language code");
    });

    it("should accept 'auto' as language", async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedIsModelDownloaded.mockReturnValue(true);

      mockedExecFile.mockImplementation((cmd, cmdArgs, ...rest) => {
        const callback = [cmdArgs, ...rest].find(a => typeof a === "function") as Function | undefined;
        if (typeof cmd === "string" && callback) {
          if (cmd === "which") {
            callback(null, "/bin/whisper-cli", "");
          } else {
            callback(null, "[00:00:00.000 --> 00:00:01.000] test", "");
          }
        }
        return {} as never;
      });

      const { transcribeAudio } = await import("../../src/tools/transcribe.js");

      await expect(
        transcribeAudio({
          filePath: "/path/to/audio.m4a",
          language: "auto",
        })
      ).resolves.toBeDefined();
    });

    it("should handle output with no timestamps", async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedIsModelDownloaded.mockReturnValue(true);

      const whisperOutput = `Plain text output without timestamps
More text here`;

      mockedExecFile.mockImplementation((cmd, cmdArgs, ...rest) => {
        const callback = [cmdArgs, ...rest].find(a => typeof a === "function") as Function | undefined;
        if (typeof cmd === "string" && callback) {
          if (cmd === "which") {
            callback(null, "/bin/whisper-cli", "");
          } else {
            callback(null, whisperOutput, "");
          }
        }
        return {} as never;
      });

      const { transcribeAudio } = await import("../../src/tools/transcribe.js");
      const result = await transcribeAudio({ filePath: "/path/to/audio.m4a" });

      expect(result.text).toContain("Plain text output");
    });

    it("should skip lines starting with [", async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedIsModelDownloaded.mockReturnValue(true);

      const whisperOutput = `[WARN] Some warning
Plain text here`;

      mockedExecFile.mockImplementation((cmd, cmdArgs, ...rest) => {
        const callback = [cmdArgs, ...rest].find(a => typeof a === "function") as Function | undefined;
        if (typeof cmd === "string" && callback) {
          if (cmd === "which") {
            callback(null, "/bin/whisper-cli", "");
          } else {
            callback(null, whisperOutput, "");
          }
        }
        return {} as never;
      });

      const { transcribeAudio } = await import("../../src/tools/transcribe.js");
      const result = await transcribeAudio({ filePath: "/path/to/audio.m4a" });

      expect(result.text).not.toContain("WARN");
    });

    it("should handle hour timestamps", async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedIsModelDownloaded.mockReturnValue(true);

      const whisperOutput = `[01:30:00.000 --> 01:30:05.000] Long recording`;

      mockedExecFile.mockImplementation((cmd, cmdArgs, ...rest) => {
        const callback = [cmdArgs, ...rest].find(a => typeof a === "function") as Function | undefined;
        if (typeof cmd === "string" && callback) {
          if (cmd === "which") {
            callback(null, "/bin/whisper-cli", "");
          } else {
            callback(null, whisperOutput, "");
          }
        }
        return {} as never;
      });

      const { transcribeAudio } = await import("../../src/tools/transcribe.js");
      const result = await transcribeAudio({
        filePath: "/path/to/audio.m4a",
        outputFormat: "timestamps",
      });

      expect(result.segments![0].start).toBe(5400); // 1.5 hours in seconds
    });
  });
});
