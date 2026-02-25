import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as os from 'os';
import { listCandidatePorts, pickAvailablePort } from './ports';
import { CartaConfig, CartaInstance } from './types';

export class CartaManager {
	private readonly instances = new Map<string, CartaInstance>();
	private readonly reservedPorts = new Set<number>();
	private nextInstanceId = 1;
	private readonly onDidChangeEmitter = new EventEmitter();

	private terminateInstanceProcess(instance: CartaInstance): void {
		instance.process.kill('SIGKILL');

		if (os.platform() === 'linux') {
			const killer = spawn('fuser', ['-k', `${instance.port}/tcp`], {
				shell: false,
				stdio: 'ignore',
			});
			killer.unref();
		}
	}

	readonly onDidChange = (listener: () => void): (() => void) => {
		this.onDidChangeEmitter.on('change', listener);
		return () => this.onDidChangeEmitter.off('change', listener);
	};

	private fireChange(): void {
		this.onDidChangeEmitter.emit('change');
	}

	getInstances(): CartaInstance[] {
		return [...this.instances.values()].sort((a, b) => b.startedAt - a.startedAt);
	}

	getInstance(instanceId: string): CartaInstance | undefined {
		return this.instances.get(instanceId);
	}

	async startInstance(config: CartaConfig, folderPath: string, cancellationToken?: { isCancellationRequested: boolean; onCancellationRequested: (listener: () => void) => void }): Promise<CartaInstance> {
		if (this.instances.size >= config.maxConcurrentServers) {
			throw new Error(`Maximum running CARTA servers reached (${config.maxConcurrentServers}).`);
		}

		const initialPort = await pickAvailablePort(config.portRange, this.reservedPorts);
		if (!initialPort) {
			throw new Error(`No free ports found in range ${config.portRange.start}-${config.portRange.end}.`);
		}

		const candidatePorts = [
			initialPort,
			...listCandidatePorts(config.portRange, this.reservedPorts).filter((port) => port !== initialPort),
		];

		let lastError: Error | undefined;

		for (const selectedPort of candidatePorts) {
			if (cancellationToken?.isCancellationRequested) {
				throw new Error('Cancelled by user');
			}

			try {
				return await this.startInstanceOnPort(config, folderPath, selectedPort, cancellationToken);
			} catch (error) {
				const startupError = error instanceof Error ? error : new Error('Failed to start CARTA server.');
				lastError = startupError;
				if (startupError.message === 'Cancelled by user') {
					throw startupError;
				}

				const canRetry = startupError.message.includes('closed before startup completed')
					|| startupError.message.includes('Timed out waiting for CARTA server startup');

				if (!canRetry) {
					throw startupError;
				}
			}
		}

		throw lastError ?? new Error('No usable ports available in the configured range.');
	}

	private async startInstanceOnPort(
		config: CartaConfig,
		folderPath: string,
		selectedPort: number,
		cancellationToken?: { isCancellationRequested: boolean; onCancellationRequested: (listener: () => void) => void }
	): Promise<CartaInstance> {

		this.reservedPorts.add(selectedPort);

		const instanceId = String(this.nextInstanceId++);
		const process = spawn(config.executablePath, [
			'--no_browser',
			'--host', 'localhost',
			'-p', selectedPort.toString(),
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

			process.stdout?.on('data', (data: Buffer) => checkIfReady(data.toString()));
			process.stderr?.on('data', (data: Buffer) => checkIfReady(data.toString()));

			process.on('error', (err) => {
				if (resolved) {
					return;
				}

				resolved = true;
				cleanupStartingFailure();
				reject(err);
			});

			process.on('close', () => {
				this.instances.delete(instanceId);
				this.reservedPorts.delete(selectedPort);
				this.fireChange();

				if (!resolved) {
					resolved = true;
					reject(new Error('CARTA process closed before startup completed.'));
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

	stopInstance(instanceId: string): boolean {
		const instance = this.instances.get(instanceId);
		if (!instance) {
			return false;
		}

		this.terminateInstanceProcess(instance);
		this.instances.delete(instanceId);
		this.reservedPorts.delete(instance.port);
		this.fireChange();
		return true;
	}

	stopAll(): number {
		const currentInstances = this.getInstances();
		for (const instance of currentInstances) {
			this.terminateInstanceProcess(instance);
		}

		const count = this.instances.size;
		this.instances.clear();
		this.reservedPorts.clear();
		this.fireChange();
		return count;
	}
}
