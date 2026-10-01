#!/usr/bin/env node
// Points the Agent Wallet at Monad testnet's own RPC, once.
//
// Agent Wallet 7.0 lists Monad testnet (10143) as a supported chain and its policy accepts it, but
// the RPC gateway it uses by default answers "Invalid chainId" for it, so its transaction pipeline
// (block tracker, gas estimates) can't run there. The CLI checks the wallet's `customEvmChains`
// before that gateway; this adds Monad testnet there with Monad's public RPC. Signing, policy and
// 2FA are unchanged: they still happen at MetaMask. Backs the file up first; safe to run twice.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const path = join(homedir(), ".metamask", "wallets.json");
if (!existsSync(path)) {
  console.error("No ~/.metamask/wallets.json yet: run `mm login` and `mm init` first.");
  process.exit(1);
}
const wallets = JSON.parse(readFileSync(path, "utf8"));
const chains = (wallets.data.customEvmChains ??= []);
if (chains.some((c) => c.chainId === 10143)) {
  console.log("Monad testnet is already configured.");
  process.exit(0);
}
copyFileSync(path, `${path}.bak-before-ninety`);
chains.push({
  key: "monad-testnet",
  chainId: 10143,
  caip2: "eip155:10143",
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcTarget: process.env.NINETY_RPC_URL ?? "https://testnet-rpc.monad.xyz",
});
writeFileSync(path, JSON.stringify(wallets, null, 2), { mode: 0o600 });
console.log(`Added Monad testnet. Backup: ${path}.bak-before-ninety`);
