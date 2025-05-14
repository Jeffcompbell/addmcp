import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 表示MCP服务器数据的接口
interface McpServer {
  command: string;
  args?: string[];
  env?: { [key: string]: string };
  [key: string]: any;
}

// 表示MCP配置的接口
interface McpConfig {
  mcpServers: { [key: string]: McpServer };
  [key: string]: any;
}

// 表示树视图中的MCP服务器项
class McpServerTreeItem extends vscode.TreeItem {
  constructor(
    public readonly serverName: string,
    public readonly server: McpServer,
    public readonly index: number,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    super(serverName, collapsibleState);
    
    this.tooltip = `${serverName}\n命令: ${server.command}\n参数: ${(server.args || []).join(' ')}`;
    this.description = server.command;
    this.iconPath = new vscode.ThemeIcon('server');
    this.contextValue = 'mcpServer';
  }
}

// MCP服务器树视图数据提供者
class McpServersProvider implements vscode.TreeDataProvider<McpServerTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<McpServerTreeItem | undefined | null | void> = new vscode.EventEmitter<McpServerTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<McpServerTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
  
  private currentFilePath: string | undefined;
  private servers: { name: string; server: McpServer; index: number }[] = [];
  private filteredServers: { name: string; server: McpServer; index: number }[] = [];
  private _searchQuery: string = '';
  
  constructor() {
    this.currentFilePath = undefined;
  }
  
  // 获取当前搜索查询
  get searchQuery(): string {
    return this._searchQuery;
  }
  
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
  
  // 当用户搜索时设置搜索文本
  setSearchQuery(query: string): void {
    this._searchQuery = query || '';
    this.applyFilter();
    
    // 设置搜索状态上下文，控制清除搜索按钮的显示
    vscode.commands.executeCommand('setContext', 'addmcp:hasSearchFilter', !!this._searchQuery);
  }
  
  // 清除搜索
  clearSearch(): void {
    this._searchQuery = '';
    this.applyFilter();
    vscode.commands.executeCommand('setContext', 'addmcp:hasSearchFilter', false);
  }
  
  // 内部方法：应用过滤逻辑
  private applyFilter(): void {
    if (!this._searchQuery || this._searchQuery.trim() === '') {
      // 如果没有搜索查询，显示所有服务器
      this.filteredServers = [...this.servers];
    } else {
      // 如果有搜索查询，过滤服务器
      const query = this._searchQuery.toLowerCase();
      this.filteredServers = this.servers.filter(server => {
        const serverName = server.name.toLowerCase();
        const command = server.server.command.toLowerCase();
        
        // 检查名称和命令是否包含查询字符串
        return serverName.includes(query) || command.includes(query);
      });
    }
    
    // 通知树视图更新
    this.refresh();
  }
  
  setCurrentFile(filePath: string): void {
    this.currentFilePath = filePath;
    this.loadServers();
    
    // 重置搜索状态
    this._searchQuery = '';
    vscode.commands.executeCommand('setContext', 'addmcp:hasSearchFilter', false);
  }
  
  getCurrentFilePath(): string | undefined {
    return this.currentFilePath;
  }
  
  getTreeItem(element: McpServerTreeItem): vscode.TreeItem {
    return element;
  }
  
  getChildren(element?: McpServerTreeItem): Thenable<McpServerTreeItem[]> {
    if (element) {
      return Promise.resolve([]);
    }
    
    return Promise.resolve(
      this.filteredServers.map(server => new McpServerTreeItem(server.name, server.server, server.index))
    );
  }
  
  loadServers(): void {
    this.servers = [];
    this.filteredServers = [];
    
    if (!this.currentFilePath || !fs.existsSync(this.currentFilePath)) {
      this.refresh();
      return;
    }
    
    try {
      const fileContent = fs.readFileSync(this.currentFilePath, 'utf8');
      let config: McpConfig;
      
      try {
        config = JSON.parse(fileContent);
      } catch (e) {
        // 如果解析失败，尝试合并多个JSON对象
        const mergedJson = findAndMergeJsonObjects(fileContent);
        if (mergedJson) {
          config = JSON.parse(mergedJson);
        } else {
          vscode.window.showErrorMessage('无法解析当前文件的JSON内容');
          return;
        }
      }
      
      if (config.mcpServers) {
        this.servers = Object.entries(config.mcpServers).map(([name, server], index) => ({
          name,
          server,
          index
        }));
        
        // 应用过滤
        this.filteredServers = [...this.servers];
      }
      
      this.refresh();
    } catch (e) {
      console.error('加载服务器失败:', e);
      vscode.window.showErrorMessage('加载MCP服务器失败: ' + e);
    }
  }
  
  // 删除指定的服务器
  async deleteServer(serverItem: McpServerTreeItem): Promise<boolean> {
    if (!this.currentFilePath) {
      vscode.window.showErrorMessage('没有活动的JSON文件');
      return false;
    }
    
    try {
      const confirmation = await vscode.window.showWarningMessage(
        `确定要删除 ${serverItem.serverName} 服务器吗？`,
        { modal: true },
        '确定',
        '取消'
      );
      
      if (confirmation !== '确定') {
        return false;
      }
      
      const fileContent = fs.readFileSync(this.currentFilePath, 'utf8');
      let config: McpConfig;
      
      try {
        config = JSON.parse(fileContent);
      } catch (e) {
        const mergedJson = findAndMergeJsonObjects(fileContent);
        if (mergedJson) {
          config = JSON.parse(mergedJson);
        } else {
          vscode.window.showErrorMessage('无法解析当前文件的JSON内容');
          return false;
        }
      }
      
      if (config.mcpServers && config.mcpServers[serverItem.serverName]) {
        // 删除服务器
        delete config.mcpServers[serverItem.serverName];
        
        // 写回文件
        fs.writeFileSync(this.currentFilePath, JSON.stringify(config, null, 2), 'utf8');
        
        // 重新加载
        this.loadServers();
        
        vscode.window.showInformationMessage(`已成功删除 ${serverItem.serverName} 服务器`);
        return true;
      } else {
        vscode.window.showErrorMessage(`未找到 ${serverItem.serverName} 服务器`);
        return false;
      }
    } catch (e) {
      console.error('删除服务器失败:', e);
      vscode.window.showErrorMessage('删除服务器失败: ' + e);
      return false;
    }
  }
  
  // 移动服务器位置（上移或下移）
  async moveServer(serverItem: McpServerTreeItem, direction: 'up' | 'down'): Promise<boolean> {
    if (!this.currentFilePath) {
      vscode.window.showErrorMessage('没有活动的JSON文件');
      return false;
    }
    
    try {
      // 找到服务器在数组中的位置
      const index = this.servers.findIndex(s => s.name === serverItem.serverName);
      if (index === -1) {
        vscode.window.showErrorMessage(`未找到 ${serverItem.serverName} 服务器`);
        return false;
      }
      
      // 计算目标位置
      let targetIndex: number;
      if (direction === 'up') {
        targetIndex = Math.max(0, index - 1);
        if (targetIndex === index) {
          // 已经在顶部
          return false;
        }
      } else {
        targetIndex = Math.min(this.servers.length - 1, index + 1);
        if (targetIndex === index) {
          // 已经在底部
          return false;
        }
      }
      
      // 读取文件
      const fileContent = fs.readFileSync(this.currentFilePath, 'utf8');
      let config: McpConfig;
      
      try {
        config = JSON.parse(fileContent);
      } catch (e) {
        const mergedJson = findAndMergeJsonObjects(fileContent);
        if (mergedJson) {
          config = JSON.parse(mergedJson);
        } else {
          vscode.window.showErrorMessage('无法解析当前文件的JSON内容');
          return false;
        }
      }
      
      // 重新排序服务器
      if (config.mcpServers) {
        // 创建一个新的有序对象来存储重排后的服务器
        const orderedServers: { [key: string]: McpServer } = {};
        
        // 获取所有服务器名称
        const serverNames = Object.keys(config.mcpServers);
        
        // 交换位置
        [serverNames[index], serverNames[targetIndex]] = [serverNames[targetIndex], serverNames[index]];
        
        // 按新顺序重建对象
        serverNames.forEach(name => {
          orderedServers[name] = config.mcpServers[name];
        });
        
        // 更新配置
        config.mcpServers = orderedServers;
        
        // 写回文件
        fs.writeFileSync(this.currentFilePath, JSON.stringify(config, null, 2), 'utf8');
        
        // 重新加载
        this.loadServers();
        
        return true;
      }
      
      return false;
    } catch (e) {
      console.error('移动服务器失败:', e);
      vscode.window.showErrorMessage('移动服务器失败: ' + e);
      return false;
    }
  }
}

/**
 * 合并两个mcpServers对象
 */
function mergeMcpServers(target: any, source: any): any {
  const merged = { ...target };
  
  if (source && source.mcpServers) {
    if (!merged.mcpServers) {
      merged.mcpServers = {};
    }
    
    // 合并mcpServers对象
    Object.keys(source.mcpServers).forEach(key => {
      // 检查目标对象中是否已存在同名服务器配置
      if (!merged.mcpServers[key]) {
        // 如果不存在，直接添加
      merged.mcpServers[key] = source.mcpServers[key];
      } else {
        // 如果存在，合并其属性，确保不丢失任何配置
        merged.mcpServers[key] = { 
          ...merged.mcpServers[key], 
          ...source.mcpServers[key] 
        };
        
        // 特殊处理数组类型的属性，比如args，确保正确合并
        if (Array.isArray(source.mcpServers[key].args) && Array.isArray(merged.mcpServers[key].args)) {
          // 使用新的args数组替换旧的
          merged.mcpServers[key].args = [...source.mcpServers[key].args];
        }
      }
    });
  }
  
  // 合并其它可能存在的非mcpServers属性
  Object.keys(source || {}).forEach(key => {
    if (key !== 'mcpServers') {
      merged[key] = source[key];
    }
  });
  
  return merged;
}

/**
 * 检查文本是否包含有效的JSON对象
 */
function isValidJSON(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 获取Cursor MCP文件的路径
 */
function getCursorMcpPath(): string {
  const homedir = os.homedir();
  return path.join(homedir, '.cursor', 'mcp.json');
}

/**
 * 显示状态栏消息
 */
function showStatusMessage(message: string, timeout: number = 3000): vscode.Disposable {
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  statusBarItem.text = `$(sync~spin) ${message}`;
  statusBarItem.show();
  
  const disposable = setTimeout(() => {
    statusBarItem.dispose();
  }, timeout);
  
  return {
    dispose: () => {
      clearTimeout(disposable);
      statusBarItem.dispose();
    }
  };
}

/**
 * 查找并合并文档中的多个JSON对象
 */
function findAndMergeJsonObjects(text: string): string | null {
  try {
    console.log("开始合并JSON对象...");
    
    // 使用正则表达式匹配文档中的JSON对象
    // 注意: 这个正则表达式会尝试匹配完整的JSON对象，包括嵌套的大括号
    const jsonRegex = /(\{(?:[^{}]|(?:\{(?:[^{}]|(?:\{[^{}]*\}))*\}))*\})/g;
    const matches = text.match(jsonRegex);
    
    console.log(`找到 ${matches?.length || 0} 个可能的JSON对象`);
    
    if (!matches || matches.length < 1) {
      console.log("没有找到任何JSON对象");
      return null; // 如果没有找到任何JSON对象，则返回null
    }

    // 收集所有有效的JSON对象
    const validObjects: any[] = [];
    
    for (const match of matches) {
      try {
        console.log(`尝试解析JSON: ${match.substring(0, 50)}...`);
        
        // 这里去除可能的注释和多余空白
        const cleanedMatch = match.replace(/\/\/.*$/gm, '').trim();
        
        if (isValidJSON(cleanedMatch)) {
          const obj = JSON.parse(cleanedMatch);
          console.log(`成功解析JSON对象: ${JSON.stringify(obj).substring(0, 50)}...`);
          validObjects.push(obj);
        } else {
          console.log(`不是有效的JSON: ${cleanedMatch.substring(0, 50)}...`);
        }
      } catch (e) {
        console.error('无法解析JSON对象', e);
      }
    }
    
    console.log(`找到 ${validObjects.length} 个有效的JSON对象`);
    
    if (validObjects.length < 1) {
      console.log("没有有效的JSON对象");
      return null; // 没有有效的JSON对象
    }
    
    // 从第一个对象开始合并
    let targetObj = validObjects[0];
    console.log(`使用第一个对象作为基础: ${JSON.stringify(targetObj).substring(0, 50)}...`);
    
    // 合并其余对象
    for (let i = 1; i < validObjects.length; i++) {
      console.log(`合并第 ${i+1} 个对象...`);
      targetObj = mergeMcpServers(targetObj, validObjects[i]);
    }
    
    // 返回合并后的JSON字符串（美化格式）
    const result = JSON.stringify(targetObj, null, 2);
    console.log(`合并完成，结果: ${result.substring(0, 50)}...`);
    return result;
  } catch (e) {
    console.error('处理JSON时出错', e);
    return null;
  }
}

/**
 * 使用更暴力的方法提取和合并JSON对象
 * 该方法尝试提取每个独立的JSON对象，并忽略文件中的其它内容
 */
function extractAndMergeJsons(text: string): string | null {
  try {
    console.log("使用备用方法提取JSON...");
    
    // 将文本分割成行
    const lines = text.split('\n');
    let jsonBlocks: string[] = [];
    let currentBlock = '';
    let openBraces = 0;
    
    // 遍历每一行，构建JSON块
    for (const line of lines) {
      // 计算当前行中的开括号和闭括号数量
      const openCount = (line.match(/\{/g) || []).length;
      const closeCount = (line.match(/\}/g) || []).length;
      
      openBraces += openCount - closeCount;
      currentBlock += line + '\n';
      
      // 如果括号平衡了，说明一个JSON块结束
      if (openBraces === 0 && currentBlock.trim().length > 0) {
        jsonBlocks.push(currentBlock.trim());
        currentBlock = '';
      }
    }
    
    console.log(`提取出 ${jsonBlocks.length} 个可能的JSON块`);
    
    // 解析每个块并收集有效的JSON对象
    const validObjects: any[] = [];
    
    for (const block of jsonBlocks) {
      try {
        if (isValidJSON(block)) {
          const obj = JSON.parse(block);
          console.log(`成功解析JSON块: ${JSON.stringify(obj).substring(0, 50)}...`);
          validObjects.push(obj);
        }
      } catch (e) {
        console.log(`无法解析JSON块: ${block.substring(0, 50)}...`);
      }
    }
    
    console.log(`找到 ${validObjects.length} 个有效的JSON对象`);
    
    if (validObjects.length < 1) {
      return null;
    }
    
    // 合并对象
    let targetObj = validObjects[0];
    
    for (let i = 1; i < validObjects.length; i++) {
      targetObj = mergeMcpServers(targetObj, validObjects[i]);
    }
    
    return JSON.stringify(targetObj, null, 2);
  } catch (e) {
    console.error('提取JSON块时出错', e);
    return null;
  }
}

/**
 * 检查文档是否是mcp.json文件
 */
function isMcpJsonFile(document: vscode.TextDocument): boolean {
  return document.fileName.endsWith('mcp.json');
}

/**
 * 检查并确保Cursor目录存在
 */
function ensureCursorDirExists(): void {
  const homedir = os.homedir();
  const cursorDir = path.join(homedir, '.cursor');
  
  if (!fs.existsSync(cursorDir)) {
    fs.mkdirSync(cursorDir, { recursive: true });
    console.log('已创建.cursor目录');
  }
}

/**
 * 获取Cursor MCP文件的Uri
 */
function getCursorMcpUri(): vscode.Uri {
  ensureCursorDirExists();
  return vscode.Uri.file(getCursorMcpPath());
}

/**
 * 查找Cursor的mcp.json文件，如果不存在则返回项目中的第一个
 */
async function findMcpJsonFile(): Promise<vscode.Uri> {
  const cursorMcpPath = getCursorMcpPath();
  
  // 优先使用~/.cursor/mcp.json
  if (fs.existsSync(cursorMcpPath)) {
    console.log('找到Cursor MCP文件:', cursorMcpPath);
    return vscode.Uri.file(cursorMcpPath);
  }
  
  // 如果不存在，则在工作区中查找
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    for (const folder of workspaceFolders) {
      const filePattern = new vscode.RelativePattern(folder, '**/mcp.json');
      const files = await vscode.workspace.findFiles(filePattern, '**/node_modules/**', 1);
      
      if (files.length > 0) {
        console.log('找到项目MCP文件:', files[0].fsPath);
        return files[0];
      }
    }
  }
  
  // 如果都找不到，返回~/.cursor/mcp.json的Uri（即使不存在）
  console.log('未找到MCP文件，将创建:', cursorMcpPath);
  return getCursorMcpUri();
}

/**
 * 创建或更新mcp.json文件
 */
async function updateMcpJsonFile(jsonContent: string): Promise<vscode.Uri> {
  // 显示状态消息
  const statusMessage = showStatusMessage('更新MCP配置中...');
  
  try {
    // 始终使用~/.cursor/mcp.json
    const mcpJsonUri = getCursorMcpUri();
    
    let currentContent = '';
    let fileExists = false;
    
    // 检查文件是否存在并读取内容
    try {
      if (fs.existsSync(mcpJsonUri.fsPath)) {
        currentContent = fs.readFileSync(mcpJsonUri.fsPath, 'utf8');
        fileExists = true;
      }
    } catch (e) {
      console.error('读取文件失败:', e);
    }
    
    // 解析新的JSON内容
    let newContentObj;
    try {
      newContentObj = JSON.parse(jsonContent);
    } catch (e) {
      vscode.window.showErrorMessage('无法解析JSON内容，请检查格式');
      throw new Error('JSON解析失败');
    }
    
    let finalContent;
    
    // 处理内容
    if (!fileExists || !currentContent.trim()) {
      // 如果文件不存在或为空，直接写入新内容
      finalContent = JSON.stringify(newContentObj, null, 2);
    } else {
      // 合并内容
      try {
        // 先尝试将现有内容作为单个JSON对象解析
        const currentObj = JSON.parse(currentContent);
        const mergedObj = mergeMcpServers(currentObj, newContentObj);
        finalContent = JSON.stringify(mergedObj, null, 2);
      } catch (e) {
        // 如果解析失败，尝试合并多个JSON对象
        const combinedContent = currentContent + '\n\n' + JSON.stringify(newContentObj, null, 2);
        let mergedJson = findAndMergeJsonObjects(combinedContent);
        
        // 如果第一个方法失败，尝试备用方法
        if (!mergedJson) {
          mergedJson = extractAndMergeJsons(combinedContent);
        }
        
        if (mergedJson) {
          finalContent = mergedJson;
        } else {
          // 如果合并失败，保留原始内容并附加新内容
          finalContent = currentContent + '\n\n' + JSON.stringify(newContentObj, null, 2);
          vscode.window.showWarningMessage('无法合并JSON对象，已将新内容添加到文件末尾');
        }
      }
    }
    
    // 写入文件
    fs.writeFileSync(mcpJsonUri.fsPath, finalContent, 'utf8');
    console.log('已更新MCP文件:', mcpJsonUri.fsPath);
    
    return mcpJsonUri;
  } finally {
    // 清除状态消息
    statusMessage.dispose();
  }
}

/**
 * 向指定文件添加JSON
 */
async function addJsonToFile(fileUri: vscode.Uri, jsonContent: string): Promise<void> {
  const statusMessage = showStatusMessage('添加MCP配置中...');
  
  try {
    console.log('向文件添加JSON:', fileUri.fsPath);
    
    // 读取文件内容
    let currentContent = '';
    if (fs.existsSync(fileUri.fsPath)) {
      currentContent = fs.readFileSync(fileUri.fsPath, 'utf8');
    }
    
    // 解析新的JSON内容
    let newContentObj;
    try {
      newContentObj = JSON.parse(jsonContent);
    } catch (e) {
      vscode.window.showErrorMessage('无法解析JSON内容，请检查格式');
      return;
    }
    
    let finalContent;
    
    // 处理内容
    if (!currentContent.trim()) {
      // 如果文件为空，直接写入新内容
      finalContent = JSON.stringify(newContentObj, null, 2);
    } else {
      // 合并内容
      try {
        // 先尝试将现有内容作为单个JSON对象解析
        const currentObj = JSON.parse(currentContent);
        const mergedObj = mergeMcpServers(currentObj, newContentObj);
        finalContent = JSON.stringify(mergedObj, null, 2);
      } catch (e) {
        // 如果解析失败，尝试合并多个JSON对象
        const combinedContent = currentContent + '\n\n' + JSON.stringify(newContentObj, null, 2);
        let mergedJson = findAndMergeJsonObjects(combinedContent);
        
        // 如果第一个方法失败，尝试备用方法
        if (!mergedJson) {
          mergedJson = extractAndMergeJsons(combinedContent);
        }
        
        if (mergedJson) {
          finalContent = mergedJson;
        } else {
          // 如果合并失败，保留原始内容并添加新内容
          finalContent = currentContent + '\n\n' + JSON.stringify(newContentObj, null, 2);
          vscode.window.showWarningMessage('无法合并JSON对象，已将新内容添加到文件末尾');
        }
      }
    }
    
    // 写入文件
    fs.writeFileSync(fileUri.fsPath, finalContent, 'utf8');
    console.log('文件更新成功');
    
    // 打开文件
    const document = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(document);
    
    vscode.window.showInformationMessage('MCP JSON 添加成功！', '查看文件').then(selection => {
      if (selection === '查看文件') {
        vscode.window.showTextDocument(document);
      }
    });
  } catch (e) {
    console.error('添加JSON到文件失败:', e);
    vscode.window.showErrorMessage('添加JSON到文件失败: ' + e);
  } finally {
    statusMessage.dispose();
  }
}

/**
 * 获取用户输入的JSON内容
 */
async function getJsonInput(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    placeHolder: '请粘贴MCP JSON内容',
    prompt: '输入或粘贴要添加的MCP JSON配置',
    ignoreFocusOut: true, // 当输入框失去焦点时不会关闭
    validateInput: (text: string) => {
      try {
        JSON.parse(text);
        return null; // 返回null表示验证通过
      } catch (e) {
        return '请输入有效的JSON';
      }
    }
  });
}

export function activate(context: vscode.ExtensionContext) {
  console.log('AddMCP 已激活');
  
  // 创建MCP服务器树视图提供者
  const mcpServersProvider = new McpServersProvider();
  
  // 注册树视图（移除了searchOnType）
  const mcpServersView = vscode.window.createTreeView('mcpServersView', {
    treeDataProvider: mcpServersProvider,
    showCollapseAll: false
  });
  
  // 添加状态栏项，显示扩展已激活
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(json) AddMCP';
  statusBarItem.tooltip = 'AddMCP 已激活';
  statusBarItem.command = 'addmcp.addMcpJson'; // 点击状态栏项时执行添加命令
  statusBarItem.show();
  
  context.subscriptions.push(statusBarItem, mcpServersView);

  // 注册搜索命令
  const searchCommand = vscode.commands.registerCommand('addmcp.mcpServersView.search', async () => {
    const query = await vscode.window.showInputBox({
      placeHolder: '搜索MCP服务...',
      prompt: '输入关键词搜索服务名称或命令',
      value: mcpServersProvider.searchQuery || ''
    });
    
    // 如果用户点击取消则返回undefined，我们不处理
    if (query !== undefined) {
      mcpServersProvider.setSearchQuery(query);
    }
  });
  
  // 注册清除搜索命令
  const clearSearchCommand = vscode.commands.registerCommand('addmcp.mcpServersView.clearSearch', () => {
    mcpServersProvider.clearSearch();
  });
  
  // 注册显示MCP服务器列表命令
  const showMcpServersCommand = vscode.commands.registerCommand('addmcp.showMcpServers', async (uri: vscode.Uri) => {
    try {
      let fileUri: vscode.Uri;
      
      // 如果从右键菜单调用，uri参数会传入
      if (uri) {
        fileUri = uri;
      } else {
        // 如果从命令面板调用，使用当前活动编辑器的文件
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage('没有打开的文件');
          return;
        }
        fileUri = editor.document.uri;
      }
      
      console.log('要查看的文件:', fileUri.fsPath);
      
      // 验证文件是否是JSON文件
      if (!fileUri.fsPath.toLowerCase().endsWith('.json')) {
        vscode.window.showWarningMessage('只能查看JSON文件中的MCP配置');
        return;
      }
      
      // 设置当前文件并加载服务器
      mcpServersProvider.setCurrentFile(fileUri.fsPath);
      
      // 显示视图
      vscode.commands.executeCommand('workbench.view.extension.addmcp-explorer');
      
    } catch (e) {
      console.error('显示MCP服务器列表失败:', e);
      vscode.window.showErrorMessage('显示MCP服务器列表失败: ' + e);
    }
  });
  
  // 注册刷新MCP服务器列表命令
  const refreshServersCommand = vscode.commands.registerCommand('addmcp.mcpServersView.refresh', () => {
    mcpServersProvider.refresh();
  });
  
  // 注册添加MCP服务命令
  const addServerCommand = vscode.commands.registerCommand('addmcp.mcpServersView.addServer', async () => {
    try {
      const currentFilePath = mcpServersProvider.getCurrentFilePath();
      
      if (!currentFilePath) {
        vscode.window.showWarningMessage('没有活动的JSON文件，请先从资源管理器中选择一个JSON文件');
        return;
      }
      
      // 创建文件URI
      const fileUri = vscode.Uri.file(currentFilePath);
      
      // 获取用户输入的JSON
      const jsonInput = await getJsonInput();
      if (!jsonInput) {
        return; // 用户取消了输入
      }
      
      // 添加JSON到文件
      await addJsonToFile(fileUri, jsonInput);
      
      // 刷新服务器列表
      mcpServersProvider.loadServers();
      
    } catch (e) {
      console.error('添加MCP服务失败:', e);
      vscode.window.showErrorMessage('添加MCP服务失败: ' + e);
    }
  });
  
  // 注册删除服务器命令
  const deleteServerCommand = vscode.commands.registerCommand('addmcp.mcpServersView.deleteServer', (item: McpServerTreeItem) => {
    mcpServersProvider.deleteServer(item);
  });
  
  // 注册上移服务器命令
  const moveUpCommand = vscode.commands.registerCommand('addmcp.mcpServersView.moveUp', (item: McpServerTreeItem) => {
    mcpServersProvider.moveServer(item, 'up');
  });
  
  // 注册下移服务器命令
  const moveDownCommand = vscode.commands.registerCommand('addmcp.mcpServersView.moveDown', (item: McpServerTreeItem) => {
    mcpServersProvider.moveServer(item, 'down');
  });

  // 注册文档更改事件监听器
  const disposable = vscode.workspace.onDidChangeTextDocument((event: vscode.TextDocumentChangeEvent) => {
    const document = event.document;
    
    // 只处理mcp.json文件
    if (!isMcpJsonFile(document)) {
      return;
    }
    
    // 获取文档全文
    const text = document.getText();
    
    // 查找并合并JSON对象
    let mergedJson = findAndMergeJsonObjects(text);
    
    // 如果第一个方法失败，尝试备用方法
    if (!mergedJson) {
      mergedJson = extractAndMergeJsons(text);
    }
    
    if (mergedJson) {
      // 创建编辑操作
      const edit = new vscode.WorkspaceEdit();
      
      // 替换整个文档内容
      edit.replace(
        document.uri,
        new vscode.Range(
          document.positionAt(0),
          document.positionAt(text.length)
        ),
        mergedJson
      );
      
      // 应用编辑操作
      vscode.workspace.applyEdit(edit);
    }
  });

  // 注册命令：手动触发合并
  const mergeCommand = vscode.commands.registerCommand('addmcp.mergeMcpJson', async () => {
    try {
      // 获取当前活动编辑器
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('没有打开的JSON文件');
        return;
      }
      
      // 验证文件是否是JSON文件
      if (!editor.document.fileName.toLowerCase().endsWith('.json')) {
        vscode.window.showWarningMessage('当前文件不是JSON文件');
        return;
      }
      
      const statusMessage = showStatusMessage('正在合并当前JSON文件中的所有JSON对象...');
      
      // 获取文档全文
      const text = editor.document.getText();
      
      // 合并JSON
      let mergedJson = findAndMergeJsonObjects(text);
      
      // 如果第一个方法失败，尝试备用方法
      if (!mergedJson) {
        mergedJson = extractAndMergeJsons(text);
      }
      
      if (mergedJson) {
        // 更新文件内容
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          editor.document.uri,
          new vscode.Range(
            editor.document.positionAt(0),
            editor.document.positionAt(text.length)
          ),
          mergedJson
        );
        
        // 应用编辑
        await vscode.workspace.applyEdit(edit);
        
        statusMessage.dispose();
        vscode.window.showInformationMessage('当前JSON文件合并成功！');
      } else {
        statusMessage.dispose();
        vscode.window.showWarningMessage('无法合并当前JSON文件，请检查文件格式。');
      }
    } catch (e) {
      console.error('合并失败:', e);
      vscode.window.showErrorMessage('合并JSON时出错: ' + e);
    }
  });

  // 注册命令：添加MCP JSON
  const addMcpJsonCommand = vscode.commands.registerCommand('addmcp.addMcpJson', async () => {
    // 提示用户输入JSON内容
    const jsonInput = await getJsonInput();

    if (!jsonInput) {
      return; // 用户取消了输入
    }

    try {
      // 更新MCP文件
      const mcpJsonUri = await updateMcpJsonFile(jsonInput);
      
      // 打开文件
      const document = await vscode.workspace.openTextDocument(mcpJsonUri);
      await vscode.window.showTextDocument(document);
      
      vscode.window.showInformationMessage('MCP JSON 添加成功！', '查看文件').then(selection => {
        if (selection === '查看文件') {
          vscode.window.showTextDocument(document);
        }
      });
    } catch (e) {
      console.error('添加MCP JSON时出错', e);
      vscode.window.showErrorMessage('添加MCP JSON时出错: ' + e);
    }
  });

  // 注册命令：添加MCP JSON到当前文件（右键菜单使用）
  const addToCurrentFileCommand = vscode.commands.registerCommand('addmcp.addToCurrentFile', async (uri: vscode.Uri) => {
    try {
      let fileUri: vscode.Uri;
      
      // 如果从右键菜单调用，uri参数会传入
      if (uri) {
        fileUri = uri;
      } else {
        // 如果从命令面板调用，使用当前活动编辑器的文件
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage('没有打开的文件');
          return;
        }
        fileUri = editor.document.uri;
      }
      
      console.log('要编辑的文件:', fileUri.fsPath);
      
      // 验证文件是否是JSON文件
      if (!fileUri.fsPath.toLowerCase().endsWith('.json')) {
        vscode.window.showWarningMessage('只能向JSON文件添加MCP配置');
        return;
      }
      
      // 获取用户输入的JSON
      const jsonInput = await getJsonInput();
      if (!jsonInput) {
        return; // 用户取消了输入
      }
      
      // 添加JSON到文件
      await addJsonToFile(fileUri, jsonInput);
      
    } catch (e) {
      console.error('添加MCP JSON到当前文件失败:', e);
      vscode.window.showErrorMessage('添加MCP JSON到当前文件失败: ' + e);
    }
  });

  // 将事件监听器和命令添加到订阅中
  context.subscriptions.push(
    disposable, 
    mergeCommand, 
    addMcpJsonCommand, 
    addToCurrentFileCommand,
    showMcpServersCommand,
    refreshServersCommand,
    addServerCommand,
    deleteServerCommand,
    moveUpCommand,
    moveDownCommand,
    searchCommand,
    clearSearchCommand
  );
}

export function deactivate() {
  console.log('AddMCP 已停用');
} 