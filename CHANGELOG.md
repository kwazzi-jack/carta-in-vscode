# Changelog

All notable changes to this project will be documented here.

## [0.1.4] - 2026-03-23

### Added
- **Environment Variables**: New `environmentVariables` setting to pass custom environment variables when launching a CARTA instance.
- **Argument Builder**: Dedicated argument-building module that merges user-provided `executableArgs` over sensible defaults, allowing overrides of flags like `--host` and `-p`.
- **Release Tooling**: Added a VS Code task and interactive release script (`scripts/release.sh`) to automate version bumps, changelog checks, tagging, GitHub releases, and marketplace publishing.

### Fixed
- **AppImage Recognition**: Improved executable validation to better recognise AppImage binaries.
- **`.gitignore`**: Added patterns for AppImage files and related archives.

## [0.1.3] - 2026-02-27

### Added
- **Remote SSH Support**: Full compatibility with VS Code Remote - SSH, including automatic port forwarding and external URI resolution.
- **Enhanced Logging**: Integrated a dedicated logging module for better troubleshooting and visibility into the extension's internal state.

### Fixed
- **UI Icons**: Updated `$(add-small)` icons to `$(add)` for better rendering across different VS Code versions.
- **Process Lifecycle**: Improved process termination by using process groups (detached mode) to ensure all child processes are correctly killed.
- **Port Detection**: Switched to `localhost` for port availability checks to improve compatibility in varied network environments.
- **CARTA URL Parsing**: Robust detection and extraction of base URLs and authentication tokens from server output.

## [0.1.2] - 2026-02-26

### Added
- **Executable Path Validation**: Robust sanitisation and validation of executable paths for both CARTA and browsers.
- **Command-Line Arguments**: New `executableArgs` and `browserExecutableArgs` settings to pass custom flags to processes (e.g., `--log_performance`).
- **CARTA Servers Output Channel**: A dedicated live log stream in VS Code for monitoring server stdout/stderr.
- **ANSI Escape Stripping**: Automatic removal of raw ANSI colour codes from logs for better readability in the Output panel.
- **macOS App Bundle Support**: Direct support for selecting `.app` bundles as executable paths.
- **Improved UX for Missing Binaries**: New error prompts with direct links to the CARTA download page and extension settings.
- **Shell Protection**: Heuristic checks to prevent system shells (like `bash` or `zsh`) from being mistakenly configured as the CARTA executable.

### Fixed
- **Startup Leak**: Resolved an issue where failed startup attempts would leave "ghost" or "crashed" instances in the sidebar.
- **Retry Storms**: Capped automatic port retries and improved error analysis to stop immediately on configuration failures.
- **Documentation**: Overhauled `README.md` with more detailed information.
- **Package Optimisation**: Updated `.vscodeignore` to exclude compiled test files from the final extension package.

### Security
- Integrated pre-spawn validation to ensure only valid, executable files are launched by the extension.

## [0.1.1] - 2026-02-25

### Fixed
- Corrected `.vscodeignore` to exclude local AppImage assets from the published package

## [0.1.0] - 2026-02-25

### Added
- VS Code Webview support as the primary and default viewer mode
- Custom CARTA icon for the webview tab
- "Recent Folders" sidebar view to quickly re-open previously used directories
- `CARTA: Open Recent Folder...` command with searchable history and persistent storage
- `CARTA: Restart Viewer Instance` command and button directly in the sidebar
- Detection and robust handling of externally killed/crashed server processes
- Visual status indicators (warning icons) and informative popups for dead server instances
- Official CARTA AppImage integration tests for Linux (with FUSE detection)
- Comprehensive unit and integration test suite (Ports, Config, Process Management, Launcher, Crashes)
- Automated CARTA installation in CI for Ubuntu and macOS
- Detailed JSDoc documentation across the codebase

### Fixed
- Updated CARTA startup logic to use `--top_level_folder` for better compatibility
- Improved type safety and resolved various ESLint problems
- Prevented redundant webview reloads when focusing the tab

### Removed
- Direct Windows support (now explicitly recommending WSL for better compatibility)

## [0.0.3] - 2026-02-22

### Fixed
- `README.md` badges to render properly
- Update GitHub Actions workflow to fix depraction of `ubuntu-20.04`

### Added
- Better `README.md` for installation information and preview screenshots

## [0.0.2] - 2026-02-22

### Fixed
- Lowered minimum VS Code engine requirement from `1.109.0` to `1.85.0` to support older installations

### Added
- VS Code versioning tests for CI
- Added GitHub Actions workflow for a variety of Ubuntu, and then macOS and Windows latest editions
- Added new icon at `images/carta-for-vscode-icon.png`

## [0.0.1] - 2026-02-21

### Added
- Initial release
- `CARTA: Open Viewer` command to launch CARTA in a VS Code tab
- `CARTA: Stop Server` command to stop the running CARTA server
- Automatic folder detection from workspace
- Folder picker fallback if no workspace is open