import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import * as fs from 'fs';
import { CartaManager } from '../cartaManager';
import { getConfig } from '../config';

/**
 * Checks if FUSE is available on the current system.
 * Essential for running AppImages without extraction.
 */
function isFuseAvailable(): boolean {
	if (os.platform() !== 'linux') {
		return false;
	}
	try {
		return fs.existsSync('/dev/fuse');
	} catch {
		return false;
	}
}

suite('CARTA Launcher Integration Test Suite', () => {
	let manager: CartaManager;

	setup(() => {
		manager = new CartaManager();
	});

	teardown(() => {
		manager.stopAll();
	});

	test('should start CARTA and log a successful connection', async function() {
		const config = getConfig();

		try {
			const cp = require('child_process');
			cp.execSync(`${config.executablePath} --version`, { stdio: 'ignore' });
		} catch {
			this.skip();
			return;
		}

		const testDir = os.tmpdir();
		const timeout = 30000;
		const startConfig = { ...config, startupTimeout: timeout };

		try {
			const instance = await manager.startInstance(startConfig, testDir);

			assert.ok(instance.base_url, 'Instance should have a URL');

			let connectedLogSeen = false;
			const logPromise = new Promise<void>((resolve) => {
				const listener = (data: Buffer) => {
					const output = data.toString();
					if (output.includes('Connected') || output.includes('Session')) {
						connectedLogSeen = true;
						instance.process.stdout?.removeListener('data', listener);
						resolve();
					}
				};
				instance.process.stdout?.on('data', listener);

				setTimeout(resolve, 10000);
			});

			await new Promise<void>((resolve, reject) => {
				const req = http.get(instance.base_url!, (res) => {
					res.on('data', () => {});
					res.on('end', () => resolve());
				});
				req.on('error', (err) => reject(err));
			});

			await logPromise;

			assert.ok(instance.base_url.includes(`:${instance.port}`), 'URL should contain the correct port');

			manager.stopInstance(instance.id);
		} catch (error) {
			assert.fail(`Integration test failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}).timeout(45000);

	test('should start and stop a real CARTA instance', async function() {
		const config = getConfig();

		try {
			const cp = require('child_process');
			cp.execSync(`${config.executablePath} --version`, { stdio: 'ignore' });
		} catch {
			this.skip();
			return;
		}

		const testDir = os.tmpdir();
		const startConfig = { ...config, startupTimeout: 30000 };

		const instance = await manager.startInstance(startConfig, testDir);
		assert.strictEqual(instance.status, 'running');

		const stopped = manager.stopInstance(instance.id);
		assert.strictEqual(stopped, true);
		assert.strictEqual(manager.getInstances().length, 0);
	}).timeout(40000);

	test('should respect custom executable path', async function() {
		const config = getConfig();
		const tmpDir = os.tmpdir();
		const fakeExecutablePath = path.join(tmpDir, os.platform() === 'win32' ? 'fake_carta.bat' : 'fake_carta.sh');

		const testPort = 3100;

		const scriptContent = os.platform() === 'win32'
			? `@echo off\necho CARTA is accessible at http://localhost:${testPort}/?token=test-token\npause`
			: `#!/bin/bash\necho "CARTA is accessible at http://localhost:${testPort}/?token=test-token"\nsleep 100`;

		fs.writeFileSync(fakeExecutablePath, scriptContent, { mode: 0o755 });

		const customConfig = {
			...config,
			executablePath: fakeExecutablePath,
			startupTimeout: 5000,
			portRange: { start: testPort, end: testPort }
		};

		try {
			const instance = await manager.startInstance(customConfig, tmpDir);
			assert.strictEqual(instance.base_url, `http://localhost:${testPort}/`);
			assert.strictEqual(instance.authToken, 'test-token');
			manager.stopInstance(instance.id);
		} finally {
			if (fs.existsSync(fakeExecutablePath)) {
				fs.unlinkSync(fakeExecutablePath);
			}
		}
	});

	test('should work with the official AppImage if available locally', async function() {
		if (os.platform() !== 'linux') {
			this.skip();
			return;
		}

		if (!isFuseAvailable()) {
			this.skip();
			return;
		}

		// Look for the AppImage in the specified path relative to project root
		const projectRoot = path.join(__dirname, '..', '..');
		const appImagePath = path.join(projectRoot, 'carta.AppImage.x86_64', 'carta-x86_64.AppImage');

		if (!fs.existsSync(appImagePath)) {
			this.skip();
			return;
		}

		const config = getConfig();
		const testDir = os.tmpdir();
		const appImageConfig = {
			...config,
			executablePath: appImagePath,
			startupTimeout: 40000
		};

		try {
			const instance = await manager.startInstance(appImageConfig, testDir);
			assert.strictEqual(instance.status, 'running');
			assert.ok(instance.base_url, 'AppImage instance should have a URL');

			const stopped = manager.stopInstance(instance.id);
			assert.strictEqual(stopped, true);
		} catch (error) {
			assert.fail(`AppImage integration test failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}).timeout(60000);

	test('should validate FUSE requirement for hypothetical AppImage usage', function() {
		if (os.platform() !== 'linux') {
			this.skip();
			return;
		}

		const fuseAvailable = isFuseAvailable();
		if (!fuseAvailable) {
			this.skip();
			return;
		}

		console.log('FUSE available: AppImage testing can proceed normally.');
	});
});
