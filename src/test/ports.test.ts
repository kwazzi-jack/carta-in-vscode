import * as assert from 'assert';
import { parsePortRange, getPortRangeSize, listCandidatePorts } from '../ports';

suite('Ports Utility Test Suite', () => {
	
	suite('parsePortRange', () => {
		test('should parse valid range strings', () => {
			const result = parsePortRange('3000-4000');
			assert.strictEqual(result.start, 3000);
			assert.strictEqual(result.end, 4000);
		});

		test('should handle spaces in range strings', () => {
			const result = parsePortRange('  3000  -  4000  ');
			assert.strictEqual(result.start, 3000);
			assert.strictEqual(result.end, 4000);
		});

		test('should return fallback for invalid formats', () => {
			const fallback = { start: 1, end: 2 };
			assert.deepStrictEqual(parsePortRange('invalid', fallback), fallback);
			assert.deepStrictEqual(parsePortRange('3000', fallback), fallback);
			assert.deepStrictEqual(parsePortRange('3000-', fallback), fallback);
		});

		test('should return fallback for privileged ports (< 1024)', () => {
			const fallback = { start: 2000, end: 3000 };
			assert.deepStrictEqual(parsePortRange('80-90', fallback), fallback);
		});

		test('should return fallback if start > end', () => {
			const fallback = { start: 2000, end: 3000 };
			assert.deepStrictEqual(parsePortRange('5000-4000', fallback), fallback);
		});

		test('should return fallback for out of range ports (> 65535)', () => {
			const fallback = { start: 2000, end: 3000 };
			assert.deepStrictEqual(parsePortRange('65530-65536', fallback), fallback);
		});
	});

	suite('getPortRangeSize', () => {
		test('should calculate correct size', () => {
			assert.strictEqual(getPortRangeSize({ start: 3000, end: 3000 }), 1);
			assert.strictEqual(getPortRangeSize({ start: 3000, end: 3005 }), 6);
		});
	});

	suite('listCandidatePorts', () => {
		test('should list all ports when none are reserved', () => {
			const range = { start: 3000, end: 3002 };
			const reserved = new Set<number>();
			assert.deepStrictEqual(listCandidatePorts(range, reserved), [3000, 3001, 3002]);
		});

		test('should exclude reserved ports', () => {
			const range = { start: 3000, end: 3004 };
			const reserved = new Set([3001, 3003]);
			assert.deepStrictEqual(listCandidatePorts(range, reserved), [3000, 3002, 3004]);
		});

		test('should return empty array if all ports are reserved', () => {
			const range = { start: 3000, end: 3001 };
			const reserved = new Set([3000, 3001]);
			assert.deepStrictEqual(listCandidatePorts(range, reserved), []);
		});
	});
});
