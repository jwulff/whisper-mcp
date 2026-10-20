import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFile } from "child_process";

// Mock dependencies
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  statSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock("os", () => ({
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

const mockedExistsSync = vi.mocked(fs.existsSync);
const mockedMkdirSync = vi.mocked(fs.mkdirSync);
const mockedStatSync = vi.mocked(fs.statSync);
const mockedUnlinkSync = vi.mocked(fs.unlinkSync);
const mockedExecFile = vi.mocked(execFile);

describe("models utility", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getModelPath", () => {
    it("should return correct path for known model", async () => {
      const { getModelPath } = await import("../../src/tools/models.js");

      const modelPath = getModelPath("base.en");
      expect(modelPath).toBe("/Users/testuser/.whisper/ggml-base.en.bin");
    });

    it("should throw error for unknown model", async () => {
      const { getModelPath } = await import("../../src/tools/models.js");

      expect(() => getModelPath("unknown")).toThrow("Unknown model: unknown");
    });

    it("should list available models in error message", async () => {
      const { getModelPath } = await import("../../src/tools/models.js");

      expect(() => getModelPath("unknown")).toThrow("tiny.en");
      expect(() => getModelPath("unknown")).toThrow("base.en");
    });
  });

  describe("isModelDownloaded", () => {
    it("should return true when model file exists", async () => {
      mockedExistsSync.mockReturnValue(true);

      const { isModelDownloaded } = await import("../../src/tools/models.js");
      const result = isModelDownloaded("base.en");

      expect(result).toBe(true);
    });

    it("should return false when model file does not exist", async () => {
      mockedExistsSync.mockReturnValue(false);

      const { isModelDownloaded } = await import("../../src/tools/models.js");
      const result = isModelDownloaded("base.en");

      expect(result).toBe(false);
    });

    it("should return false for unknown model", async () => {
      const { isModelDownloaded } = await import("../../src/tools/models.js");
      const result = isModelDownloaded("unknown");

      expect(result).toBe(false);
    });
  });

  describe("listModels", () => {
    it("should create whisper directory if it doesn't exist", async () => {
      mockedExistsSync.mockReturnValue(false);

      const { listModels } = await import("../../src/tools/models.js");
      await listModels();

      expect(mockedMkdirSync).toHaveBeenCalledWith(
        "/Users/testuser/.whisper",
        { recursive: true }
      );
    });

    it("should return list of all models", async () => {
      mockedExistsSync.mockReturnValue(false);

      const { listModels } = await import("../../src/tools/models.js");
      const result = await listModels();

      expect(result.models).toHaveLength(5);
      expect(result.whisperDir).toBe("/Users/testuser/.whisper");
    });

    it("should include model info for each model", async () => {
      mockedExistsSync.mockReturnValue(false);

      const { listModels } = await import("../../src/tools/models.js");
      const result = await listModels();

      const baseEn = result.models.find((m) => m.name === "base.en");
      expect(baseEn).toBeDefined();
      expect(baseEn?.size).toBe("142 MB");
      expect(baseEn?.downloaded).toBe(false);
      expect(baseEn?.path).toBe("/Users/testuser/.whisper/ggml-base.en.bin");
      expect(baseEn?.downloadUrl).toContain("huggingface.co");
    });

    it("should mark models as downloaded when file exists", async () => {
      mockedExistsSync.mockImplementation((path) => {
        if (typeof path === "string" && path.includes("ggml-base.en.bin")) {
          return true;
        }
        return false;
      });

      const { listModels } = await import("../../src/tools/models.js");
      const result = await listModels();

      const baseEn = result.models.find((m) => m.name === "base.en");
      expect(baseEn?.downloaded).toBe(true);
    });
  });

  describe("downloadModel", () => {
    it("should throw error for unknown model", async () => {
      const { downloadModel } = await import("../../src/tools/models.js");

      await expect(downloadModel("unknown")).rejects.toThrow(
        "Unknown model: unknown"
      );
    });

    it("should create whisper directory if it doesn't exist", async () => {
      mockedExistsSync.mockReturnValue(false);
      mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        if (typeof callback === "function") {
          callback(null, "" as never, "" as never);
        } else if (typeof _opts === "function") {
          _opts(null, "" as never, "" as never);
        }
        return {} as never;
      });
      mockedStatSync.mockReturnValue({ size: 100000000 } as never);

      const { downloadModel } = await import("../../src/tools/models.js");

      try {
        await downloadModel("base.en");
      } catch {
        // Expected to fail due to mock
      }

      expect(mockedMkdirSync).toHaveBeenCalled();
    });

    it("should return success message if model already downloaded", async () => {
      mockedExistsSync.mockReturnValue(true);

      const { downloadModel } = await import("../../src/tools/models.js");
      const result = await downloadModel("base.en");

      expect(result.success).toBe(true);
      expect(result.message).toContain("already downloaded");
    });

    it("should download model using curl", async () => {
      mockedExistsSync.mockImplementation((path) => {
        // First call: check if already downloaded - false
        // Second call after download: check if file exists - true
        if (typeof path === "string" && path.includes("ggml-base.en.bin")) {
          return mockedExecFile.mock.calls.length > 0;
        }
        return false;
      });

      mockedExecFile.mockImplementation((cmd, _args, _opts, callback) => {
        if (typeof callback === "function") {
          callback(null, "" as never, "" as never);
        } else if (typeof _opts === "function") {
          _opts(null, "" as never, "" as never);
        }
        return {} as never;
      });

      mockedStatSync.mockReturnValue({ size: 100000000 } as never);

      const { downloadModel } = await import("../../src/tools/models.js");
      const result = await downloadModel("base.en");

      expect(result.success).toBe(true);
      expect(result.message).toContain("Successfully downloaded");

      // curl is invoked with an argv array and no shell
      const [cmd, args, opts] = mockedExecFile.mock.calls[0];
      expect(cmd).toBe("curl");
      expect(args).toEqual([
        "-L",
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
        "-o",
        expect.stringMatching(/ggml-base\.en\.bin$/),
      ]);
      expect((opts as { shell?: unknown }).shell).toBeFalsy();
    });

    it("should delete file if download is too small", async () => {
      mockedExistsSync.mockImplementation((path) => {
        if (typeof path === "string" && path.includes("ggml-base.en.bin")) {
          return mockedExecFile.mock.calls.length > 0;
        }
        return false;
      });

      mockedExecFile.mockImplementation((cmd, _args, _opts, callback) => {
        if (typeof callback === "function") {
          callback(null, "" as never, "" as never);
        } else if (typeof _opts === "function") {
          _opts(null, "" as never, "" as never);
        }
        return {} as never;
      });

      mockedStatSync.mockReturnValue({ size: 1000 } as never); // Too small

      const { downloadModel } = await import("../../src/tools/models.js");

      await expect(downloadModel("base.en")).rejects.toThrow("too small");
      expect(mockedUnlinkSync).toHaveBeenCalled();
    });

    it("should throw error if download fails", async () => {
      mockedExistsSync.mockReturnValue(false);

      mockedExecFile.mockImplementation((cmd, _args, _opts, callback) => {
        if (typeof callback === "function") {
          callback(new Error("Network error"), null as never, null as never);
        } else if (typeof _opts === "function") {
          _opts(new Error("Network error"), null as never, null as never);
        }
        return {} as never;
      });

      const { downloadModel } = await import("../../src/tools/models.js");

      await expect(downloadModel("base.en")).rejects.toThrow(
        "Failed to download model"
      );
    });

    it("should throw error if file not found after download", async () => {
      mockedExistsSync.mockReturnValue(false);

      mockedExecFile.mockImplementation((cmd, _args, _opts, callback) => {
        if (typeof callback === "function") {
          callback(null, "" as never, "" as never);
        } else if (typeof _opts === "function") {
          _opts(null, "" as never, "" as never);
        }
        return {} as never;
      });

      const { downloadModel } = await import("../../src/tools/models.js");

      await expect(downloadModel("base.en")).rejects.toThrow(
        "file not found"
      );
    });
  });
});
