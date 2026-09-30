import { failoverTransport, serverRpcUrls } from "@ninety/core";
import { createPublicClient } from "viem";
import { monadTestnet } from "@/lib/chain";

/**
 * RPC access for the app's own server routes (the market scheduler, the gas sponsor). They go to a
 * dedicated server RPC first when `SERVER_RPC_URL` is set, falling back to the public one, so the
 * public RPC's 15 req/s cap is left to fans' browsers -- the only thing that must use it.
 */
export const serverTransport = () => failoverTransport(serverRpcUrls());

export const serverPublicClient = createPublicClient({
  chain: monadTestnet,
  transport: serverTransport(),
  batch: { multicall: true },
});
