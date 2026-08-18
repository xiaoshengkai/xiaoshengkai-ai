/**
 * 共享网络配置读取器
 * ============================================================================
 *
 * 单一真相源 config/network.json 的统一读取入口。
 * 所有消费者（scripts/、packages/mcp/、packages/ai-chat/）通过这个函数访问。
 *
 * 行为:
 *   - 从 process.cwd() 向上找 config/network.json（最多 5 层）
 *   - 找到就返回解析后的对象
 *   - 找不到抛错（带 cwd 信息）
 *
 * 优点:
 *   - 调用方无需关心 cwd/项目根在哪
 *   - 文件读取逻辑只此一处
 *   - 错误信息统一
 */
import fs from "node:fs";
import path from "node:path";

const MAX_LEVELS = 5;

export function loadNetworkConfig() {
  let dir = process.cwd();
  for (let i = 0; i <= MAX_LEVELS; i++) {
    const tryPath = path.join(dir, "config", "network.json");
    if (fs.existsSync(tryPath)) {
      return JSON.parse(fs.readFileSync(tryPath, "utf-8"));
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`找不到 config/network.json (从 ${process.cwd()} 向上遍历 ${MAX_LEVELS} 层未果)`);
}