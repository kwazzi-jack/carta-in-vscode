/**
 * @module ports
 * Network port management and availability detection.
 */

import * as net from 'net';
import { PortRange } from './types';

/**
 * Parses a string representation of a port range (e.g., '3000-4000').
 * @param input The raw string input from settings.
 * @param fallback The default range to use if parsing fails.
 * @returns A PortRange object with start and end values.
 */
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

/**
 * Calculates the total number of slots in a port range.
 */
export function getPortRangeSize(range: PortRange): number {
	return range.end - range.start + 1;
}

/**
 * Low-level check to see if a specific TCP port is being used on localhost.
 * @param port The port number to probe.
 * @returns True if the port is occupied, false otherwise.
 */
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

		socket.connect(port, 'localhost');
	});
}

/**
 * Determines if a port is available for a new CARTA server.
 */
export async function isPortFree(port: number): Promise<boolean> {
	const inUse = await isPortInUse(port);
	return !inUse;
}

/**
 * Generates a list of all potential ports within a range that are not already reserved by the extension.
 */
export function listCandidatePorts(range: PortRange, reservedPorts: Set<number>): number[] {
	const candidates: number[] = [];
	for (let port = range.start; port <= range.end; port++) {
		if (!reservedPorts.has(port)) {
			candidates.push(port);
		}
	}

	return candidates;
}

/**
 * Scans a port range and returns the first available port for the extension to use.
 * @param range The configured PortRange.
 * @param reservedPorts Ports already tracked/reserved in the current session.
 * @returns The available port number, or undefined if none found.
 */
export async function pickAvailablePort(range: PortRange, reservedPorts: Set<number>): Promise<number | undefined> {
	for (const port of listCandidatePorts(range, reservedPorts)) {
		if (await isPortFree(port)) {
			return port;
		}
	}

	return undefined;
}
