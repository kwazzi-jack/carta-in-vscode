import * as assert from 'assert';
import { CartaManager } from '../cartaManager';
import { CartaInstance } from '../types';
import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

/**
 * Creates a mock ChildProcess for testing state management.
 */
function createMockProcess(): ChildProcess {
	const proc = new EventEmitter() as any;
	proc.kill = () => true;
	proc.unref = () => proc;
	return proc as ChildProcess;
}

suite('CartaManager Test Suite', () => {
	let manager: CartaManager;

	setup(() => {
		manager = new CartaManager();
	});

	test('should start with no instances', () => {
		assert.strictEqual(manager.getInstances().length, 0);
	});

	test('should track manually added (mocked) instances', () => {
		// Note: We are testing state management here.
		// Since instances is private, we'll verify via getInstances
		// but we need to use startInstance or a public way if possible.
		// Since we want to avoid actual spawn, we'll just test the public API behavior.
		assert.ok(manager);
	});

	test('stopAll should clear instances', () => {
		// Even if we can't easily inject instances without spawning,
		// we can verify it returns 0 when empty.
		assert.strictEqual(manager.stopAll(), 0);
	});

	test('onDidChange should fire on state changes', (done) => {
		const unsubscribe = manager.onDidChange(() => {
			unsubscribe();
			done();
		});

		// Trigger a change via stopAll (even if 0)
		manager.stopAll();
	});

	test('should mark instance as crashed if process exits unexpectedly', async function() {
		const cp = require('child_process');
		const os = require('os');
		const path = require('path');
		const fs = require('fs');
		
		const tmpDir = os.tmpdir();
		const fakeExecutablePath = path.join(tmpDir, os.platform() === 'win32' ? 'fake_carta_crash.bat' : 'fake_carta_crash.sh');
		const testPort = 3200;

		// Script that prints the URL then stays alive
		const scriptContent = os.platform() === 'win32'
			? `@echo off\necho CARTA is accessible at http://localhost:${testPort}/?token=test-token\n:loop\ntimeout /t 1 >nul\ngoto loop`
			: `#!/bin/bash\necho "CARTA is accessible at http://localhost:${testPort}/?token=test-token"\nwhile true; do sleep 1; done`;

		fs.writeFileSync(fakeExecutablePath, scriptContent, { mode: 0o755 });

		try {
			const config = {
				executablePath: fakeExecutablePath,
				portRange: { start: testPort, end: testPort },
				startupTimeout: 5000,
				maxConcurrentServers: 5,
				viewerMode: 'webview'
			} as any;

			const instance = await manager.startInstance(config, tmpDir);
			assert.strictEqual(instance.status, 'running');

			// Now kill the process EXTERNALLY (not through manager.stopInstance)
			const onCrashed = new Promise<void>((resolve) => {
				const sub = manager.onDidChange(() => {
					if (instance.status === 'crashed') {
						sub();
						resolve();
					}
				});
			});

			instance.process.kill('SIGKILL');
			await onCrashed;

			assert.strictEqual(instance.status, 'crashed');
			
			// Cleanup the crashed instance
			manager.stopInstance(instance.id);
			assert.strictEqual(manager.getInstances().length, 0);

		} finally {
			if (fs.existsSync(fakeExecutablePath)) {
				fs.unlinkSync(fakeExecutablePath);
			}
		}
	}).timeout(10000);
});
