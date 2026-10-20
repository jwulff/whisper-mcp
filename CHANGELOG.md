# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- Fix command injection in `transcribe_audio` and `download_whisper_model`: all subprocesses now run via `execFile()` with argument arrays and no shell, and `language` is validated (#2)

### Added
- Comprehensive test suite with 98%+ coverage
- CONTRIBUTING.md with development guidelines

## [0.1.0] - 2025-01-08

### Added
- Initial release
- MCP server implementation with 3 tools:
  - `transcribe_audio`: Transcribe audio files using Whisper
  - `list_whisper_models`: List available models and their download status
  - `download_whisper_model`: Download models from HuggingFace
- Support for multiple Whisper models:
  - `tiny.en` (75 MB)
  - `base.en` (142 MB) - default
  - `small.en` (466 MB)
  - `medium.en` (1.5 GB)
  - `large` (2.9 GB)
- Multiple output formats: text, timestamps, json
- Automatic audio conversion to 16kHz mono WAV using ffmpeg
- Timestamp parsing from whisper-cli output

### Technical Details
- TypeScript implementation
- MCP SDK integration
- whisper.cpp (whisper-cli) backend
- ESLint and Prettier configuration
- Vitest for testing
- GitHub Actions CI/CD
