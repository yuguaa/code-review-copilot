module.exports = {
  apps: [
    {
      // 应用名称（自定义，方便管理）
      name: "code-review-copilot",
      // 启动脚本（Next.js 生产启动命令）
      script: "node_modules/next/dist/bin/next",
      // 启动参数（指定 start 命令，可选自定义端口）
      args: "start -p 3000",
      // 运行模式（cluster 集群模式，fork 单进程模式）
      // Windows 不支持 cluster 模式，必须用 fork
      exec_mode: "fork",
      // 实例数（cluster 模式下生效，Windows 忽略）
      instances: 1,
      // 自动重启（服务崩溃/退出时自动重启）
      autorestart: true,
      // 错误日志路径（自定义，建议放在项目根目录的 logs 文件夹）
      error_file: "./logs/next-err.log",
      // 输出日志路径
      out_file: "./logs/next-out.log",
      // 日志时间戳
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    }
  ]
};