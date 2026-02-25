import { ChildProcess } from 'child_process';

export interface PortRange {
	start: number;
	end: number;
}

export type CartaInstanceStatus = 'starting' | 'running';

export interface CartaInstance {
	id: string;
	process: ChildProcess;
	folderPath: string;
	port: number;
	url?: string;
	startedAt: number;
	status: CartaInstanceStatus;
}

export interface CartaConfig {
	executablePath: string;
	portRange: PortRange;
	startupTimeout: number;
	maxConcurrentServers: number;
	viewerMode: 'simpleBrowser' | 'externalBrowser';
	browserExecutablePath?: string;
}
