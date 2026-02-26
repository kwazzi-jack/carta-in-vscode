/**
 * @module cartaManager
 * Core logic for spawning, monitoring, and terminating CARTA server processes.
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as os from 'os';
import * as vscode from 'vscode';
import { listCandidatePorts, pickAvailablePort } from './ports';
import { CartaConfig, CartaInstance } from './types';
import { validateExecutablePath } from './validation';

/**
 * Manages the lifecycle of multiple CARTA server instances.
 * Handles port reservation, process spawning, and state tracking.
 */
export class CartaManager {
	/** Active CARTA instances indexed by their string ID */
	private readonly instances = new Map<string, CartaInstance>();
	/** Set of ports currently held or in use by managed processes */
	private readonly reservedPorts = new Set<number>();
	/** Sequential counter to generate new instance IDs */
	private nextInstanceId = 1;
	/** Internal emitter for state change notifications */
	private readonly onDidChangeEmitter = new EventEmitter();
	/** IDs of instances currently being stopped intentionally */
	private readonly stoppingInstances = new Set<string>();
	/** 
	 * Shared output channel for all CARTA server logs. 
	 * Provides visibility into stdout/stderr of the spawned processes.
	 */
	private readonly outputChannel = vscode.window.createOutputChannel('CARTA Servers');

	/**
	 * Removes ANSI escape sequences from a string to ensure clean output in the VS Code Output Channel.
	 * This prevents [32m and other raw codes from cluttering the logs.
	 * 
	 * @param text The raw text string containing possible ANSI codes.
	 * @returns Cleaned plain text string.
	 */
	private stripAnsi(text: string): string {
		// eslint-disable-next-line no-control-regex
		return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
	}

	/**
	 * Forcefully kills a CARTA server process and its associated port.
	 * @param instance The CartaInstance to terminate.
	 */
	private terminateInstanceProcess(instance: CartaInstance): void {
		this.stoppingInstances.add(instance.id);
		instance.process.kill('SIGKILL');

		// On Linux, we use fuser as a fallback to ensure the port is released quickly.
		if (os.platform() === 'linux') {
			const killer = spawn('fuser', ['-k', `${instance.port}/tcp`], {
				shell: false,
				stdio: 'ignore',
			});
			killer.unref();
		}
	}

	/**
	 * Exposes an event to notify observers of changes to the running instances.
	 * @param listener Function to call when instances start or stop.
	 * @returns An unsubscribe function.
	 */
	readonly onDidChange = (listener: () => void): (() => void) => {
		this.onDidChangeEmitter.on('change', listener);
		return () => this.onDidChangeEmitter.off('change', listener);
	};

	/**
	 * Triggers a change event to update the UI providers.
	 */
	private fireChange(): void {
		this.onDidChangeEmitter.emit('change');
	}

	/**
	 * Returns an array of currently running instances, newest first.
	 */
	getInstances(): CartaInstance[] {
		return [...this.instances.values()].sort((a, b) => b.startedAt - a.startedAt);
	}

	/**
	 * Retrieves a specific instance by its ID.
	 */
	getInstance(instanceId: string): CartaInstance | undefined {
		return this.instances.get(instanceId);
	}

	/**
	 * Initiates a new CARTA server for a given directory.
	 * @param config Extension configuration for paths and timeouts.
	 * @param folderPath The directory containing data to be served.
	 * @param cancellationToken Optional VS Code token to handle user-initiated aborts.
	 * @returns A Promise resolving to the running CartaInstance.
	 */
	async startInstance(config: CartaConfig, folderPath: string, cancellationToken?: { isCancellationRequested: boolean; onCancellationRequested: (listener: () => void) => void }): Promise<CartaInstance> {
		if (this.instances.size >= config.maxConcurrentServers) {
			throw new Error(`Maximum running CARTA servers reached (${config.maxConcurrentServers}).`);
		}

		// 1. Validate the executable path once before trying any ports.
		const validatedPath = await validateExecutablePath(config.executablePath, { type: 'carta' });

		// Find an available port from the configured range.
		const initialPort = await pickAvailablePort(config.portRange, this.reservedPorts);
		if (!initialPort) {
			throw new Error(`No free ports found in range ${config.portRange.start}-${config.portRange.end}.`);
		}

		// List potential ports and try starting the server on them sequentially.
		const candidatePorts = [
			initialPort,
			...listCandidatePorts(config.portRange, this.reservedPorts).filter((port) => port !== initialPort),
		].slice(0, 3); // Limit retries to 3 attempts.

		let lastError: Error | undefined;

		for (const selectedPort of candidatePorts) {
			if (cancellationToken?.isCancellationRequested) {
				throw new Error('Cancelled by user');
			}

			try {
				return await this.startInstanceOnPort(config, validatedPath, folderPath, selectedPort, cancellationToken);
			} catch (error) {
				const startupError = error instanceof Error ? error : new Error('Failed to start CARTA server.');
				lastError = startupError;
				
				if (startupError.message === 'Cancelled by user') {
					throw startupError;
				}

				// Only retry if it looks like a port conflict.
				// Port conflicts usually cause a quick exit with a non-zero code.
				// If the exit code was 0, or if the error is path-related, don't retry.
				const isLikelyPortConflict = startupError.message.includes('closed before startup completed') 
					&& !startupError.message.includes('Exit code: 0');

				if (!isLikelyPortConflict) {
					throw startupError;
				}
			}
		}

		throw lastError ?? new Error('No usable ports available in the configured range.');
	}

	/**
	 * Internal logic to spawn the CARTA executable on a specific port and wait for it to be ready.
	 */
	private async startInstanceOnPort(
		config: CartaConfig,
		validatedPath: string,
		folderPath: string,
		selectedPort: number,
		cancellationToken?: { isCancellationRequested: boolean; onCancellationRequested: (listener: () => void) => void }
	): Promise<CartaInstance> {

		this.reservedPorts.add(selectedPort);

		const instanceId = String(this.nextInstanceId++);
		const process = spawn(validatedPath, [
			...config.executableArgs,
			'--no_browser',
			'--host', 'localhost',
			'-p', selectedPort.toString(),
			'--top_level_folder', folderPath,
			folderPath,
		], { shell: false });

		const instance: CartaInstance = {
			id: instanceId,
			process,
			folderPath,
			port: selectedPort,
			startedAt: Date.now(),
			status: 'starting',
		};

		this.instances.set(instanceId, instance);
		this.fireChange();

		return new Promise<CartaInstance>((resolve, reject) => {
			let resolved = false;

			const cleanupStartingFailure = () => {
				this.instances.delete(instanceId);
				this.reservedPorts.delete(selectedPort);
				this.fireChange();
			};

			const onReady = (url: string) => {
				if (resolved) {
					return;
				}

				resolved = true;
				instance.url = url;
				instance.status = 'running';
				this.fireChange();
				resolve(instance);
			};

			// We monitor stdout/stderr for the CARTA startup message containing the auth token URL.
			const checkIfReady = (output: string) => {
				const match = output.match(/http:\/\/localhost:\d+\/\?token=[\w-]+/);
				if (match) {
					onReady(match[0]);
				}
			};

			const onCancelled = () => {
				if (resolved) {
					return;
				}

				resolved = true;
				this.terminateInstanceProcess(instance);
				cleanupStartingFailure();
				reject(new Error('Cancelled by user'));
			};

			if (cancellationToken?.isCancellationRequested) {
				onCancelled();
				return;
			}

			cancellationToken?.onCancellationRequested(onCancelled);

			this.outputChannel.appendLine(`[Instance #${instanceId}] Spawning: ${validatedPath} ${config.executableArgs.join(' ')}`);

			process.stdout?.on('data', (data: Buffer) => {
				const str = data.toString();
				this.outputChannel.append(`[Instance #${instanceId}] STDOUT: ${this.stripAnsi(str)}`);
				checkIfReady(str);
			});
			process.stderr?.on('data', (data: Buffer) => {
				const str = data.toString();
				this.outputChannel.append(`[Instance #${instanceId}] STDERR: ${this.stripAnsi(str)}`);
				checkIfReady(str);
			});

			process.on('error', (err) => {
				if (resolved) {
					return;
				}

				resolved = true;
				cleanupStartingFailure();
				reject(err);
			});

			process.on('close', (code) => {
				const requested = this.stoppingInstances.has(instanceId);
				if (requested) {
					this.instances.delete(instanceId);
					this.stoppingInstances.delete(instanceId);
					this.reservedPorts.delete(selectedPort);
					this.fireChange();
				} else {
					// Unexpected termination.
					if (!resolved) {
						// If it hasn't reached 'running' state yet, it's a startup failure.
						// We should not keep it in the instances map.
						this.instances.delete(instanceId);
					} else {
						// It was running, but now it's gone.
						instance.status = 'crashed';
					}
					this.reservedPorts.delete(selectedPort);
					this.fireChange();
				}

				if (!resolved) {
					resolved = true;
					reject(new Error(`CARTA process closed before startup completed. (Exit code: ${code})`));
				}
			});

			if (config.startupTimeout > 0) {
				setTimeout(() => {
					if (resolved) {
						return;
					}

					resolved = true;
					this.terminateInstanceProcess(instance);
					cleanupStartingFailure();
					reject(new Error('Timed out waiting for CARTA server startup.'));
				}, config.startupTimeout);
			}
		});
	}

	/**
	 * Kills a managed CARTA server and frees its port.
	 * @returns True if the instance existed and was stopped.
	 */
	stopInstance(instanceId: string): boolean {
		const instance = this.instances.get(instanceId);
		if (!instance) {
			return false;
		}

		if (instance.status === 'crashed') {
			this.instances.delete(instanceId);
			this.fireChange();
			return true;
		}

		this.terminateInstanceProcess(instance);
		this.instances.delete(instanceId);
		this.reservedPorts.delete(instance.port);
		this.stoppingInstances.delete(instanceId);
		this.fireChange();
		return true;
	}

	/**
	 * Restarts a specific CARTA instance on its original port, preserving its ID.
	 * @returns The new CartaInstance state after it finishes booting.
	 */
	async restartInstance(instanceId: string, config: CartaConfig): Promise<CartaInstance> {
		const oldInstance = this.instances.get(instanceId);
		if (!oldInstance) {
			throw new Error(`Instance ${instanceId} not found.`);
		}

		const folderPath = oldInstance.folderPath;
		const port = oldInstance.port;

		// Validate once before attempting to stop/restart
		const validatedPath = await validateExecutablePath(config.executablePath, { type: 'carta' });

		if (oldInstance.status !== 'crashed') {
			this.terminateInstanceProcess(oldInstance);
		}
		this.instances.delete(instanceId);
		this.fireChange();

		// Grace period for the OS to release the port socket.
		await new Promise(resolve => setTimeout(resolve, 200));

		const process = spawn(validatedPath, [
			...config.executableArgs,
			'--no_browser',
			'--host', 'localhost',
			'-p', port.toString(),
			'--top_level_folder', folderPath,
			folderPath,
		], { shell: false });

		const newInstance: CartaInstance = {
			id: instanceId,
			process,
			folderPath,
			port,
			startedAt: Date.now(),
			status: 'starting',
		};

		this.instances.set(instanceId, newInstance);
		this.fireChange();

		this.outputChannel.appendLine(`[Instance #${instanceId}] Restarting: ${validatedPath} ${config.executableArgs.join(' ')}`);

		return new Promise<CartaInstance>((resolve, reject) => {
			let resolved = false;

			process.stdout?.on('data', (data: Buffer) => {
				const str = data.toString();
				this.outputChannel.append(`[Instance #${instanceId}] STDOUT: ${this.stripAnsi(str)}`);
				const match = str.match(/http:\/\/localhost:\d+\/\?token=[\w-]+/);
				if (match && !resolved) {
					resolved = true;
					newInstance.url = match[0];
					newInstance.status = 'running';
					this.fireChange();
					resolve(newInstance);
				}
			});

			process.stderr?.on('data', (data: Buffer) => {
				this.outputChannel.append(`[Instance #${instanceId}] STDERR: ${this.stripAnsi(data.toString())}`);
			});

			process.on('error', (err) => {
				if (!resolved) {
					resolved = true;
					this.instances.delete(instanceId);
					this.reservedPorts.delete(port);
					this.fireChange();
					reject(err);
				}
			});

			process.on('close', (code) => {
				if (!resolved) {
					resolved = true;
					this.instances.delete(instanceId);
					this.reservedPorts.delete(port);
					this.fireChange();
					reject(new Error(`CARTA process closed during restart. (Exit code: ${code})`));
				}
			});
		});
	}

	/**
	 * Stops all currently running servers.
	 * @returns The number of servers stopped.
	 */
	stopAll(): number {
		const currentInstances = this.getInstances();
		for (const instance of currentInstances) {
			if (instance.status !== 'crashed') {
				this.terminateInstanceProcess(instance);
			}
		}

		const count = this.instances.size;
		this.instances.clear();
		this.reservedPorts.clear();
		this.stoppingInstances.clear();
		this.fireChange();
		return count;
	}
}
