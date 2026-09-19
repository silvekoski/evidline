import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

const outboundModules = [
  "openai", "@azure/openai", "@azure-rest/ai-inference", "ollama", "axios", "undici", "node-fetch", "got", "ky", "superagent",
  "node:http", "node:https", "node:http2", "node:net", "node:tls", "node:dgram", "node:dns", "node:child_process",
  "http", "https", "http2", "net", "tls", "dgram", "dns", "child_process",
];
const outboundPatterns = outboundModules.flatMap((m) => [m, `${m}/*`]);
const outboundGlobals = ["fetch", "WebSocket", "XMLHttpRequest", "EventSource", "Request", "navigator"];
const egressInternals = { name: "@tpm/egress", importNames: ["send", "sendForm", "getProvider", "createElevenLabsTranscriber", "transcriberFromEnv", "createOpenAiOcr", "ocrFromEnv", "createOpenAiProvider", "createAzureProvider", "createOllamaProvider"], message: "Only the gateway may call a model." };

const noOutbound = {
  "no-restricted-imports": ["error", { paths: [egressInternals], patterns: [{ group: outboundPatterns, message: "Only packages/egress may reach the network." }] }],
  "no-restricted-globals": ["error", ...outboundGlobals.map((name) => ({ name, message: "Only packages/egress may reach the network." }))],
  "no-restricted-syntax": [
    "error",
    { selector: "ImportExpression", message: "No dynamic import outside packages/egress." },
    { selector: "CallExpression[callee.name='require']", message: "No require outside packages/egress." },
    { selector: `MemberExpression[object.name=/^(globalThis|window|self|global)$/][property.name=/^(${outboundGlobals.join("|")})$/]`, message: "Only packages/egress may reach the network." },
  ],
};

const pureCore = {
  ...noOutbound,
  "no-restricted-imports": ["error", { paths: [egressInternals], patterns: [{ group: ["node:*", "fs", "path", "os", "worker_threads", "crypto", "stream", "events", ...outboundPatterns], message: "packages/core is pure. No I/O." }] }],
};

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "data/**", "**/*.d.ts", "apps/web/src/components/ui/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] },
  },
  { files: ["packages/adapters/**", "packages/schemas/**", "packages/corpus/**", "apps/server/**", "scripts/**"], rules: noOutbound },
  { files: ["packages/connectors/**"], rules: { ...noOutbound, "no-restricted-globals": "off" } },
  { files: ["packages/core/src/**"], rules: pureCore },
  { files: ["packages/core/test/**"], rules: noOutbound },
);
