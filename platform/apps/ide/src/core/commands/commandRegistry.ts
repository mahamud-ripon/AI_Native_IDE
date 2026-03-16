export interface Command {
  id: string;
  label: string;
  category?: string;
  shortcut?: string;
  action: () => void | Promise<void>;
}

class CommandRegistry {
  private commands = new Map<string, Command>();
  private listeners = new Set<() => void>();

  /**
   * Register a command.
   */
  register(command: Command): void {
    this.commands.set(command.id, command);
    this.notifyListeners();
  }

  /**
   * Unregister a command by ID.
   */
  unregister(id: string): void {
    this.commands.delete(id);
    this.notifyListeners();
  }

  /**
   * Get a command by ID.
   */
  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  /**
   * Get all commands.
   */
  getAll(): Command[] {
    return Array.from(this.commands.values());
  }

  /**
   * Get commands grouped by category.
   */
  getGrouped(): Map<string, Command[]> {
    const groups = new Map<string, Command[]>();
    for (const cmd of this.commands.values()) {
      const category = cmd.category || 'General';
      const list = groups.get(category) || [];
      list.push(cmd);
      groups.set(category, list);
    }
    return groups;
  }

  /**
   * Execute a command by ID.
   */
  async execute(id: string): Promise<boolean> {
    const command = this.commands.get(id);
    if (!command) {
      console.warn(`Command not found: ${id}`);
      return false;
    }
    try {
      await command.action();
      return true;
    } catch (err) {
      console.error(`Command execution failed: ${id}`, err);
      return false;
    }
  }

  /**
   * Search commands by label.
   */
  search(query: string): Command[] {
    const lower = query.toLowerCase();
    return this.getAll().filter(cmd =>
      cmd.label.toLowerCase().includes(lower) ||
      cmd.id.toLowerCase().includes(lower) ||
      cmd.category?.toLowerCase().includes(lower)
    );
  }

  /**
   * Subscribe to command registry changes.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const commandRegistry = new CommandRegistry();

// Register core commands
commandRegistry.register({
  id: 'editor.format',
  label: 'Format Document',
  category: 'Editor',
  shortcut: 'Shift+Alt+F',
  action: () => {
    console.log('[command] Format document');
  },
});

commandRegistry.register({
  id: 'editor.save',
  label: 'Save File',
  category: 'Editor',
  shortcut: 'Ctrl+S',
  action: () => {
    console.log('[command] Save file');
  },
});

commandRegistry.register({
  id: 'terminal.toggle',
  label: 'Toggle Terminal',
  category: 'View',
  shortcut: 'Ctrl+`',
  action: () => {
    console.log('[command] Toggle terminal');
  },
});

commandRegistry.register({
  id: 'panel.explorer',
  label: 'Show Explorer',
  category: 'View',
  action: () => {
    console.log('[command] Show explorer');
  },
});

commandRegistry.register({
  id: 'panel.sourceControl',
  label: 'Show Source Control',
  category: 'View',
  action: () => {
    console.log('[command] Show source control');
  },
});

commandRegistry.register({
  id: 'git.commit',
  label: 'Git: Commit',
  category: 'Git',
  action: () => {
    console.log('[command] Git commit');
  },
});

commandRegistry.register({
  id: 'git.push',
  label: 'Git: Push',
  category: 'Git',
  action: () => {
    console.log('[command] Git push');
  },
});

commandRegistry.register({
  id: 'git.pull',
  label: 'Git: Pull',
  category: 'Git',
  action: () => {
    console.log('[command] Git pull');
  },
});

commandRegistry.register({
  id: 'git.status',
  label: 'Git: Show Status',
  category: 'Git',
  action: () => {
    console.log('[command] Git status');
  },
});

commandRegistry.register({
  id: 'preview.refresh',
  label: 'Refresh Preview',
  category: 'Preview',
  action: () => {
    console.log('[command] Refresh preview');
  },
});

commandRegistry.register({
  id: 'app.reload',
  label: 'Reload IDE',
  category: 'App',
  action: () => {
    window.location.reload();
  },
});
