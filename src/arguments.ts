/**
 * @module arguments
 * Functionality with respect to handling argument building.
 */

/**
 * Builds the final argument list for a CARTA process, merging user-provided
 * executableArgs over sensible defaults.
 *
 * @param executableArgs User provided list of arguments to run with CARTA.
 * @param port Selected port for CARTA process to launch on.
 * @param folderPath The directory containing data to be served.
 * @returns The resolved, validated absolute path to the binary.
 */
export function buildCartaArgs(
	executableArgs: string[],
	port: number,
	folderPath: string,
	enableScripting: boolean
): string[] {
	const sanitizedExecutableArgs = enableScripting
		? executableArgs
		: executableArgs.filter((arg) => arg !== '--enable_scripting');

	// Defaults that can be overridden by executableArgs
	const defaults = new Map<string, string[]>([
		['--no_browser', []],
		['--host', ['127.0.0.1']],
		['-p', [port.toString()]],
		['--top_level_folder', [folderPath]],
	]);

	if (enableScripting) {
		defaults.set('--enable_scripting', []);
	}

	// Remove any default whose key appears in executableArgs
	for (const arg of sanitizedExecutableArgs) {
		if (defaults.has(arg)) {
			defaults.delete(arg);
		}
	}

	// Flatten remaining defaults, then append user args, then the positional folder
	const args = [
		...Array.from(defaults.entries()).flatMap(([flag, vals]) => [flag, ...vals]),
		...sanitizedExecutableArgs,
		folderPath
	];

	return args;
}