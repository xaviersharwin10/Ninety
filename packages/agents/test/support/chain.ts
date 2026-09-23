import { type ChildProcess, execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { anvil } from "viem/chains";

const execFileAsync = promisify(execFile);

const CONTRACTS_DIR = new URL("../../../../contracts/", import.meta.url).pathname;

/** Spawns a local anvil instance on `port` and resolves once it's accepting RPC calls. */
export async function startAnvil(port: number): Promise<ChildProcess> {
  const proc = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });
  const rpcUrl = `http://127.0.0.1:${port}`;

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) return proc;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error(`anvil did not become ready on port ${port} within 15s`);
}

export function stopAnvil(proc: ChildProcess): void {
  proc.kill();
}

export interface DeployedAddresses {
  agentRegistry: `0x${string}`;
  marketManager: `0x${string}`;
  betRouter: `0x${string}`;
  settlementReceiver: `0x${string}`;
  ausd: `0x${string}`;
}

/**
 * Deploys the real contract set via a dedicated Foundry script, exactly the way the actual
 * deployment does — not a hand-rolled re-implementation of deployment in TypeScript that could
 * drift from what `script/Deploy.s.sol` actually does.
 */
export async function deployTestStack(
  rpcUrl: string,
  deployerPrivateKey: `0x${string}`,
): Promise<DeployedAddresses> {
  const { stdout } = await execFileAsync(
    "forge",
    ["script", "script/TestDeploy.s.sol", "--rpc-url", rpcUrl, "--broadcast", "-vvv"],
    {
      cwd: CONTRACTS_DIR,
      env: { ...process.env, DEPLOYER_PRIVATE_KEY: deployerPrivateKey },
      maxBuffer: 16 * 1024 * 1024,
    },
  );

  const grab = (label: string): `0x${string}` => {
    const m = stdout.match(new RegExp(`${label}\\s+(0x[0-9a-fA-F]{40})`));
    if (!m) throw new Error(`could not find "${label}" address in forge script output:\n${stdout}`);
    return m[1] as `0x${string}`;
  };

  return {
    ausd: grab("TestUSD"),
    agentRegistry: grab("AgentRegistry"),
    marketManager: grab("MarketManager"),
    betRouter: grab("BetRouter"),
    settlementReceiver: grab("SettlementReceiver"),
  };
}

export const testChain = { ...anvil, id: 31337 };
