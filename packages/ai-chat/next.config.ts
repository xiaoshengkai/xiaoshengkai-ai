/**
 * Next.js 配置文件
 *
 * 默认使用 webpack 打包（通过 package.json scripts 中的 --webpack 标志），
 * 因为当前环境的 Turbopack 原生绑定不可用（swc-darwin-arm64 签名无效）。
 */

import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";

dotenvConfig({ path: resolve(process.cwd(), "..", "..", ".env") });
if (process.env.NODE_ENV === 'production') {
  dotenvConfig({ path: resolve(process.cwd(), "..", "..", ".env.production") });
}

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.BUILD_DIR || '.next',
  basePath: process.env.NODE_ENV === 'production' ? '/ai' : '',
  /**
   * 服务端外部化依赖:不参与 webpack 打包,运行时由 Node 直接 require。
   *
   * 为什么需要:
   *   - chroma-server.ts 通过 instrumentation.ts 间接被引入,会进入服务端 bundle
   *   - chroma-server.ts 使用 `child_process`(spawn chroma 进程)、`fs`、`path`
   *   - Next.js 16 的服务端 bundle 走 webpack,但 webpack 不会自动识别
   *     Node 内置模块 + 所有原生依赖
   *   - 加入 serverExternalPackages 后,Next.js 保留 require 行为,避免打包错
   */
  serverExternalPackages: [
    "chromadb",
    "@chroma-core/default-embed",
    // chroma-server.ts 整个文件直接走外部 require,绕过 webpack
    "./src/lib/chroma-server",
    "./src/lib/chroma-server.ts",
  ],

  /**
   * webpack 配置:把 Node 内置模块标记为外部依赖,
   * 避免 "Module not found: Can't resolve 'child_process'" 之类的错误。
   *
   * 此配置仅影响服务端 bundle。
   */
  webpack: (config, { isServer }) => {
    if (isServer) {
      const externals = Array.isArray(config.externals)
        ? config.externals
        : [config.externals].filter(Boolean);

      externals.push({
        "child_process": "commonjs child_process",
        "fs": "commonjs fs",
        "path": "commonjs path",
        "node:child_process": "commonjs child_process",
        "node:fs": "commonjs fs",
        "node:path": "commonjs path",
      });

      config.externals = externals;
    }
    return config;
  },
};

export default nextConfig;