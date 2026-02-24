import { MarkdownConfigSchema, buildChannelConfigSchema } from "openclaw/plugin-sdk";
import { z } from "zod";

export const Erc8004ConfigSchema = z
  .object({
    tokenUri: z.string().optional(),
    defaultChains: z.array(z.union([z.string(), z.number()])).optional(),
    rpcUrls: z.record(z.string(), z.string()).optional(),
    registryAddresses: z.record(z.string(), z.string()).optional(),
  })
  .optional();

export const XmtpAccountFieldsSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  walletKey: z.string().optional(),
  walletKeyFile: z.string().optional(),
  dbEncryptionKey: z.string().optional(),
  dbEncryptionKeyFile: z.string().optional(),

  env: z.enum(["local", "dev", "production"]).optional(),
  dbPath: z.string().optional(),

  dmPolicy: z.enum(["pairing", "allowlist", "open", "disabled"]).optional(),
  allowFrom: z.array(z.string()).optional(),

  groupPolicy: z.enum(["open", "disabled", "allowlist"]).optional(),
  groupAllowFrom: z.array(z.string()).optional(),

  erc8004: Erc8004ConfigSchema,
});

export const XmtpConfigSchema = XmtpAccountFieldsSchema.extend({
  markdown: MarkdownConfigSchema,
  accounts: z.record(z.string(), XmtpAccountFieldsSchema).optional(),
});

export type XmtpConfig = z.infer<typeof XmtpConfigSchema>;

export const xmtpChannelConfigSchema = buildChannelConfigSchema(XmtpConfigSchema);
