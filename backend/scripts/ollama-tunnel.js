// Keeps an SSH tunnel open from this PC to an Ollama that runs on a server (bound to 127.0.0.1 there, so no port is exposed):
//   local 127.0.0.1:OLLAMA_TUNNEL_PORT (default 11435)  ->  server 127.0.0.1:11434
// Set in backend/.env:  OLLAMA_SSH=root@your.server.ip      (required)
//                       OLLAMA_TUNNEL_PORT=11435            (optional; 11434 is taken when Ollama also runs on this PC)
// Then in Settings -> Text model, set the Ollama address to http://127.0.0.1:11435.
// Run:  npm run ollama:tunnel   (leave the window open; it reconnects by itself if the link drops)

require("dotenv").config();
const { spawn } = require("child_process");

const target = process.env.OLLAMA_SSH;
const port = process.env.OLLAMA_TUNNEL_PORT || "11435";
if (!target) {
  console.error("Set OLLAMA_SSH=user@server in backend/.env first (for example root@203.0.113.5).");
  process.exit(1);
}

let stopping = false;
function start() {
  console.log(`[tunnel] 127.0.0.1:${port} -> ${target}:11434`);
  const p = spawn(
    "ssh",
    ["-N", "-L", `127.0.0.1:${port}:127.0.0.1:11434`, "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=4", "-o", "BatchMode=yes", target],
    { stdio: "inherit" }
  );
  p.on("exit", (code) => {
    if (stopping) return;
    console.error(`[tunnel] ssh exited (${code}); reconnecting in 5 s`);
    setTimeout(start, 5000);
  });
  process.once("SIGINT", () => {
    stopping = true;
    p.kill();
    process.exit(0);
  });
}
start();
