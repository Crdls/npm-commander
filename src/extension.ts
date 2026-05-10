import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    const provider = new PackageJsonProvider();
    
    // Create the TreeView immediately
    const treeView = vscode.window.createTreeView('npm-commander-main', {
        treeDataProvider: provider,
        showCollapseAll: false
    });

    const activeExecutions = new Map<string, vscode.TaskExecution>();
    const scriptTerminals = new Map<string, vscode.Terminal>();
    const manuallyStopped = new Set<string>();

    /**
     * Helper to perform workspace scan with header spinner toggle
     */
    async function performRefresh() {
        // Show spinner icon via custom context in package.json
        vscode.commands.executeCommand('setContext', 'npmCommanderScanning', true);
        
        await provider.refresh();
        
        // Hide spinner icon
        vscode.commands.executeCommand('setContext', 'npmCommanderScanning', false);
    }

    // Capture terminal when a task starts for precise focusing
    const taskStartWatcher = vscode.tasks.onDidStartTask(e => {
        const scriptName = e.execution.task.name;
        const terminal = vscode.window.terminals.find(t => 
            t.name === `npm: ${scriptName}` || t.name === scriptName
        );
        if (terminal) {
            scriptTerminals.set(scriptName, terminal);
        }
    });

    // COMMAND: Manual refresh
    const refreshCommand = vscode.commands.registerCommand('npm-commander.refreshEntry', () => {
        performRefresh();
    });

    // COMMAND: Run script
    const runCommand = vscode.commands.registerCommand('npm-commander.runNpmScript', async (item: PackageItem) => {
        const uri = item.scriptUri;
        if (!item || !uri) {return;}

        const folder = path.dirname(uri.fsPath);
        const termName = item.label;

        const existing = scriptTerminals.get(termName) || vscode.window.terminals.find(t => t.name === termName);
        if (existing) {
            existing.show(false);
        }

        const task = new vscode.Task(
            { type: 'npm', script: item.label },
            vscode.TaskScope.Workspace,
            item.label,
            'npm',
            new vscode.ShellExecution(`npm run ${item.label}`, { cwd: folder })
        );

        task.presentationOptions = {
            focus: true,
            panel: vscode.TaskPanelKind.Dedicated,
            reveal: vscode.TaskRevealKind.Always,
            close: false
        };

        item.setRunning();
        provider.saveStatusToCache(item);
        provider.refresh(item);

        const execution = await vscode.tasks.executeTask(task);
        activeExecutions.set(item.label, execution);
    });

    // COMMAND: Focus terminal tab
    const focusCommand = vscode.commands.registerCommand('npm-commander.focusTerminal', (item: PackageItem) => {
        if (!item || item.contextValue === 'info') {return;}
        const terminal = scriptTerminals.get(item.label) || vscode.window.terminals.find(t => t.name === item.label);
        if (terminal) {
            terminal.show(false);
        }
    });

    // COMMAND: Open package.json
    const openPackageCommand = vscode.commands.registerCommand('npm-commander.openPackageJson', (item: PackageItem) => {
        if (item && item.scriptUri) {
            vscode.window.showTextDocument(item.scriptUri);
        }
    });

    // COMMAND: Stop script (Ctrl+C)
    const stopCommand = vscode.commands.registerCommand('npm-commander.stopScript', (item: PackageItem) => {
        manuallyStopped.add(item.label);
        const terminal = scriptTerminals.get(item.label) || vscode.window.terminals.find(t => t.name === item.label);
        
        if (terminal) {
            terminal.sendText('\u0003'); 
            terminal.show(false);
        }

        activeExecutions.delete(item.label);
        item.resetStatus();
        provider.saveStatusToCache(item);
        provider.refresh(item);
    });

    // Watch for task completion
    const taskEndWatcher = vscode.tasks.onDidEndTaskProcess(e => {
        const scriptName = e.execution.task.name;
        const exitCode = e.exitCode;
        const isInterrupted = exitCode === undefined || exitCode === 130 || exitCode === -1073741510 || exitCode === 3221225786;

        if (manuallyStopped.has(scriptName) || isInterrupted) {
            provider.updateStatus(scriptName, undefined, true);
            manuallyStopped.delete(scriptName);
        } else {
            provider.updateStatus(scriptName, exitCode, false);
        }
        activeExecutions.delete(scriptName);
    });

    // Clean up when terminal is closed
    const terminalCloseWatcher = vscode.window.onDidCloseTerminal(terminal => {
        for (const [name, term] of scriptTerminals.entries()) {
            if (term === terminal) {
                scriptTerminals.delete(name);
                provider.updateStatus(name, undefined, true);
                break;
            }
        }
    });

    // Trigger initial scan
    performRefresh();

    context.subscriptions.push(
        treeView,
        taskStartWatcher, 
        refreshCommand, 
        runCommand, 
        focusCommand, 
        openPackageCommand, 
        stopCommand, 
        taskEndWatcher, 
        terminalCloseWatcher
    );
}

// --- TREE DATA PROVIDER ---
export class PackageJsonProvider implements vscode.TreeDataProvider<PackageItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<PackageItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private items: PackageItem[] = [];
    private statusCache = new Map<string, { context: string, icon: vscode.ThemeIcon | undefined }>();

    async refresh(item?: PackageItem): Promise<void> { 
        this._onDidChangeTreeData.fire(item); 
    }

    updateStatus(label: string, exitCode: number | undefined, isManual: boolean) {
        const item = this.items.find(i => i.label === label);
        if (item) {
            isManual ? item.resetStatus() : item.setFinished(exitCode);
            this.saveStatusToCache(item);
            this.refresh(item);
        }
    }

    saveStatusToCache(item: PackageItem) {
        if (item.contextValue === 'info') {return;}
        const key = `${item.scriptUri?.fsPath}|${item.label}`;
        this.statusCache.set(key, { context: item.contextValue, icon: item.iconPath as vscode.ThemeIcon });
    }

    getTreeItem(element: PackageItem): vscode.TreeItem { return element; }

    async getChildren(element?: PackageItem): Promise<PackageItem[]> {
        if (!element) {
            this.items = [];
            const files = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**');
            
            if (files.length === 0) {
                return [new PackageItem(
                    "No projects found", 
                    vscode.TreeItemCollapsibleState.None, 
                    "info"
                )];
            }

            const result = await Promise.all(files.map(async (uri) => {
                try {
                    const doc = await vscode.workspace.openTextDocument(uri);
                    const content = JSON.parse(doc.getText());
                    if (!content.scripts || Object.keys(content.scripts).length === 0) {return null;}
                    return new PackageItem(path.basename(path.dirname(uri.fsPath)) || 'root', vscode.TreeItemCollapsibleState.Expanded, 'package', uri);
                } catch { return null; }
            }));
            return result.filter((item): item is PackageItem => item !== null);
        }

        if (element.contextValue === 'package' && element.scriptUri) {
            const doc = await vscode.workspace.openTextDocument(element.scriptUri);
            const content = JSON.parse(doc.getText());
            const scripts = content.scripts || {};
            const scriptItems = Object.keys(scripts).map(label => {
                const item = new PackageItem(label, vscode.TreeItemCollapsibleState.None, 'script', element.scriptUri, scripts[label]);
                const key = `${element.scriptUri?.fsPath}|${label}`;
                const cached = this.statusCache.get(key);
                if (cached) { item.contextValue = cached.context; item.iconPath = cached.icon; }
                return item;
            });
            this.items.push(...scriptItems);
            return scriptItems;
        }
        return [];
    }
}

// --- TREE ITEM CLASS ---
export class PackageItem extends vscode.TreeItem {
    public readonly scriptUri?: vscode.Uri;

    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public contextValue: string,
        _uri?: vscode.Uri,
        public readonly scriptValue?: string
    ) {
        super(label, collapsibleState);
        this.scriptUri = _uri;
        
        if (this.contextValue === 'package') {
            this.iconPath = new vscode.ThemeIcon('package');
        } else if (this.contextValue === 'info') {
            // Appearance for the "No projects found" message
            this.iconPath = new vscode.ThemeIcon('info');
            this.description = "open a folder with package.json";
        } else {
            this.resetStatus();
        }
    }

    resetStatus() {
        if (this.contextValue === 'script' || this.contextValue === 'script-running') {
            this.contextValue = 'script';
            this.iconPath = new vscode.ThemeIcon('code');
            this.description = this.scriptValue;
            this.command = { command: 'npm-commander.focusTerminal', title: 'Focus', arguments: [this] };
        }
    }

    setRunning() {
        this.contextValue = 'script-running';
        this.iconPath = new vscode.ThemeIcon('sync~spin');
    }

    setFinished(exitCode: number | undefined) {
        this.contextValue = 'script';
        if (exitCode === 0) {
            this.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
        } else {
            this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconErrored'));
        }
    }
}
