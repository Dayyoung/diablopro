import { tool } from "@opencode-ai/plugin";
import { execSync } from "child_process";
import { join } from "path";

const state = {
  selectedModel: null,
  isGeminiMode: false,
};

function runGeminiCommand(args, cwd) {
  try {
    const cmd = ["gemini", ...args].join(" ");
    const output = execSync(cmd, {
      cwd: cwd || process.cwd(),
      encoding: "utf-8",
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { success: true, output: output };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stderr: error.stderr?.toString() || "",
    };
  }
}

function isGeminiAvailable() {
  try {
    execSync("gemini --version", { encoding: "utf-8", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function getWorkspaceDir(directory, worktree) {
  if (worktree) {
    return join(directory, worktree);
  }
  return directory;
}

export const FakeModelPlugin = async (input) => {
  const { directory, worktree, $ } = input;
  const workspaceDir = getWorkspaceDir(directory, worktree);

  return {
    tool: {
      fakemodel: tool({
        description: "Select model and execute queries via gemini-cli. Use 'select gemini' to switch to gemini mode, or 'query <text>' to ask anything.",
        args: {
          action: tool.schema.string().describe("Action: 'select <model>', 'query <text>', 'status', 'reset', or 'available'"),
          text: tool.schema.string().describe("Query text (for 'query' action) or model name (for 'select' action)"),
        },
        async execute(args) {
          const { action, text } = args;

          if (action === "available" || action === "list" || action === "models") {
            const geminiAvailable = isGeminiAvailable();
            return JSON.stringify({
              current: state.selectedModel,
              isGeminiMode: state.isGeminiMode,
              available: [
                { id: "current", name: "Current Model", description: "Use the currently selected model (default)" },
                ...(geminiAvailable ? [{ id: "gemini", name: "gemini-cli", description: "Proxy to gemini-cli. Execute queries via 'gemini' CLI and return results. Does NOT change the actual model." }] : []),
              ],
              geminiCLIAvailable: geminiAvailable,
            });
          }

          if (action === "select") {
            if (!text) {
              return JSON.stringify({ error: "Model name required", example: "fakemodel select gemini" });
            }

            const geminiAvailable = isGeminiAvailable();

            if (text.toLowerCase() === "gemini") {
              if (!geminiAvailable) {
                return JSON.stringify({ error: "gemini CLI is not installed", hint: "Install via: npm install -g @google-gemini/gemini-cli" });
              }

              state.selectedModel = "gemini";
              state.isGeminiMode = true;

              return JSON.stringify({
                status: "success",
                message: "Switched to gemini-cli mode",
                note: "Actual model unchanged. Queries will be executed via 'gemini' CLI.",
                example: "fakemodel query 'your question here'",
              });
            } else if (text.toLowerCase() === "current" || text.toLowerCase() === "reset") {
              state.selectedModel = null;
              state.isGeminiMode = false;
              return JSON.stringify({ status: "success", message: "Reset to original model" });
            } else {
              return JSON.stringify({ error: `Unknown model: ${text}`, available: ["gemini", "current"] });
            }
          }

          if (action === "query" || text) {
            const queryText = text || action;
            const result = runGeminiCommand(["-p", `"${queryText}"`], workspaceDir);

            if (result.success) {
              return JSON.stringify({
                mode: "gemini-cli (fakemodel)",
                model: state.selectedModel,
                query: queryText,
                result: result.output,
              });
            } else {
              return JSON.stringify({ error: result.error, stderr: result.stderr });
            }
          }

          if (action === "status") {
            const geminiAvailable = isGeminiAvailable();
            return JSON.stringify({
              selectedModel: state.selectedModel,
              isGeminiMode: state.isGeminiMode,
              geminiCLIAvailable: geminiAvailable,
            });
          }

          return JSON.stringify({
            help: "fakemodel - Fake model selector that proxies to gemini-cli",
            actions: {
              select: "fakemodel select gemini - Switch to gemini mode",
              query: "fakemodel query 'question' - Execute query via gemini CLI",
              status: "fakemodel status - Check current mode",
              available: "fakemodel available - List available models",
              reset: "fakemodel select current - Reset to original model",
            },
            note: "Does NOT change actual model. All queries are executed via gemini CLI.",
          });
        },
      }),

      gemini: tool({
        description: "Execute a query via gemini-cli (shortcut for fakemodel)",
        args: {
          query: tool.schema.string().describe("Query text to send to gemini"),
        },
        async execute(args) {
          const { query } = args;

          if (!query) {
            return JSON.stringify({ error: "Query required", example: "gemini what is your name?" });
          }

          const geminiAvailable = isGeminiAvailable();

          if (!geminiAvailable) {
            return JSON.stringify({ error: "gemini CLI not installed", hint: "Install via: npm install -g @google-gemini/gemini-cli" });
          }

          const result = runGeminiCommand(["-p", `"${query}"`], workspaceDir);

          if (result.success) {
            return result.output;
          } else {
            return JSON.stringify({ error: result.error, stderr: result.stderr });
          }
        },
      }),

      "gemini.check": tool({
        description: "Check if gemini CLI is available",
        args: {},
        async execute() {
          const available = isGeminiAvailable();
          return JSON.stringify({
            available,
            version: available ? execSync("gemini --version", { encoding: "utf-8", timeout: 5000 }).trim() : null,
          });
        },
      }),
    },

    provider: {
      id: "fakemodel",
      models: async (provider, ctx) => {
        return {};
      },
    },
  };
};

export default FakeModelPlugin;