import * as vscode from 'vscode';
import * as path from 'path'; 

export function activate(context: vscode.ExtensionContext) {
    const provider = new PackageJsonProvider();
    vscode.window.registerTreeDataProvider('npm-commander-main', provider);

    const activeExecutions = new Map<string, vscode.TaskExecution>();
    const scriptTerminals = new Map<string, vscode.Terminal>();
    const manuallyStopped = new Set<string>();

    // Привязка терминала к скрипту при старте задачи
    const taskStartWatcher = vscode.tasks.onDidStartTask(e => {
        const scriptName = e.execution.task.name;
        const terminal = vscode.window.terminals.find(t => 
            t.name === `npm: ${scriptName}` || t.name === scriptName
        );
        if (terminal) {
            scriptTerminals.set(scriptName, terminal);
        }
    });

    const runCommand = vscode.commands.registerCommand('npm-commander.runNpmScript', async (item: PackageItem) => {
        const uri = item.scriptUri || item.resourceUri;
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
        provider.refresh(item);

        const execution = await vscode.tasks.executeTask(task);
        activeExecutions.set(item.label, execution);
    });

    const focusCommand = vscode.commands.registerCommand('npm-commander.focusTerminal', (item: PackageItem) => {
        if (!item) {return;}
        const terminal = scriptTerminals.get(item.label) || vscode.window.terminals.find(t => t.name === item.label);
        if (terminal) {
            terminal.show(false);
        } else {
            vscode.window.setStatusBarMessage(`Скрипт "${item.label}" еще не запущен`, 3000);
        }
    });

    const stopCommand = vscode.commands.registerCommand('npm-commander.stopScript', (item: PackageItem) => {
        manuallyStopped.add(item.label);
        const terminal = scriptTerminals.get(item.label) || vscode.window.terminals.find(t => t.name === item.label);
        
        if (terminal) {
            terminal.sendText('\u0003'); 
            terminal.show(false);
        }

        activeExecutions.delete(item.label);
        item.resetStatus();
        provider.refresh(item);
    });

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

    const openPackageCommand = vscode.commands.registerCommand('npm-commander.openPackageJson', (item: PackageItem) => {
        const uri = item.scriptUri;
        if (uri) {
            vscode.window.showTextDocument(uri);
        }
    });

    context.subscriptions.push(
        taskStartWatcher, runCommand, focusCommand, stopCommand, taskEndWatcher, openPackageCommand
    );
}

export class PackageJsonProvider implements vscode.TreeDataProvider<PackageItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<PackageItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private items: PackageItem[] = [];

    refresh(item?: PackageItem): void { this._onDidChangeTreeData.fire(item); }

    updateStatus(label: string, exitCode: number | undefined, isManual: boolean) {
        const item = this.items.find(i => i.label === label);
        if (item) {
            isManual ? item.resetStatus() : item.setFinished(exitCode);
            this.refresh(item);
        }
    }

    getTreeItem(element: PackageItem): vscode.TreeItem { return element; }

    async getChildren(element?: PackageItem): Promise<PackageItem[]> {
        if (!element) {
            this.items = [];
            const files = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**');
            const result = await Promise.all(files.map(async (uri) => {
                try {
                    const doc = await vscode.workspace.openTextDocument(uri);
                    const content = JSON.parse(doc.getText());
                    if (!content.scripts || Object.keys(content.scripts).length === 0) {return null;}
                    // Для папок убираем resourceUri, чтобы не было "U" рядом с названием проекта
                    return new PackageItem(path.basename(path.dirname(uri.fsPath)) || 'root', vscode.TreeItemCollapsibleState.Expanded, 'package', uri);
                } catch { return null; }
            }));
            return result.filter((item): item is PackageItem => item !== null);
        }

        if (element.contextValue === 'package' && element.scriptUri) {
            const doc = await vscode.workspace.openTextDocument(element.scriptUri);
            const content = JSON.parse(doc.getText());
            const scripts = content.scripts || {};
            const scriptItems = Object.keys(scripts).map(label => 
                new PackageItem(label, vscode.TreeItemCollapsibleState.None, 'script', element.scriptUri, scripts[label])
            );
            this.items.push(...scriptItems);
            return scriptItems;
        }
        return [];
    }
}

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
            this.scriptUri = _uri;
            this.iconPath = new vscode.ThemeIcon('package');
            this.command = undefined; 
        } else {
            this.resetStatus();
        }
    }

    resetStatus() {
        if (this.contextValue !== 'package') {
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