# Changelog

All notable changes to this project will be documented here.

## [0.1.0] - 2026-02-25

### Added
- VS Code Webview support as the primary and default viewer mode
- Custom CARTA icon for the webview tab
- "Recent Folders" sidebar view to quickly re-open previously used directories
- `CARTA: Open Recent Folder...` command with searchable history and persistent storage
- `CARTA: Restart Viewer Instance` command and button directly in the sidebar
- Comprehensive unit and integration test suite (Ports, Config, Process Management, Launcher)
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