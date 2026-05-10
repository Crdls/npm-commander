# NPM Commander 🚀

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
