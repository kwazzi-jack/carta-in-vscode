/**
 * @module types
 * Core type definitions and interfaces for the CARTA VS Code extension.
 */

import { ChildProcess } from 'child_process';

/**
 * Represents an inclusive range of network ports.
 */
export interface PortRange {
	/** Starting port number (inclusive) */
	start: number;
	/** Ending port number (inclusive) */
	end: number;
}

/**
 * Valid states for a CARTA server instance.
 */
export type CartaInstanceStatus = 'starting' | 'running' | 'crashed';

/**
 * Represents a managed CARTA server process and its associated metadata.
 */
export interface CartaInstance {
	/** Unique identifier for the instance */
	id: string;
	/** The underlying Node.js child process */
	process: ChildProcess;
	/** The filesystem path the server is serving data from */
	folderPath: string;
	/** The network port the server is listening on */
	port: number;
	/** The authenticated URL used to access the CARTA web interface */
	url?: string;
	/** Epoch timestamp (ms) of when the instance was initiated */
	startedAt: number;
	/** Current operational status */
	status: CartaInstanceStatus;
}

/**
 * Global configuration settings for the CARTA extension.
 */
export interface CartaConfig {
	/** Path to the 'carta' executable */
	executablePath: string;
	/** Range of ports to scan for available server slots */
	portRange: PortRange;
	/** Max time in ms to wait for server startup before failing */
	startupTimeout: number;
	/** Maximum number of servers allowed to run simultaneously */
	maxConcurrentServers: number;
	/** Preferred surface for displaying the CARTA UI */
	viewerMode: 'simpleBrowser' | 'externalBrowser' | 'webview';
	/** Optional path to a specific browser executable for 'externalBrowser' mode */
	browserExecutablePath?: string;
}
