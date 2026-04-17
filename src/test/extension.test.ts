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
        const expectedCommands = [
            'carta-in-vscode.open',
            'carta-in-vscode.stop',
            'carta-in-vscode.stopAll',
            'carta-in-vscode.openWorkspace',
            'carta-in-vscode.openRecent',
            'carta-in-vscode.openInstance',
            'carta-in-vscode.stopInstance',
            'carta-in-vscode.restartInstance',
            'carta-in-vscode.copyInstanceId',
            'carta-in-vscode.copyInstanceUrl',
            'carta-in-vscode.copyInstanceToken',
            'carta-in-vscode.copyInstanceSessionIds',
            'carta-in-vscode.focusInstance',
            'carta-in-vscode.openInstanceFolder',
            'carta-in-vscode.openInstanceLog',
            'carta-in-vscode.ctx.restartInstance',
            'carta-in-vscode.ctx.stopInstance',
            'carta-in-vscode.ctx.focusInstance',
            'carta-in-vscode.ctx.copyInstanceUrl',
            'carta-in-vscode.ctx.copyInstanceToken',
            'carta-in-vscode.ctx.copyInstanceSessionIds',
            'carta-in-vscode.ctx.openInstanceFolder',
            'carta-in-vscode.ctx.openInstanceLog',
        ];

        for (const command of expectedCommands) {
            assert.ok(commands.includes(command), `Expected command to be registered: ${command}`);
        }
    });
});