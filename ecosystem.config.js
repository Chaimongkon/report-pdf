module.exports = {
  apps: [
    {
      name: "report-pdf",
      script: "server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        PORT: 3001,
        CHROME_PATH: "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      },
    },
  ],
};
