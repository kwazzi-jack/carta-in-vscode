/**
 * @module validation
 * Provides logic for sanitizing and validating executable paths for CARTA and browsers.
 */

import { access, constants, stat } from 'fs/promises';
import * as path from 'path';

/** Supported categories of executables for validation. */
export type ExecutableType = 'browser' | 'carta';

/** Options for the executable validation process. */
export interface ValidationOptions {
	/** Whether the executable is intended to be a CARTA server or a web browser. */
	type: ExecutableType;
}

/**
 * Validates an executable path to ensure it exists and is executable.
 * 
 * This function performs the following checks:
 * 1. Resolves the path to an absolute path.
 * 2. If on macOS and the path is a .app bundle, it finds the internal binary.
 * 3. Verifies the file exists and is not a directory.
 * 4. Verifies the file has execution permissions.
 * 5. Performs basic heuristic checks on the filename to catch obvious misconfigurations (e.g., using 'bash' instead of 'carta').
 * 
 * @param execPath The raw path string from configuration.
 * @param options Validation options including the executable type.
 * @returns The resolved, validated absolute path to the binary.
 * @throws Error if the path is invalid, missing, or not executable.
 */
export async function validateExecutablePath(
	execPath: string,
	options: ValidationOptions
): Promise<string> {
	// 1. Resolve to absolute path
	const absolutePath = path.resolve(execPath);

	// 2. Handle macOS .app bundles
	if (process.platform === 'darwin' && absolutePath.endsWith('.app')) {
		return await validateMacOSApp(absolutePath, options.type);
	}

	// 3. Check file exists
	let stats;
	try {
		stats = await stat(absolutePath);
	} catch (error) {
		// If it's just 'carta' or similar, it might be in the PATH.
		if (!path.isAbsolute(execPath) && !execPath.includes(path.sep)) {
			// It might be a command in PATH.
			return execPath;
		}
		throw new Error(`Executable not found: ${absolutePath}`);
	}

	if (!stats.isFile() && !stats.isSymbolicLink()) {
		throw new Error(`Path is not a file: ${absolutePath}`);
	}

	// 4. Check executable permission
	try {
		await access(absolutePath, constants.X_OK);
	} catch {
		throw new Error(`File is not executable: ${absolutePath}`);
	}

	// 5. Validate based on type
	validateExecutableType(absolutePath, options.type);

	return absolutePath;
}

/**
 * Specifically handles macOS .app bundles by locating the primary executable within the bundle structure.
 * 
 * @param appPath Path to the .app directory.
 * @param type The expected executable type.
 * @returns Path to the inner binary.
 */
async function validateMacOSApp(
	appPath: string,
	type: ExecutableType
): Promise<string> {
	// Check if .app bundle exists
	try {
		const stats = await stat(appPath);
		if (!stats.isDirectory()) {
			throw new Error(`Invalid macOS app bundle: ${appPath}`);
		}
	} catch {
		throw new Error(`App bundle not found: ${appPath}`);
	}

	// Common macOS browser app names
	const browserApps = ['Google Chrome', 'Firefox', 'Safari', 'Brave Browser', 'Microsoft Edge'];
	const appName = path.basename(appPath, '.app');

	if (type === 'browser') {
		if (!browserApps.some(name => appName.includes(name))) {
			console.warn(`Warning: Unusual browser app name: ${appName}`);
		}
	} else if (type === 'carta') {
		if (!appName.toLowerCase().includes('carta')) {
			console.warn(`Warning: App name doesn't contain 'carta': ${appName}`);
		}
	}

	// Return the path to the actual executable inside the bundle
	const executablePath = path.join(appPath, 'Contents', 'MacOS', appName);

	try {
		await access(executablePath, constants.X_OK);
		return executablePath;
	} catch {
		throw new Error(`Executable not found in app bundle: ${executablePath}`);
	}
}

/**
 * Performs heuristic checks on the filename to warn about potentially incorrect binaries.
 * 
 * @param execPath Validated path to the binary.
 * @param type The expected executable type.
 */
function validateExecutableType(execPath: string, type: ExecutableType): void {
	const fileName = path.basename(execPath).toLowerCase();

	if (type === 'browser') {
		const browserNames = ['chrome', 'firefox', 'chromium', 'brave', 'safari', 'edge', 'opera'];
		if (!browserNames.some(name => fileName.includes(name))) {
			// If it's a known non-browser common tool, we can be stricter, 
			// but for now let's just warn as requested unless it's obviously wrong.
			console.warn(`Warning: Unusual browser executable name: ${fileName}`);
		}
	} else if (type === 'carta') {
		const isCommonShell = ['bash', 'sh', 'zsh', 'cmd', 'powershell', 'pwsh', 'python', 'perl', 'node'].includes(fileName);
		if (isCommonShell) {
			throw new Error(`The specified executable '${fileName}' appears to be a system shell or interpreter, not the CARTA binary.`);
		}
		
		if (!fileName.includes('carta')) {
			console.warn(`Warning: Unusual CARTA executable name: ${fileName}`);
		}
	}
}
