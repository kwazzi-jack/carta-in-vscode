import * as net from 'net';
import { PortRange } from './types';

export function parsePortRange(input: string, fallback: PortRange = { start: 3002, end: 3099 }): PortRange {
	const match = input.match(/^\s*(\d{2,5})\s*-\s*(\d{2,5})\s*$/);
	if (!match) {
		return fallback;
	}

	const start = Number(match[1]);
	const end = Number(match[2]);

	if (!Number.isInteger(start) || !Number.isInteger(end)) {
		return fallback;
	}

	if (start < 1024 || end > 65535 || start > end) {
		return fallback;
	}

	return { start, end };
}

export function getPortRangeSize(range: PortRange): number {
	return range.end - range.start + 1;
}

export async function isPortInUse(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = new net.Socket();
		let settled = false;

		const finish = (result: boolean) => {
			if (settled) {
				return;
			}
			settled = true;
			socket.destroy();
			resolve(result);
		};

		socket.setTimeout(300);
		socket.once('connect', () => finish(true));
		socket.once('timeout', () => finish(false));
		socket.once('error', () => finish(false));

		socket.connect(port, '127.0.0.1');
	});
}

export async function isPortFree(port: number): Promise<boolean> {
	const inUse = await isPortInUse(port);
	return !inUse;
}

export function listCandidatePorts(range: PortRange, reservedPorts: Set<number>): number[] {
	const candidates: number[] = [];
	for (let port = range.start; port <= range.end; port++) {
		if (!reservedPorts.has(port)) {
			candidates.push(port);
		}
	}

	return candidates;
}

export async function pickAvailablePort(range: PortRange, reservedPorts: Set<number>): Promise<number | undefined> {
	for (const port of listCandidatePorts(range, reservedPorts)) {
		if (await isPortFree(port)) {
			return port;
		}
	}

	return undefined;
}
