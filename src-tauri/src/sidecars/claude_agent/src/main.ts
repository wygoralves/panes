import readline from "node:readline";
import { handleRequest } from "./runner";
import type { SidecarMessage, SidecarRequest } from "./protocol";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function write(message: SidecarMessage) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

rl.on("line", async (line) => {
  let parsed: SidecarRequest;
  try {
    parsed = JSON.parse(line) as SidecarRequest;
  } catch {
    write({
      type: "response",
      id: "invalid",
      error: { message: "invalid json" }
    });
    return;
  }

  const responses = await handleRequest(parsed);
  for (const response of responses) {
    write(response);
  }
});
