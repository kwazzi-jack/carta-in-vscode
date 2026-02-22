import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('kwazzi-jack.carta-in-vscode'));
    });

    test('Commands should be registered', async () => {
		// Force extension to load first
        const ext = vscode.extensions.getExtension('kwazzi-jack.carta-in-vscode');
        await ext?.activate();

		// Check if commands are present
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('carta-in-vscode.open'));
        assert.ok(commands.includes('carta-in-vscode.stop'));
    });
});