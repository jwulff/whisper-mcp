# Replace shell exec() with execFile() to close command injection

## Why

Issue #2 reported that `transcribe_audio` built shell command strings from
user input. The `language` argument went unquoted into a `whisper-cli`
command run through `exec()`, so any MCP client could run arbitrary shell
commands on the host. `file_path` was double-quoted, which `$(...)` and
backticks still break out of. External contributor @matteofrassi fixed this
in PR #1.

## How

- **Contributor change.** Every subprocess call (`which`, `ffmpeg`,
  `whisper-cli`, `curl`) now uses `execFile()` with an argument array and no
  shell. Nothing user-supplied is ever parsed by a shell.
- **Language validation, widened by the maintainer.** The contributor added a
  regex as defense in depth, but it accepted only two-letter codes. That
  rejected codes whisper.cpp supports, such as `haw` and `yue`, and language
  names such as `english` that worked before. It also advertised a `pt-BR`
  region form that whisper.cpp does not accept. The regex now allows `auto`, a
  2-3 letter code, or a lowercase language name of one or two words. A leading
  `-` can never match, so the value cannot become a `whisper-cli` flag.
- **ffmpeg output, fixed by the maintainer.** The old shell command discarded
  ffmpeg's stderr with `2>/dev/null`. `execFile()` buffers it instead, with a
  1 MiB default cap, so progress output on a long file could kill the
  conversion. ffmpeg now runs with `-hide_banner -nostats -loglevel error`
  and an explicit 10 MiB buffer.
- **Tests that guard the fix.** Codex found that forcing `shell: true` on
  every call still passed all 42 original tests. New tests assert the exact
  executables, argv arrays, and the absence of a `shell` option, and pass a
  filename containing quotes, `$(...)` and backticks through as one argument.
  Injecting `shell: true` now fails the suite.

Two pre-existing hardening items were left out of scope and filed as a
follow-up issue: predictable temp WAV paths in the system temp dir, and
ffmpeg protocol prefixes such as `concat:` in relative file paths.

## Validation

- `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run build`
  all pass. `npm test` passes 55 tests, up from 42.
- Mutation check: adding `shell: true` to the whisper-cli call fails the new
  argv test.
- End-to-end on macOS with Homebrew ffmpeg and whisper-cli: downloaded
  `tiny.en` through `downloadModel`, then transcribed a `say`-generated clip
  named `it's a $(touch PWNED) test.aiff` in a directory with a space. The
  transcript was correct and no `PWNED` file was created. The languages `-h`
  and `en; touch PWNED` were rejected before any subprocess ran.
- Independent review by Codex (read-only): no P0/P1 findings.
