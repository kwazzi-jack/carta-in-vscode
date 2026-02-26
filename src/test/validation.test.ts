import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { validateExecutablePath } from '../validation';

suite('Validation Test Suite', () => {
	const tempDir = path.join(os.tmpdir(), 'carta-validation-test');

	setup(() => {
		if (!fs.existsSync(tempDir)) {
			fs.mkdirSync(tempDir);
		}
	});

	teardown(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('should allow a simple command name (assumed in PATH)', async () => {
		const result = await validateExecutablePath('carta', { type: 'carta' });
		assert.strictEqual(result, 'carta');
	});

	test('should resolve and validate an absolute path to an executable', async () => {
		const execPath = path.join(tempDir, 'fake-carta');
		fs.writeFileSync(execPath, '#!/bin/bash\necho "test"');
		fs.chmodSync(execPath, 0o755);

		const result = await validateExecutablePath(execPath, { type: 'carta' });
		assert.strictEqual(result, path.resolve(execPath));
	});

	test('should throw if file does not exist', async () => {
		const missingPath = path.join(tempDir, 'non-existent-file-123');
		await assert.rejects(
			validateExecutablePath(missingPath, { type: 'carta' }),
			/Executable not found/
		);
	});

	test('should throw if path is a directory', async () => {
		await assert.rejects(
			validateExecutablePath(tempDir, { type: 'carta' }),
			/Path is not a file/
		);
	});

	test('should throw if file is not executable', async () => {
		const nonExecPath = path.join(tempDir, 'not-executable');
		fs.writeFileSync(nonExecPath, 'data');
		fs.chmodSync(nonExecPath, 0o644);

		await assert.rejects(
			validateExecutablePath(nonExecPath, { type: 'carta' }),
			/File is not executable/
		);
	});

	test('should throw if executable is a common shell (e.g., bash)', async () => {
		const bashPath = '/bin/bash';
		if (fs.existsSync(bashPath)) {
			await assert.rejects(
				validateExecutablePath(bashPath, { type: 'carta' }),
				/appears to be a system shell or interpreter/
			);
		}
	});

	test('should allow unusual browser names but resolve the path', async () => {
		const browserPath = path.join(tempDir, 'my-weird-browser');
		fs.writeFileSync(browserPath, 'test');
		fs.chmodSync(browserPath, 0o755);

		const result = await validateExecutablePath(browserPath, { type: 'browser' });
		assert.strictEqual(result, path.resolve(browserPath));
	});
});
