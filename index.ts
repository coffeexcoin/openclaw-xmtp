import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { xmtpPlugin } from "./src/channel.js";
import { commands } from "./src/commands.js";
import { setXmtpRuntime } from "./src/runtime.js";

const plugin = {
  id: "xmtp",
  name: "XMTP",
  description: "XMTP E2E encrypted messaging channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setXmtpRuntime(api.runtime);
    api.registerChannel({ plugin: xmtpPlugin });

    for (const [name, command] of Object.entries(commands)) {
      api.registerCommand({
        name,
        description: command.description,
        handler: command.handler,
      });
    }
  },
};

export default plugin;
