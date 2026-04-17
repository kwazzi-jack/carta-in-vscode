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
import process from 'process';
import { buildCartaArgs } from './arguments';
import { logger } from './logger';

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
		logger.info(`Terminating process group for instance #${instance.id} (PGID: ${instance.process.pid}) on port ${instance.port}.`);
		this.stoppingInstances.add(instance.id);
		if (instance.process.pid) {
			try {
				// Use negative PID to kill the entire process group. This is a POSIX feature.
				process.kill(-instance.process.pid, 'SIGKILL');
			} catch (e) {
				logger.error(`Failed to kill process group for instance #${instance.id} (PGID: ${instance.process.pid}):`, e);
				// Fallback to killing just the main process if the group kill fails
				try {
					instance.process.kill('SIGKILL');
				} catch (e2) {
					logger.error(`Fallback process kill also failed for PID ${instance.process.pid}:`, e2);
				}
			}
		}

		// On Linux, we use fuser as a fallback to ensure the port is released quickly.
		if (os.platform() === 'linux') {
			logger.debug(`[Linux] Running fuser to release port ${instance.port}.`);
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
	 * Extracts CARTA session IDs from process output lines.
	 * Examples matched:
	 * - "Session (2647896887:1)"
	 * - "Session 2647896887 [host] Connected"
	 */
	private extractSessionIds(output: string): string[] {
		const found = new Set<string>();
		const regex = /\bSession(?:\s+\((\d+):\d+\)|\s+(\d+)\b)/g;
		let match: RegExpExecArray | null;

		while ((match = regex.exec(output)) !== null) {
			const id = match[1] ?? match[2];
			if (id) {
				found.add(id);
			}
		}

		return [...found];
	}

	/**
	 * Records newly observed session IDs for a running instance.
	 */
	private recordSessionIds(instance: CartaInstance, output: string): void {
		for (const sessionId of this.extractSessionIds(output)) {
			if (!instance.sessionIds.includes(sessionId)) {
				instance.sessionIds.push(sessionId);
				logger.info(`[Instance #${instance.id}] Observed new CARTA session ${sessionId}.`);
			}
		}
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
	 * Returns a copy of tracked session IDs for a specific instance.
	 */
	getSessionIds(instanceId: string): string[] {
		const instance = this.instances.get(instanceId);
		return instance ? [...instance.sessionIds] : [];
	}

	/**
	 * Initiates a new CARTA server for a given directory.
	 * @param config Extension configuration for paths and timeouts.
	 * @param folderPath The directory containing data to be served.
	 * @param cancellationToken Optional VS Code token to handle user-initiated aborts.
	 * @returns A Promise resolving to the running CartaInstance.
	 */
	async startInstance(config: CartaConfig, folderPath: string, cancellationToken?: { isCancellationRequested: boolean; onCancellationRequested: (listener: () => void) => void }): Promise<CartaInstance> {
		logger.info(`Requested to start CARTA for folder: ${folderPath}`);
		if (this.instances.size >= config.maxConcurrentServers) {
			logger.warn(`Cannot start new instance: maximum server limit reached (${config.maxConcurrentServers}).`);
			throw new Error(`Maximum running CARTA servers reached (${config.maxConcurrentServers}).`);
		}

		// 1. Validate the executable path once before trying any ports.
		const validatedPath = await validateExecutablePath(config.executablePath, { type: 'carta' });
		logger.debug(`Validated CARTA executable path: ${validatedPath}`);

		// Find an available port from the configured range.
		const initialPort = await pickAvailablePort(config.portRange, this.reservedPorts);
		if (!initialPort) {
			logger.error(`Failed to find any free ports in range ${config.portRange.start}-${config.portRange.end}.`);
			throw new Error(`No free ports found in range ${config.portRange.start}-${config.portRange.end}.`);
		}
		logger.debug(`Initial candidate port: ${initialPort}`);

		// List potential ports and try starting the server on them sequentially.
		const candidatePorts = [
			initialPort,
			...listCandidatePorts(config.portRange, this.reservedPorts).filter((port) => port !== initialPort),
		].slice(0, 3); // Limit retries to 3 attempts.
		logger.debug(`Startup attempt ports: ${candidatePorts.join(', ')}`);

		let lastError: Error | undefined;

		for (const selectedPort of candidatePorts) {
			if (cancellationToken?.isCancellationRequested) {
				logger.info('CARTA startup cancelled by user.');
				throw new Error('Cancelled by user');
			}

			try {
				logger.info(`Attempting to start CARTA on port ${selectedPort}...`);
				return await this.startInstanceOnPort(config, validatedPath, folderPath, selectedPort, cancellationToken);
			} catch (error) {
				const startupError = error instanceof Error ? error : new Error('Failed to start CARTA server.');
				lastError = startupError;
				logger.warn(`Failed to start CARTA on port ${selectedPort}: ${startupError.message}`);

				if (startupError.message === 'Cancelled by user') {
					throw startupError;
				}

				const isLikelyPortConflict = startupError.message.includes('closed before startup completed')
					&& !startupError.message.includes('Exit code: 0');

				if (!isLikelyPortConflict) {
					logger.error(`Startup failure on port ${selectedPort} does not appear to be a port conflict. Aborting retries.`);
					throw startupError;
				}
				logger.info(`Port ${selectedPort} seems to be in use. Trying next available port.`);
			}
		}

		logger.error('Exhausted all candidate ports. Failed to start CARTA.');
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

			const args = buildCartaArgs(config.executableArgs, selectedPort, folderPath, config.enableScripting);
			logger.info(`[Instance #${instanceId}] Spawning process...`);
			logger.debug(` > Path: ${validatedPath}`);
			logger.debug(` > Args: ${args.join(' ')}`);

			const cartaProcess = spawn(validatedPath, args, {
				env: {...process.env, ...config.environmentVariables},
				shell: false,
				detached: true
			});
			logger.info(`[Instance #${instanceId}] Process spawned with PID ${cartaProcess.pid}.`);

			const instance: CartaInstance = {
				id: instanceId,
				process: cartaProcess,
				folderPath,
				port: selectedPort,
				startedAt: Date.now(),
				sessionIds: [],
				status: 'starting',
			};

			this.instances.set(instanceId, instance);
			this.fireChange();

			return new Promise<CartaInstance>((resolve, reject) => {
				let resolved = false;

				const cleanupStartingFailure = () => {
					logger.warn(`[Instance #${instanceId}] Cleaning up after startup failure.`);
					this.instances.delete(instanceId);
					this.reservedPorts.delete(selectedPort);
					this.fireChange();
				};

				const onReady = (baseUrl: string, token: string) => {
					if (resolved) {
						return;
					}
					logger.info(`[Instance #${instanceId}] CARTA server is ready.`);
					logger.debug(` > Base URL: ${baseUrl}`);
					logger.debug(` > Token: ${token}`);
					resolved = true;
					instance.base_url = baseUrl;
					instance.authToken = token;
					instance.status = 'running';
					this.fireChange();
					resolve(instance);
				};

				const checkIfReady = (output: string) => {
					const match = output.match(/(https?:\/\/[\w.-]+:\d+\/)\?token=([\w-]+)/);
					if (match && match[1] && match[2]) {
						onReady(match[1], match[2]);
					}
				};

				const onCancelled = () => {
					if (resolved) {
						return;
					}
					logger.info(`[Instance #${instanceId}] Startup cancelled by user.`);
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

				this.outputChannel.appendLine(`[Instance #${instanceId}] Spawning: ${validatedPath} ${args.join(' ')}`);

				cartaProcess.stdout?.on('data', (data: Buffer) => {
					const str = data.toString();
					this.outputChannel.append(`[Instance #${instanceId}] STDOUT: ${this.stripAnsi(str)}`);
					this.recordSessionIds(instance, str);
					checkIfReady(str);
				});
				cartaProcess.stderr?.on('data', (data: Buffer) => {
					const str = data.toString();
					this.outputChannel.append(`[Instance #${instanceId}] STDERR: ${this.stripAnsi(str)}`);
					this.recordSessionIds(instance, str);
					checkIfReady(str);
				});

				cartaProcess.on('error', (err) => {
					if (resolved) {
						return;
					}
					logger.error(`[Instance #${instanceId}] Process failed to spawn: ${err.message}`);
					resolved = true;
					cleanupStartingFailure();
					reject(err);
				});

				cartaProcess.on('close', (code) => {
					const requested = this.stoppingInstances.has(instanceId);
					if (requested) {
						logger.info(`[Instance #${instanceId}] Process closed as requested (Exit code: ${code}).`);
						this.instances.delete(instanceId);
						this.stoppingInstances.delete(instanceId);
						this.reservedPorts.delete(selectedPort);
					} else {
						logger.warn(`[Instance #${instanceId}] Process terminated unexpectedly (Exit code: ${code}).`);
						if (!resolved) {
							this.instances.delete(instanceId);
						} else {
							instance.status = 'crashed';
						}
						this.reservedPorts.delete(selectedPort);
					}
					this.fireChange();

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
						logger.error(`[Instance #${instanceId}] Timed out after ${config.startupTimeout}ms waiting for startup.`);
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
			logger.warn(`Stop command ignored: instance #${instanceId} not found.`);
			return false;
		}

		if (instance.status === 'crashed') {
			logger.info(`Clearing crashed instance #${instanceId}.`);
			this.instances.delete(instanceId);
			this.fireChange();
			return true;
		}

		logger.info(`Stopping instance #${instanceId}.`);
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
			logger.error(`Restart failed: instance #${instanceId} not found.`);
			throw new Error(`Instance ${instanceId} not found.`);
		}
		logger.info(`Restarting instance #${instanceId} on port ${oldInstance.port}.`);

		const folderPath = oldInstance.folderPath;
		const port = oldInstance.port;

		const validatedPath = await validateExecutablePath(config.executablePath, { type: 'carta' });

		if (oldInstance.status !== 'crashed') {
			this.terminateInstanceProcess(oldInstance);
		}
		this.instances.delete(instanceId);
		this.fireChange();

		await new Promise(resolve => setTimeout(resolve, 200));

		const args = buildCartaArgs(config.executableArgs, port, folderPath, config.enableScripting);
		logger.info(`[Instance #${instanceId}] Spawning process for restart...`);
		logger.debug(` > Path: ${validatedPath}`);
		logger.debug(` > Args: ${args.join(' ')}`);

		const cartaProcess = spawn(validatedPath, args, {
			env: {...process.env, ...config.environmentVariables},
			shell: false,
			detached: true
		});
		logger.info(`[Instance #${instanceId}] Process spawned with PID ${cartaProcess.pid} for restart.`);

		const newInstance: CartaInstance = {
			id: instanceId,
			process: cartaProcess,
			folderPath,
			port,
			startedAt: Date.now(),
			sessionIds: [],
			status: 'starting',
		};

		this.instances.set(instanceId, newInstance);
		this.fireChange();

		this.outputChannel.appendLine(`[Instance #${instanceId}] Restarting: ${validatedPath} ${args.join(' ')}`);

		return new Promise<CartaInstance>((resolve, reject) => {
			let resolved = false;

			const onReady = (baseUrl: string, token: string) => {
				if (resolved) return;
				logger.info(`[Instance #${instanceId}] Restarted server is ready.`);
				logger.debug(` > Base URL: ${baseUrl}`);
				logger.debug(` > Token: ${token}`);
				resolved = true;
				newInstance.base_url = baseUrl;
				newInstance.authToken = token;
				newInstance.status = 'running';
				this.fireChange();
				resolve(newInstance);
			};

			const checkIfReady = (output: string) => {
				const match = output.match(/(https?:\/\/[\w.-]+:\d+\/)\?token=([\w-]+)/);
				if (match && match[1] && match[2]) {
					onReady(match[1], match[2]);
				}
			};

			cartaProcess.stdout?.on('data', (data: Buffer) => {
				const str = data.toString();
				this.outputChannel.append(`[Instance #${instanceId}] STDOUT: ${this.stripAnsi(str)}`);
				this.recordSessionIds(newInstance, str);
				checkIfReady(str);
			});

			cartaProcess.stderr?.on('data', (data: Buffer) => {
				const str = data.toString();
				this.outputChannel.append(`[Instance #${instanceId}] STDERR: ${this.stripAnsi(str)}`);
				this.recordSessionIds(newInstance, str);
				checkIfReady(str);
			});

			cartaProcess.on('error', (err) => {
				if (resolved) return;
				logger.error(`[Instance #${instanceId}] Restart process failed to spawn: ${err.message}`);
				resolved = true;
				this.instances.delete(instanceId);
				this.reservedPorts.delete(port);
				this.fireChange();
				reject(err);
			});

			cartaProcess.on('close', (code) => {
				const requested = this.stoppingInstances.has(instanceId);
				if (requested) {
					this.instances.delete(instanceId);
					this.stoppingInstances.delete(instanceId);
					this.reservedPorts.delete(port);
				} else if (!resolved) {
					logger.error(`[Instance #${instanceId}] Restarted process closed before becoming ready (Exit code: ${code}).`);
					resolved = true;
					this.instances.delete(instanceId);
					this.reservedPorts.delete(port);
					reject(new Error(`CARTA process closed during restart. (Exit code: ${code})`));
				} else {
					newInstance.status = "crashed";
					this.reservedPorts.delete(port);
				}
				this.fireChange();
			});
		});
	}

	/**
	 * Stops all currently running servers.
	 * @returns The number of servers stopped.
	 */
	stopAll(): number {
		const currentInstances = this.getInstances();
		if (currentInstances.length === 0) {
			logger.info('Stop all command ignored: no running instances.');
			return 0;
		}
		logger.info(`Stopping all ${currentInstances.length} running CARTA instances.`);
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
