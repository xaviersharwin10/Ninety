# CRE forwarder trust model

Ninety's `SettlementReceiver` is a Chainlink CRE consumer: it implements `IReceiver.onReport` and only
accepts calls from an allowlisted forwarder. This note records *why* the allowlist is structured the way
it is, with the evidence behind it, because the two forwarders on Monad testnet are not equally trustworthy.

## The two forwarders

| | Production | Simulation |
|---|---|---|
| Address (Monad testnet, 10143) | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` | `0xB9F79d863261869B234c481D1f9A7af84AeAd192` |
| `typeAndVersion()` | `KeystoneForwarder 1.0.0` | `MockKeystoneForwarder 1.0.0` |
| Used by | `cre workflow deploy` (real DON) | `cre workflow simulate --broadcast` |
| Source | [CRE Forwarder Directory](https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts) | same |

## Finding: the simulation forwarder authenticates nothing

Measured against Monad testnet and an anvil fork of it, 23 Sep 2026.

**1. The mock has no signer set.** Comparing runtime bytecode dispatchers, the production forwarder exposes
two functions the mock does not:

```
setConfig(uint32,uint32,uint8,address[])   0xee59d26c   -- registers the DON signer set
clearConfig(uint32,uint32)                 0xef6e17a0
```

With no configurable signer set, the mock has nothing to verify signatures against.

**2. `report()` with zero signatures.** Calling `report(address,bytes,bytes,bytes[])` from an
arbitrary EOA with a well-formed 109-byte Keystone metadata header and an empty signature array:

| Forwarder | Result |
|---|---|
| Production | reverts `InvalidSignatureCount(4, 0)` — it demands `f + 1 = 4` valid DON signatures |
| Simulation | **succeeds** |

**3. The report is delivered, and its metadata is entirely attacker-controlled.** On an anvil fork of
Monad testnet, an ordinary account with no role called the mock's `report()` against a probe receiver.
`onReport` fired, `msg.sender` was the mock forwarder (so a naive `msg.sender == forwarder` check passes),
and the 64-byte metadata the receiver decoded was exactly what the caller had chosen:

```
workflowId    0xabababab…abab
workflowName  "ninety-set"
workflowOwner 0xaAaA…aAaA
```

### Consequence

While the simulation forwarder is allowlisted, **any address can resolve any market to any outcome**, and
**validating `workflowOwner` / `workflowName` / `workflowId` does not prevent it** — the mock passes those
fields through unauthenticated. That validation is still worth doing, because on the *production* forwarder
the metadata is authentic (DON signatures are checked before routing), but it cannot be the defence for the
simulation path.

## Mitigations

1. **`PRODUCTION_FORWARDER` is immutable** and set at construction. It can never be removed.
2. **The simulation forwarder is off by default**, enabled only by the owner, only for a recorded demo.
3. **Sim-attestor signature.** While the simulation path is enabled, a report arriving through the mock
   forwarder must additionally carry an ECDSA signature from `simAttestor` over
   `keccak256(abi.encode(block.chainid, address(this), nonce, payload))`. The workflow executes locally
   during simulation, so it can hold that key; reports through the production forwarder ignore the field.
   This reduces the simulation path's trust to a single key we control, instead of to anyone on the internet.
4. **Monotonic `nonce`** for replay protection. The mock does not deduplicate by
   `workflowExecutionId`/`reportId`, so the receiver cannot rely on those.
5. **One-way `lockProduction()`.** Once production deploy access is granted, this permanently removes the
   simulation forwarder and the attestor path. Irreversible, so the judged deployment is provably clean
   rather than merely configured clean.

## Reproducing

```bash
RPC=https://testnet-rpc.monad.xyz
MOCK=0xB9F79d863261869B234c481D1f9A7af84AeAd192
PROD=0xF8344CFd5c43616a4366C34E3EEE75af79a74482

cast call $MOCK "typeAndVersion()(string)" --rpc-url $RPC   # MockKeystoneForwarder 1.0.0
cast call $PROD "typeAndVersion()(string)" --rpc-url $RPC   # KeystoneForwarder 1.0.0

# 109-byte Keystone metadata header + payload, no signatures
RAW=0x$(python3 -c "
p  = '01' + 'de'*32 + '00000001'*3 + 'ab'*32 + 'ninety-set'.encode().hex() + 'aa'*20 + '0001'
assert len(p)//2 == 109
print(p + 'ca'*32)")
CTX=0x$(python3 -c "print('00'*64)")

cast call $PROD "report(address,bytes,bytes,bytes[])" 0x…receiver $RAW $CTX "[]" --rpc-url $RPC
cast call $MOCK "report(address,bytes,bytes,bytes[])" 0x…receiver $RAW $CTX "[]" --rpc-url $RPC
```
