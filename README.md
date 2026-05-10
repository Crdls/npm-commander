# NPM Commander for VS Code

A straightforward sidebar for managing scripts from your `package.json` files. It provides a visual list of available commands and simplifies switching between their respective terminals.

## Key Features ✨

- **Command List**: Automatically scans the workspace and displays scripts grouped by project folders.
- **Terminal Management**: 
    - Runs scripts in dedicated terminals.
    - Stops processes while keeping the terminal window open to preserve output history.
    - Focuses the corresponding terminal when clicking on a script name in the list.
- **Status Indicators** 📊: 
    - 🔄 **Spinning icon** while a task is running.
    - ✅ **Status icons** for finished tasks (success or error).
    - 🔄 **Status reset** when a task is interrupted by the user (Ctrl+C).

## Installation 📦

### From GitHub Releases (Manual)
1. Download the latest `.vsix` file from the [Releases](https://github.com/Crdls/npm-commander/releases) page.
2. Open **VS Code**.
3. Go to the **Extensions** view (`Ctrl+Shift+X`).
4. Click the **"..."** (Views and More Actions) in the top right corner.
5. Select **Install from VSIX...** and choose the downloaded file.

### Via Command Line
If you have the `code` binary in your PATH:
```bash
code --install-extension npm-commander-1.0.0.vsix
```

## Usage 🛠

The **NPM Commander** panel is located in the Activity Bar.
- To start a script, use the **Play** button that appears on the right when hovering over an item.
- To stop a script, use the **Stop** button in the same location.
- To quickly locate a terminal tab among many open ones, click on the script name in the list.

## Technical Details ⚙️

- Scan subfolders, supports mulitple package.json files.
- Excludes `node_modules` from scanning for better performance.
- Built on top of the standard VS Code Tasks API.
- Clean UI.

## License: MIT
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
