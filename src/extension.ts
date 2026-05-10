import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    const provider = new PackageJsonProvider();
    vscode.window.registerTreeDataProvider('npm-commander-main', provider);

    // 1. Команда ЗАПУСКА
    const runCommand = vscode.commands.registerCommand('npm-commander.runNpmScript', (item: PackageItem) => {
        if (!item || !item.resourceUri) return;

        const termName = `npm: ${item.label}`;
        const folder = path.dirname(item.resourceUri.fsPath);

        // Ищем существующий терминал или создаем новый
        let terminal = vscode.window.terminals.find(t => t.name === termName);
        if (!terminal) {
            terminal = vscode.window.createTerminal({ name: termName, cwd: folder });
        }

        terminal.show();
        terminal.sendText(`npm run ${item.label}`);

        // Меняем состояние на "запущено", чтобы показать кнопку STOP
        item.setRunning(true);
        provider.refresh(item);
    });

    // 2. Команда ОСТАНОВКИ
    const stopCommand = vscode.commands.registerCommand('npm-commander.stopScript', (item: PackageItem) => {
        if (!item) return;

        const termName = `npm: ${item.label}`;
        const terminal = vscode.window.terminals.find(t => t.name === termName);
        
        if (terminal) {
            // В VS Code нельзя программно послать Ctrl+C, но можно закрыть терминал
            terminal.dispose(); 
        }

        item.setRunning(false);
        provider.refresh(item);
    });

    // Обработка закрытия терминала пользователем вручную
    const terminalWatcher = vscode.window.onDidCloseTerminal(terminal => {
        // При желании здесь можно найти нужный item и вызвать setRunning(false), 
        // но для простоты мы сбросим всё дерево или обновим его
        provider.refresh();
    });

    context.subscriptions.push(runCommand, stopCommand, terminalWatcher);
}

// --- ПРОВАЙДЕР ДАННЫХ ---
export class PackageJsonProvider implements vscode.TreeDataProvider<PackageItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<PackageItem | undefined | null | void> = new vscode.EventEmitter<PackageItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<PackageItem | undefined | null | void> = this._onDidChangeTreeData.event;

    // Метод для принудительного обновления дерева
    refresh(item?: PackageItem): void {
        this._onDidChangeTreeData.fire(item);
    }

    getTreeItem(element: PackageItem): vscode.TreeItem { return element; }

    async getChildren(element?: PackageItem): Promise<PackageItem[]> {
        if (!element) {
            const files = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**');
            const items = await Promise.all(files.map(async (uri) => {
                try {
                    const doc = await vscode.workspace.openTextDocument(uri);
                    const content = JSON.parse(doc.getText());
                    if (!content.scripts || Object.keys(content.scripts).length === 0) return null;
                    return new PackageItem(path.basename(path.dirname(uri.fsPath)) || 'root', vscode.TreeItemCollapsibleState.Expanded, 'package', uri);
                } catch { return null; }
            }));
            return items.filter((item): item is PackageItem => item !== null);
        }

        if (element.contextValue === 'package' && element.resourceUri) {
            const doc = await vscode.workspace.openTextDocument(element.resourceUri);
            const content = JSON.parse(doc.getText());
            const scripts = content.scripts || {};
            return Object.keys(scripts).map(label => new PackageItem(label, vscode.TreeItemCollapsibleState.None, 'script', element.resourceUri, scripts[label]));
        }
        return [];
    }
}

// --- ЭЛЕМЕНТ ДЕРЕВА ---
export class PackageItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public contextValue: string, // Убрали readonly, чтобы менять на лету
        public readonly resourceUri?: vscode.Uri,
        public readonly scriptValue?: string
    ) {
        super(label, collapsibleState);
        this.iconPath = contextValue === 'package' ? new vscode.ThemeIcon('package') : new vscode.ThemeIcon('code');
        this.description = this.scriptValue;
    }

    // Метод переключения контекста для package.json (when clauses)
    setRunning(isRunning: boolean) {
        if (this.contextValue !== 'package') {
            this.contextValue = isRunning ? 'script-running' : 'script';
            this.iconPath = isRunning ? new vscode.ThemeIcon('sync~spin') : new vscode.ThemeIcon('code');
        }
    }
}
