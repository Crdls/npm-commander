import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    const provider = new PackageJsonProvider();
    vscode.window.registerTreeDataProvider('npm-commander-main', provider);

    const activeExecutions = new Map<string, vscode.TaskExecution>();
    const manuallyStopped = new Set<string>();

    // 1. Команда ЗАПУСКА (с исправленной фокусировкой)
const runCommand = vscode.commands.registerCommand('npm-commander.runNpmScript', async (item: PackageItem) => {
    if (!item || !item.resourceUri) return;

    const termName = `npm: ${item.label}`;
    
    // Сначала ищем и показываем, если он есть
    const existingTerminal = vscode.window.terminals.find(t => t.name === termName);
    if (existingTerminal) {
        existingTerminal.show(false); // false позволяет забрать фокус себе
    }

    const folder = path.dirname(item.resourceUri.fsPath);
    const task = new vscode.Task(
        { type: 'npm', script: item.label },
        vscode.TaskScope.Workspace,
        item.label,
        'npm',
        new vscode.ShellExecution(`npm run ${item.label}`, { cwd: folder })
    );

    item.setRunning();
    provider.refresh(item);

    const execution = await vscode.tasks.executeTask(task);
    activeExecutions.set(item.label, execution);
});

// 2. Команда ФОКУСИРОВКИ (улучшенный поиск)
const focusCommand = vscode.commands.registerCommand('npm-commander.focusTerminal', (item: PackageItem) => {
    if (!item) return;
    
    const termName = `npm: ${item.label}`;
    
    // Ищем терминал, имя которого СОДЕРЖИТ название скрипта 
    // (иногда задачи именуются "Task: npm: dev")
    const terminal = vscode.window.terminals.find(t => 
        t.name === termName || t.name.endsWith(`: ${item.label}`)
    );
    
    if (terminal) {
        terminal.show(false); // false принудительно переносит фокус в терминал
    } else {
        vscode.window.setStatusBarMessage(`Скрипт "${item.label}" не запущен`, 3000);
    }
});



    // 3. Команда ОСТАНОВКИ
    const stopCommand = vscode.commands.registerCommand('npm-commander.stopScript', (item: PackageItem) => {
        const execution = activeExecutions.get(item.label);
        if (execution) {
            manuallyStopped.add(item.label);
            execution.terminate();
            activeExecutions.delete(item.label);
        }
    });

    // 4. СЛЕЖКА ЗА ЗАВЕРШЕНИЕМ
    const taskEndWatcher = vscode.tasks.onDidEndTaskProcess(e => {
        const scriptName = e.execution.task.name;
        const exitCode = e.exitCode;

        const isInterrupted = 
            exitCode === undefined || 
            exitCode === 130 || 
            exitCode === -1073741510 || 
            exitCode === 3221225786;

        if (manuallyStopped.has(scriptName) || isInterrupted) {
            provider.updateStatus(scriptName, undefined, true);
            manuallyStopped.delete(scriptName);
        } else {
            provider.updateStatus(scriptName, exitCode, false);
        }
        activeExecutions.delete(scriptName);
    });

    context.subscriptions.push(runCommand, focusCommand, stopCommand, taskEndWatcher);
}

// --- ПРОВАЙДЕР ДАННЫХ ---
export class PackageJsonProvider implements vscode.TreeDataProvider<PackageItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<PackageItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private items: PackageItem[] = [];

    refresh(item?: PackageItem): void {
        this._onDidChangeTreeData.fire(item);
    }

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
                    if (!content.scripts || Object.keys(content.scripts).length === 0) return null;
                    return new PackageItem(path.basename(path.dirname(uri.fsPath)) || 'root', vscode.TreeItemCollapsibleState.Expanded, 'package', uri);
                } catch { return null; }
            }));
            return result.filter((item): item is PackageItem => item !== null);
        }

        if (element.contextValue === 'package' && element.resourceUri) {
            const doc = await vscode.workspace.openTextDocument(element.resourceUri);
            const content = JSON.parse(doc.getText());
            const scripts = content.scripts || {};
            const scriptItems = Object.keys(scripts).map(label => 
                new PackageItem(label, vscode.TreeItemCollapsibleState.None, 'script', element.resourceUri, scripts[label])
            );
            this.items.push(...scriptItems);
            return scriptItems;
        }
        return [];
    }
}

// --- ЭЛЕМЕНТ ДЕРЕВА ---
export class PackageItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public contextValue: string,
        public readonly resourceUri?: vscode.Uri,
        public readonly scriptValue?: string
    ) {
        super(label, collapsibleState);
        this.resetStatus();
    }

    resetStatus() {
        if (this.contextValue !== 'package') {
            this.contextValue = 'script';
            this.iconPath = new vscode.ThemeIcon('code');
            this.description = this.scriptValue;
            // Назначаем команду фокусировки на основной клик
            this.command = {
                command: 'npm-commander.focusTerminal',
                title: 'Focus Terminal',
                arguments: [this]
            };
        } else {
            this.iconPath = new vscode.ThemeIcon('package');
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
