# Carta in VS Code

<p align="center">
  <img src="images/carta-for-vscode-icon.png" alt="Carta in VS Code" width="128"/>
</p>

[![CI](https://github.com/kwazzi-jack/carta-in-vscode/actions/workflows/ci.yaml/badge.svg)](https://github.com/kwazzi-jack/carta-in-vscode/actions/workflows/ci.yaml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/kwazzi-jack.carta-in-vscode?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=kwazzi-jack.carta-in-vscode)

Run and view [CARTA](https://cartavis.org/) (Cube Analysis and Rendering Tool for Astronomy) as a seamless tab within VS Code. This extension manages the lifecycle of CARTA server processes, allowing you to visualise your astronomical data without leaving your favourite code editor.

## Features

- **Integrated Viewer:** Open CARTA as a VS Code Webview, Simple Browser, or in your external browser of choice.
- **Remote SSH Support:** Run CARTA on remote machines via VS Code Remote SSH with automatic port forwarding.
- **Multiple Instances:** Run and manage multiple CARTA servers simultaneously on different ports.
- **Lifecycle Management:** Automatic port selection, process monitoring, and easy stopping/restarting of instances.
- **Sidebar Integration:** A dedicated Sidebar view to track running viewers and quickly reopen recent folders.
- **Output Logging:** View real-time logs from your CARTA servers in a dedicated VS Code Output Channel.
- **Path Sanitisation:** Robust validation of executable paths to ensure system security and stability.
- **carta-python Integration:** Copy ready-to-use `Session.interact` snippets to connect a Python script to any running CARTA instance.

## Requirements

- **CARTA:** Must be installed on your system. Get it at: [https://cartavis.org/](https://cartavis.org/)
- **Operating System:** Linux (Ubuntu/Debian recommended) or macOS.
- **Remote Development:** Fully supports [VS Code Remote - SSH](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh), allowing you to run CARTA on a remote server and view it locally.
- **Windows Users:** Direct execution on Windows is not supported. Please use [VS Code Remote - WSL](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-wsl) to run the extension within a Linux environment.

## Installing CARTA

CARTA must be installed on your system before using this extension. Below are the main installation methods - for full details, see the [official CARTA documentation](https://cartavis.org/).

### Package Managers

| Platform | Method   | Command                                                                     |
| :------- | :------- | :-------------------------------------------------------------------------- |
| Ubuntu   | PPA      | `sudo add-apt-repository ppa:cartavis-team/carta && sudo apt install carta` |
| Fedora   | Copr     | `sudo dnf copr enable cartavis/carta && sudo dnf install carta`             |
| macOS    | Homebrew | `brew install cartavis/tap/carta`                                           |

### Other Methods

- **macOS DMG:** Download from [cartavis.org](https://cartavis.org/) and drag CARTA to your Applications folder.
- **Linux AppImage:** A portable option that requires no installation - see [Using a CARTA AppImage](#using-a-carta-appimage) below.
- **Docker:** Official Docker images are available for containerised environments. See the [CARTA GitHub](https://github.com/CARTAvis/carta) for details.

### Verifying Your Installation

To check if CARTA is available on your system (useful when working on remote machines via SSH):

```bash
# Check if carta is in your PATH
which carta
```

If this prints a path (e.g. `/usr/bin/carta`), CARTA is installed and ready to use. If it returns nothing, CARTA is either not installed or not in your `PATH`.

For AppImage or non-standard install locations, verify the binary exists and is executable:

```bash
# Check the binary directly
ls -l /path/to/your/CARTA.AppImage # Example AppImage
```

If CARTA is installed but not in your `PATH`, set the full path in the extension's `executablePath` setting.

### Supported Platforms

- Ubuntu 22.04 / 24.04
- RHEL 8 / 9 (and compatible distributions)
- macOS 14 / 15 (Intel and Apple Silicon)

## Installation

### Visual Studio Marketplace

Search for `Carta in VS Code` in the VS Code Extensions view or visit the [Marketplace page](https://marketplace.visualstudio.com/items?itemName=kwazzi-jack.carta-in-vscode).

### Command Line

```bash
code --install-extension kwazzi-jack.carta-in-vscode
```

## Configuration

Customise the extension behaviour via VS Code Settings (`Ctrl+,`) or go to `File -> Preferences -> Settings`.

> [!TIP]
> Search for `@ext:kwazzi-jack.carta-in-vscode` in the Settings search bar to quickly find all extension settings. When editing `settings.json` directly, each setting uses the `carta-in-vscode.` prefix (e.g. `carta-in-vscode.executablePath`).

### Settings

All settings use the `carta-in-vscode.` prefix in `settings.json`.

| Setting                        | Type       | Default       | Description                                                                                                                                         |
| :----------------------------- | :--------- | :------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| `executablePath`               | `string`   | `""`          | Path to the CARTA binary. Can be a command in your `PATH` or an absolute path. Defaults to `carta` in `PATH`.                                       |
| `executableArgs`               | `string[]` | `[]`          | Additional command-line arguments passed to the CARTA server.                                                                                       |
| `viewerMode`                   | `enum`     | `"webview"`   | Where to display CARTA: `webview`, `simpleBrowser`, or `externalBrowser`.                                                                           |
| `portRange`                    | `string`   | `"3002-3099"` | Range of ports to use for CARTA servers.                                                                                                            |
| `maxConcurrentServers`         | `number`   | `5`           | Maximum number of simultaneous CARTA instances.                                                                                                     |
| `startupTimeout`               | `number`   | `-1`          | Milliseconds to wait for startup before timing out (-1 for no timeout).                                                                             |
| `browserExecutablePath`        | `string`   | `""`          | Optional path to a specific browser binary for `externalBrowser` mode. Defaults to system browser.                                                  |
| `browserExecutableArgs`        | `string[]` | `[]`          | Additional arguments for the external browser.                                                                                                      |
| `environmentVariables`         | `object`   | `{}`          | Environment variables to set when launching CARTA processes (e.g. `{"APPIMAGE_EXTRACT_AND_RUN": "1"}`).                                             |
| `enableScripting`              | `boolean`  | `false`       | Enable CARTA backend scripting mode (`--enable_scripting`). Required for carta-python integration. See [Security Note](#security-note).             |
| `autoCopyPythonSnippetOnStart` | `boolean`  | `true`        | Automatically copy a `Session.interact` snippet to clipboard when launching or restarting an instance. Only applies when `enableScripting` is true. |

### Default Arguments

The extension passes the following default arguments when launching a CARTA process:

| Flag                 | Default Value       | Purpose                                             |
| :------------------- | :------------------ | :-------------------------------------------------- |
| `--no_browser`       | _(none)_            | Prevents CARTA from opening its own browser window. |
| `--host`             | `127.0.0.1`         | Binds the server to localhost.                      |
| `-p`                 | _(selected port)_   | Sets the port from the configured `portRange`.      |
| `--top_level_folder` | _(selected folder)_ | Sets the root data directory.                       |

If you include a matching flag in `executableArgs`, it **overrides** the corresponding default. For example, setting `executableArgs` to `["--host", "0.0.0.0"]` replaces the default `--host 127.0.0.1` binding.

### Configuration Examples

**Performance Logging:**
To enable CARTA performance logs in the output channel:

```json
"carta-in-vscode.executableArgs": ["--log_performance"]
```

**Using a Specific Browser (macOS Example):**

```json
"carta-in-vscode.viewerMode": "externalBrowser",
"carta-in-vscode.browserExecutablePath": "/Applications/Google Chrome.app"
```

**Overriding the Default Host Binding:**

```json
"carta-in-vscode.executableArgs": ["--host", "0.0.0.0"]
```

**AppImage without FUSE:**

```json
"carta-in-vscode.executablePath": "/home/user/carta/CARTA-v4.1.AppImage",
"carta-in-vscode.environmentVariables": {
    "APPIMAGE_EXTRACT_AND_RUN": "1"
}
```

**carta-python Scripting:**

```json
"carta-in-vscode.enableScripting": true,
"carta-in-vscode.autoCopyPythonSnippetOnStart": true
```

## Using a CARTA AppImage

AppImages are portable Linux executables that require no installation. CARTA provides AppImages for both x86_64 and aarch64 architectures.

### Quick Setup

For a quick platform specific setup, go to the directory you wish to place the AppImage and run the following:

```bash
wget https://github.com/CARTAvis/carta/releases/latest/download/carta.AppImage.$(arch).tgz
tar -xzf carta.AppImage.$(arch).tgz
chmod +x carta-$(arch).AppImage
```

### Downloading

- **Stable releases:** Download from [cartavis.org/#download](https://cartavis.org/#download).
- **All versions** (including beta and pre-release): Browse the [CARTA GitHub Releases](https://github.com/CARTAvis/carta/releases/).

AppImage files are distributed as tarballs (e.g. `carta.AppImage.x86_64.tgz`). Extract with:

```bash
tar -xzf carta.AppImage.x86_64.tgz
```

### Setup

1. **Make it executable:**
   ```bash
   chmod +x /path/to/your/carta.AppImage
   ```
2. **Set the path in VS Code:**
   In Settings, set `carta-in-vscode.executablePath` to the absolute path of your AppImage:
   ```json
   "carta-in-vscode.executablePath": "/home/user/carta/carta.AppImage"
   ```

### FUSE Workaround

AppImages normally require FUSE to mount and run. If your system does not have FUSE installed (common on minimal or containerised environments), you can use the `environmentVariables` setting instead of installing FUSE:

```json
"carta-in-vscode.environmentVariables": {
    "APPIMAGE_EXTRACT_AND_RUN": "1"
}
```

This tells the AppImage to extract to a temporary directory and run from there, bypassing the FUSE requirement entirely.

## carta-python Integration

This extension integrates with [carta-python](https://github.com/CARTAvis/carta-python), an official CARTA Python scripting library. When scripting is enabled, you can control a running CARTA instance programmatically from Python - opening images, manipulating the viewer, and reading back data.

### Enabling Scripting

In VS Code Settings, enable the `enableScripting` option:

```json
"carta-in-vscode.enableScripting": true
```

This passes `--enable_scripting` to the CARTA server on launch.

> [!WARNING]
> **Security Note:** Scripting mode opens a WebSocket endpoint that accepts arbitrary actions from any connected client. Only enable this if you understand the risk - do not use it on untrusted networks or shared machines without additional access controls.

### Installing carta-python

When you copy a snippet and carta-python is not found in your active Python environment, the extension will prompt you to install it automatically. You can also install it manually:

```bash
pip install git+https://github.com/CARTAvis/carta-python.git
# or with uv:
uv pip install git+https://github.com/CARTAvis/carta-python.git
```

### Copying a Connection Snippet

Once a CARTA instance is running with scripting enabled, right-click the instance in the **Running Viewers** sidebar and select **Copy carta-python Snippet**. This copies a ready-to-use snippet to your clipboard:

```python
from carta.session import Session

session = Session.interact("http://127.0.0.1:3002/?token=<your-token>", <session-id>)
```

Paste and run this snippet in a Python script or Jupyter notebook to connect to the running viewer.

> [!TIP]
> If `autoCopyPythonSnippetOnStart` is enabled (the default), the snippet is automatically copied to your clipboard each time a new CARTA instance starts - no manual step required.

### Using the Session

With a connected session you can open images, change settings, and query viewer state:

```python
from carta.session import Session

session = Session.interact("http://127.0.0.1:3002/?token=<your-token>", <session-id>)

# Open a FITS image
img = session.open_image("my-data.fits")

# Check the current working directory on the server
print(session.pwd())
```

For the full carta-python API reference, see the [carta-python GitHub repository](https://github.com/CARTAvis/carta-python).

## Command Palette Commands

Press `Ctrl+Shift+P` or go to `View -> Command Palette` to access these commands:

- `CARTA: Open Viewer`: Select a folder and start a new CARTA instance.
- `CARTA: Open Viewer (Workspace Folder)`: Quickly open the current workspace root.
- `CARTA: Open Recent Folder...`: Select from a history of recently opened folders.
- `CARTA: Stop Most Recent Viewer`: Kills the latest server process.
- `CARTA: Stop ALL Viewers`: Shuts down all running CARTA instances.
- `CARTA: Restart Viewer Instance`: (Sidebar only) Re-spawns a specific instance.

The following commands are available via right-click on a running instance in the sidebar:

- **Copy carta-python Snippet**: Copies a `Session.interact` code snippet for use with [carta-python](#carta-python-integration).
- **Copy URL**: Copies the authenticated viewer URL to the clipboard.
- **Copy Token**: Copies the authentication token for the instance.
- **Copy Session ID**: Copies the most recently observed session ID.
- **Open Folder**: Reveals the instance's data folder in the system file manager.
- **Open Log**: Opens the CARTA log file in the editor.

## Technical Notes & Risks

### Executable Validation

The extension performs rigorous sanitisation of all configured paths before execution:

- **Existence Check:** Verifies the file exists and is not a directory.
- **Permission Check:** Ensures the file has execution (`+x`) permissions.
- **Shell Protection:** Explicitly blocks common system shells (like `bash` or `zsh`) from being used as the CARTA binary to prevent accidental script execution loops.
- **macOS Bundle Support:** Automatically resolves `.app` bundles to their internal binaries.

### Potential Risks

- **Port Conflicts:** If your configured `portRange` overlaps with other services, CARTA may fail to bind. The extension will attempt to retry on up to 3 different ports before failing.
- **Resource Usage:** Running multiple CARTA instances can be intensive on system memory and CPU. Monitor your system resources if running many simultaneous viewers.

## Testing

This project includes a comprehensive test suite covering:

- Configuration parsing and validation.
- Port selection and availability checking.
- Process spawning and lifecycle management.
- Path sanitisation and security heuristics.

To run tests locally:

```bash
npm install
npm test
```

## Compatibility

- **VS Code:** `1.85.0` or higher.
- **Tested Platforms:** Ubuntu 22.04+, macOS Sonoma.
- **WSL:** Possible but untested.

## Author

- **Brian Welman** ([@kwazzi-jack](https://github.com/kwazzi-jack))

## Licence

This project is licensed under the MIT Licence - see the [LICENSE](LICENSE) file for details.

## Disclaimer

This is an unofficial extension. The official CARTA maintainers were not involved in its development. Please visit [cartavis.org](https://cartavis.org/) for official CARTA support.
