import * as assert from 'assert';
import { validateLaunchCapacity, getConfig } from '../config';
import { CartaConfig } from '../types';

suite('Config Test Suite', () => {

	suite('validateLaunchCapacity', () => {
		test('should return undefined when capacity is sufficient', () => {
			const config: Partial<CartaConfig> = {
				portRange: { start: 3000, end: 3004 }, // 5 ports
				maxConcurrentServers: 5
			};
			assert.strictEqual(validateLaunchCapacity(config as CartaConfig), undefined);
		});

		test('should return error message when capacity is insufficient', () => {
			const config: Partial<CartaConfig> = {
				portRange: { start: 3000, end: 3001 }, // 2 ports
				maxConcurrentServers: 5
			};
			const result = validateLaunchCapacity(config as CartaConfig);
			assert.ok(result?.includes('supports only 2 concurrent ports'));
		});
	});

	suite('getConfig', () => {
		test('should return a valid config object', () => {
			const config = getConfig();
			assert.ok(config.executablePath);
			assert.ok(Array.isArray(config.executableArgs), 'executableArgs should be an array');
			assert.ok(config.portRange);
			assert.strictEqual(typeof config.maxConcurrentServers, 'number');
			assert.ok(['webview', 'simpleBrowser', 'externalBrowser'].includes(config.viewerMode));
			assert.ok(Array.isArray(config.browserExecutableArgs), 'browserExecutableArgs should be an array');
		});
	});
});
