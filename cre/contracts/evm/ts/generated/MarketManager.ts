// Code generated — DO NOT EDIT.
import {
  decodeEventLog,
  decodeFunctionResult,
  encodeEventTopics,
  encodeFunctionData,
  zeroAddress,
} from 'viem'
import type { Address, Hex } from 'viem'
import {
  bytesToHex,
  encodeCallMsg,
  EVMClient,
  hexToBase64,
  LAST_FINALIZED_BLOCK_NUMBER,
  prepareReportRequest,
  type EVMLog,
  type Runtime,
} from '@chainlink/cre-sdk'

export interface DecodedLog<T> extends Omit<EVMLog, 'data'> { data: T }

const encodeTopicValue = (t: Hex | Hex[] | null): string[] => {
  if (t == null) return []
  if (Array.isArray(t)) return t.map(hexToBase64)
  return [hexToBase64(t)]
}





/**
 * Filter params for MarketClosed. Only indexed fields can be used for filtering.
 * Indexed string/bytes must be passed as keccak256 hash (Hex).
 */
export type MarketClosedTopics = {
  marketId?: bigint
}

/**
 * Decoded MarketClosed event data.
 */
export type MarketClosedDecoded = {
  marketId: bigint
}


/**
 * Filter params for MarketOpened. Only indexed fields can be used for filtering.
 * Indexed string/bytes must be passed as keccak256 hash (Hex).
 */
export type MarketOpenedTopics = {
  marketId?: bigint
  matchId?: bigint
  templateId?: `0x${string}`
}

/**
 * Decoded MarketOpened event data.
 */
export type MarketOpenedDecoded = {
  marketId: bigint
  matchId: bigint
  templateId: `0x${string}`
  windowStart: number
  windowEnd: number
  closesAt: bigint
  teamFilter: number
}


/**
 * Filter params for MarketResolved. Only indexed fields can be used for filtering.
 * Indexed string/bytes must be passed as keccak256 hash (Hex).
 */
export type MarketResolvedTopics = {
  marketId?: bigint
}

/**
 * Decoded MarketResolved event data.
 */
export type MarketResolvedDecoded = {
  marketId: bigint
  outcome: number
  qualifyingEventTs: bigint
}


/**
 * Filter params for MarketResumed. Only indexed fields can be used for filtering.
 * Indexed string/bytes must be passed as keccak256 hash (Hex).
 */
export type MarketResumedTopics = {
  marketId?: bigint
}

/**
 * Decoded MarketResumed event data.
 */
export type MarketResumedDecoded = {
  marketId: bigint
}


/**
 * Filter params for MarketSuspended. Only indexed fields can be used for filtering.
 * Indexed string/bytes must be passed as keccak256 hash (Hex).
 */
export type MarketSuspendedTopics = {
  marketId?: bigint
}

/**
 * Decoded MarketSuspended event data.
 */
export type MarketSuspendedDecoded = {
  marketId: bigint
  reason: `0x${string}`
}


/**
 * Filter params for MarketVoided. Only indexed fields can be used for filtering.
 * Indexed string/bytes must be passed as keccak256 hash (Hex).
 */
export type MarketVoidedTopics = {
  marketId?: bigint
}

/**
 * Decoded MarketVoided event data.
 */
export type MarketVoidedDecoded = {
  marketId: bigint
  reason: `0x${string}`
}


/**
 * Filter params for MatchCreated. Only indexed fields can be used for filtering.
 * Indexed string/bytes must be passed as keccak256 hash (Hex).
 */
export type MatchCreatedTopics = {
  matchId?: bigint
}

/**
 * Decoded MatchCreated event data.
 */
export type MatchCreatedDecoded = {
  matchId: bigint
  sourceRef: `0x${string}`
  kickoffTs: bigint
  metadataURI: string
}


/**
 * Filter params for RoleAdminChanged. Only indexed fields can be used for filtering.
 * Indexed string/bytes must be passed as keccak256 hash (Hex).
 */
export type RoleAdminChangedTopics = {
  role?: `0x${string}`
  previousAdminRole?: `0x${string}`
  newAdminRole?: `0x${string}`
}

/**
 * Decoded RoleAdminChanged event data.
 */
export type RoleAdminChangedDecoded = {
  role: `0x${string}`
  previousAdminRole: `0x${string}`
  newAdminRole: `0x${string}`
}


/**
 * Filter params for RoleGranted. Only indexed fields can be used for filtering.
 * Indexed string/bytes must be passed as keccak256 hash (Hex).
 */
export type RoleGrantedTopics = {
  role?: `0x${string}`
  account?: `0x${string}`
  sender?: `0x${string}`
}

/**
 * Decoded RoleGranted event data.
 */
export type RoleGrantedDecoded = {
  role: `0x${string}`
  account: `0x${string}`
  sender: `0x${string}`
}


/**
 * Filter params for RoleRevoked. Only indexed fields can be used for filtering.
 * Indexed string/bytes must be passed as keccak256 hash (Hex).
 */
export type RoleRevokedTopics = {
  role?: `0x${string}`
  account?: `0x${string}`
  sender?: `0x${string}`
}

/**
 * Decoded RoleRevoked event data.
 */
export type RoleRevokedDecoded = {
  role: `0x${string}`
  account: `0x${string}`
  sender: `0x${string}`
}


/**
 * Filter params for TemplateSet. Only indexed fields can be used for filtering.
 * Indexed string/bytes must be passed as keccak256 hash (Hex).
 */
export type TemplateSetTopics = {
  templateId?: `0x${string}`
}

/**
 * Decoded TemplateSet event data.
 */
export type TemplateSetDecoded = {
  templateId: `0x${string}`
  enabled: boolean
}


export const MarketManagerABI = [{"type":"constructor","inputs":[{"name":"admin","type":"address","internalType":"address"}],"stateMutability":"nonpayable"},{"type":"function","name":"DEFAULT_ADMIN_ROLE","inputs":[],"outputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"stateMutability":"view"},{"type":"function","name":"SCHEDULER_ROLE","inputs":[],"outputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"stateMutability":"view"},{"type":"function","name":"SETTLER_ROLE","inputs":[],"outputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"stateMutability":"view"},{"type":"function","name":"close","inputs":[{"name":"marketId","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"createMatch","inputs":[{"name":"sourceRef","type":"bytes32","internalType":"bytes32"},{"name":"kickoffTs","type":"uint64","internalType":"uint64"},{"name":"metadataURI","type":"string","internalType":"string"}],"outputs":[{"name":"matchId","type":"uint64","internalType":"uint64"}],"stateMutability":"nonpayable"},{"type":"function","name":"getMarket","inputs":[{"name":"marketId","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"","type":"tuple","internalType":"structMarket","components":[{"name":"matchId","type":"uint64","internalType":"uint64"},{"name":"templateId","type":"bytes32","internalType":"bytes32"},{"name":"windowStart","type":"uint32","internalType":"uint32"},{"name":"windowEnd","type":"uint32","internalType":"uint32"},{"name":"openedAt","type":"uint64","internalType":"uint64"},{"name":"closesAt","type":"uint64","internalType":"uint64"},{"name":"qualifyingEventTs","type":"uint64","internalType":"uint64"},{"name":"state","type":"uint8","internalType":"enumMarketState"},{"name":"outcome","type":"uint8","internalType":"enumOutcome"},{"name":"teamFilter","type":"uint16","internalType":"uint16"}]}],"stateMutability":"view"},{"type":"function","name":"getRoleAdmin","inputs":[{"name":"role","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"stateMutability":"view"},{"type":"function","name":"grantRole","inputs":[{"name":"role","type":"bytes32","internalType":"bytes32"},{"name":"account","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"hasRole","inputs":[{"name":"role","type":"bytes32","internalType":"bytes32"},{"name":"account","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"isBettable","inputs":[{"name":"marketId","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"marketCount","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"matchCount","inputs":[],"outputs":[{"name":"","type":"uint64","internalType":"uint64"}],"stateMutability":"view"},{"type":"function","name":"matchExists","inputs":[{"name":"matchId","type":"uint64","internalType":"uint64"}],"outputs":[{"name":"exists","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"openMarket","inputs":[{"name":"matchId","type":"uint64","internalType":"uint64"},{"name":"templateId","type":"bytes32","internalType":"bytes32"},{"name":"windowStart","type":"uint32","internalType":"uint32"},{"name":"windowEnd","type":"uint32","internalType":"uint32"},{"name":"closesAt","type":"uint64","internalType":"uint64"},{"name":"teamFilter","type":"uint16","internalType":"uint16"}],"outputs":[{"name":"marketId","type":"uint256","internalType":"uint256"}],"stateMutability":"nonpayable"},{"type":"function","name":"renounceRole","inputs":[{"name":"role","type":"bytes32","internalType":"bytes32"},{"name":"callerConfirmation","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"resolve","inputs":[{"name":"marketId","type":"uint256","internalType":"uint256"},{"name":"outcome","type":"uint8","internalType":"enumOutcome"},{"name":"qualifyingEventTs","type":"uint64","internalType":"uint64"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"resume","inputs":[{"name":"marketId","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"revokeRole","inputs":[{"name":"role","type":"bytes32","internalType":"bytes32"},{"name":"account","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"setTemplate","inputs":[{"name":"templateId","type":"bytes32","internalType":"bytes32"},{"name":"enabled","type":"bool","internalType":"bool"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"supportsInterface","inputs":[{"name":"interfaceId","type":"bytes4","internalType":"bytes4"}],"outputs":[{"name":"","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"suspend","inputs":[{"name":"marketId","type":"uint256","internalType":"uint256"},{"name":"reason","type":"bytes32","internalType":"bytes32"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"templateEnabled","inputs":[{"name":"templateId","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"enabled","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"voidMarket","inputs":[{"name":"marketId","type":"uint256","internalType":"uint256"},{"name":"reason","type":"bytes32","internalType":"bytes32"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"event","name":"MarketClosed","inputs":[{"name":"marketId","type":"uint256","indexed":true,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"MarketOpened","inputs":[{"name":"marketId","type":"uint256","indexed":true,"internalType":"uint256"},{"name":"matchId","type":"uint64","indexed":true,"internalType":"uint64"},{"name":"templateId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"windowStart","type":"uint32","indexed":false,"internalType":"uint32"},{"name":"windowEnd","type":"uint32","indexed":false,"internalType":"uint32"},{"name":"closesAt","type":"uint64","indexed":false,"internalType":"uint64"},{"name":"teamFilter","type":"uint16","indexed":false,"internalType":"uint16"}],"anonymous":false},{"type":"event","name":"MarketResolved","inputs":[{"name":"marketId","type":"uint256","indexed":true,"internalType":"uint256"},{"name":"outcome","type":"uint8","indexed":false,"internalType":"enumOutcome"},{"name":"qualifyingEventTs","type":"uint64","indexed":false,"internalType":"uint64"}],"anonymous":false},{"type":"event","name":"MarketResumed","inputs":[{"name":"marketId","type":"uint256","indexed":true,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"MarketSuspended","inputs":[{"name":"marketId","type":"uint256","indexed":true,"internalType":"uint256"},{"name":"reason","type":"bytes32","indexed":false,"internalType":"bytes32"}],"anonymous":false},{"type":"event","name":"MarketVoided","inputs":[{"name":"marketId","type":"uint256","indexed":true,"internalType":"uint256"},{"name":"reason","type":"bytes32","indexed":false,"internalType":"bytes32"}],"anonymous":false},{"type":"event","name":"MatchCreated","inputs":[{"name":"matchId","type":"uint64","indexed":true,"internalType":"uint64"},{"name":"sourceRef","type":"bytes32","indexed":false,"internalType":"bytes32"},{"name":"kickoffTs","type":"uint64","indexed":false,"internalType":"uint64"},{"name":"metadataURI","type":"string","indexed":false,"internalType":"string"}],"anonymous":false},{"type":"event","name":"RoleAdminChanged","inputs":[{"name":"role","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"previousAdminRole","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"newAdminRole","type":"bytes32","indexed":true,"internalType":"bytes32"}],"anonymous":false},{"type":"event","name":"RoleGranted","inputs":[{"name":"role","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"account","type":"address","indexed":true,"internalType":"address"},{"name":"sender","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},{"type":"event","name":"RoleRevoked","inputs":[{"name":"role","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"account","type":"address","indexed":true,"internalType":"address"},{"name":"sender","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},{"type":"event","name":"TemplateSet","inputs":[{"name":"templateId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"enabled","type":"bool","indexed":false,"internalType":"bool"}],"anonymous":false},{"type":"error","name":"AccessControlBadConfirmation","inputs":[]},{"type":"error","name":"AccessControlUnauthorizedAccount","inputs":[{"name":"account","type":"address","internalType":"address"},{"name":"neededRole","type":"bytes32","internalType":"bytes32"}]},{"type":"error","name":"CloseTimeInPast","inputs":[{"name":"closesAt","type":"uint64","internalType":"uint64"},{"name":"nowTs","type":"uint64","internalType":"uint64"}]},{"type":"error","name":"InvalidOutcome","inputs":[{"name":"outcome","type":"uint8","internalType":"enumOutcome"}]},{"type":"error","name":"InvalidTeamFilter","inputs":[{"name":"teamFilter","type":"uint16","internalType":"uint16"}]},{"type":"error","name":"InvalidWindow","inputs":[{"name":"windowStart","type":"uint32","internalType":"uint32"},{"name":"windowEnd","type":"uint32","internalType":"uint32"}]},{"type":"error","name":"StillOpenForBetting","inputs":[{"name":"marketId","type":"uint256","internalType":"uint256"},{"name":"closesAt","type":"uint64","internalType":"uint64"}]},{"type":"error","name":"TemplateNotEnabled","inputs":[{"name":"templateId","type":"bytes32","internalType":"bytes32"}]},{"type":"error","name":"UnknownMarket","inputs":[{"name":"marketId","type":"uint256","internalType":"uint256"}]},{"type":"error","name":"UnknownMatch","inputs":[{"name":"matchId","type":"uint64","internalType":"uint64"}]},{"type":"error","name":"WrongState","inputs":[{"name":"marketId","type":"uint256","internalType":"uint256"},{"name":"actual","type":"uint8","internalType":"enumMarketState"}]}] as const

export class MarketManager {
  constructor(
    private readonly client: EVMClient,
    public readonly address: Address,
  ) {}

  dEFAULTADMINROLE(
    runtime: Runtime<unknown>,
  ): `0x${string}` {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'DEFAULT_ADMIN_ROLE' as const,
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: MarketManagerABI,
      functionName: 'DEFAULT_ADMIN_ROLE' as const,
      data: bytesToHex(result.data),
    }) as `0x${string}`
  }

  sCHEDULERROLE(
    runtime: Runtime<unknown>,
  ): `0x${string}` {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'SCHEDULER_ROLE' as const,
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: MarketManagerABI,
      functionName: 'SCHEDULER_ROLE' as const,
      data: bytesToHex(result.data),
    }) as `0x${string}`
  }

  sETTLERROLE(
    runtime: Runtime<unknown>,
  ): `0x${string}` {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'SETTLER_ROLE' as const,
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: MarketManagerABI,
      functionName: 'SETTLER_ROLE' as const,
      data: bytesToHex(result.data),
    }) as `0x${string}`
  }

  getMarket(
    runtime: Runtime<unknown>,
    marketId: bigint,
  ): { matchId: bigint; templateId: `0x${string}`; windowStart: number; windowEnd: number; openedAt: bigint; closesAt: bigint; qualifyingEventTs: bigint; state: number; outcome: number; teamFilter: number } {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'getMarket' as const,
      args: [marketId],
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: MarketManagerABI,
      functionName: 'getMarket' as const,
      data: bytesToHex(result.data),
    }) as { matchId: bigint; templateId: `0x${string}`; windowStart: number; windowEnd: number; openedAt: bigint; closesAt: bigint; qualifyingEventTs: bigint; state: number; outcome: number; teamFilter: number }
  }

  getRoleAdmin(
    runtime: Runtime<unknown>,
    role: `0x${string}`,
  ): `0x${string}` {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'getRoleAdmin' as const,
      args: [role],
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: MarketManagerABI,
      functionName: 'getRoleAdmin' as const,
      data: bytesToHex(result.data),
    }) as `0x${string}`
  }

  hasRole(
    runtime: Runtime<unknown>,
    role: `0x${string}`,
    account: `0x${string}`,
  ): boolean {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'hasRole' as const,
      args: [role, account],
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: MarketManagerABI,
      functionName: 'hasRole' as const,
      data: bytesToHex(result.data),
    }) as boolean
  }

  isBettable(
    runtime: Runtime<unknown>,
    marketId: bigint,
  ): boolean {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'isBettable' as const,
      args: [marketId],
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: MarketManagerABI,
      functionName: 'isBettable' as const,
      data: bytesToHex(result.data),
    }) as boolean
  }

  marketCount(
    runtime: Runtime<unknown>,
  ): bigint {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'marketCount' as const,
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: MarketManagerABI,
      functionName: 'marketCount' as const,
      data: bytesToHex(result.data),
    }) as bigint
  }

  matchCount(
    runtime: Runtime<unknown>,
  ): bigint {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'matchCount' as const,
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: MarketManagerABI,
      functionName: 'matchCount' as const,
      data: bytesToHex(result.data),
    }) as bigint
  }

  matchExists(
    runtime: Runtime<unknown>,
    matchId: bigint,
  ): boolean {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'matchExists' as const,
      args: [matchId],
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: MarketManagerABI,
      functionName: 'matchExists' as const,
      data: bytesToHex(result.data),
    }) as boolean
  }

  supportsInterface(
    runtime: Runtime<unknown>,
    interfaceId: `0x${string}`,
  ): boolean {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'supportsInterface' as const,
      args: [interfaceId],
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: MarketManagerABI,
      functionName: 'supportsInterface' as const,
      data: bytesToHex(result.data),
    }) as boolean
  }

  templateEnabled(
    runtime: Runtime<unknown>,
    templateId: `0x${string}`,
  ): boolean {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'templateEnabled' as const,
      args: [templateId],
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: MarketManagerABI,
      functionName: 'templateEnabled' as const,
      data: bytesToHex(result.data),
    }) as boolean
  }

  writeReportFromClose(
    runtime: Runtime<unknown>,
    marketId: bigint,
    gasConfig?: { gasLimit?: string },
  ) {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'close' as const,
      args: [marketId],
    })

    const reportResponse = runtime
      .report(prepareReportRequest(callData))
      .result()

    return this.client
      .writeReport(runtime, {
        receiver: this.address,
        report: reportResponse,
        gasConfig,
      })
      .result()
  }

  writeReportFromCreateMatch(
    runtime: Runtime<unknown>,
    sourceRef: `0x${string}`,
    kickoffTs: bigint,
    metadataURI: string,
    gasConfig?: { gasLimit?: string },
  ) {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'createMatch' as const,
      args: [sourceRef, kickoffTs, metadataURI],
    })

    const reportResponse = runtime
      .report(prepareReportRequest(callData))
      .result()

    return this.client
      .writeReport(runtime, {
        receiver: this.address,
        report: reportResponse,
        gasConfig,
      })
      .result()
  }

  writeReportFromGrantRole(
    runtime: Runtime<unknown>,
    role: `0x${string}`,
    account: `0x${string}`,
    gasConfig?: { gasLimit?: string },
  ) {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'grantRole' as const,
      args: [role, account],
    })

    const reportResponse = runtime
      .report(prepareReportRequest(callData))
      .result()

    return this.client
      .writeReport(runtime, {
        receiver: this.address,
        report: reportResponse,
        gasConfig,
      })
      .result()
  }

  writeReportFromOpenMarket(
    runtime: Runtime<unknown>,
    matchId: bigint,
    templateId: `0x${string}`,
    windowStart: number,
    windowEnd: number,
    closesAt: bigint,
    teamFilter: number,
    gasConfig?: { gasLimit?: string },
  ) {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'openMarket' as const,
      args: [matchId, templateId, windowStart, windowEnd, closesAt, teamFilter],
    })

    const reportResponse = runtime
      .report(prepareReportRequest(callData))
      .result()

    return this.client
      .writeReport(runtime, {
        receiver: this.address,
        report: reportResponse,
        gasConfig,
      })
      .result()
  }

  writeReportFromRenounceRole(
    runtime: Runtime<unknown>,
    role: `0x${string}`,
    callerConfirmation: `0x${string}`,
    gasConfig?: { gasLimit?: string },
  ) {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'renounceRole' as const,
      args: [role, callerConfirmation],
    })

    const reportResponse = runtime
      .report(prepareReportRequest(callData))
      .result()

    return this.client
      .writeReport(runtime, {
        receiver: this.address,
        report: reportResponse,
        gasConfig,
      })
      .result()
  }

  writeReportFromResolve(
    runtime: Runtime<unknown>,
    marketId: bigint,
    outcome: number,
    qualifyingEventTs: bigint,
    gasConfig?: { gasLimit?: string },
  ) {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'resolve' as const,
      args: [marketId, outcome, qualifyingEventTs],
    })

    const reportResponse = runtime
      .report(prepareReportRequest(callData))
      .result()

    return this.client
      .writeReport(runtime, {
        receiver: this.address,
        report: reportResponse,
        gasConfig,
      })
      .result()
  }

  writeReportFromResume(
    runtime: Runtime<unknown>,
    marketId: bigint,
    gasConfig?: { gasLimit?: string },
  ) {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'resume' as const,
      args: [marketId],
    })

    const reportResponse = runtime
      .report(prepareReportRequest(callData))
      .result()

    return this.client
      .writeReport(runtime, {
        receiver: this.address,
        report: reportResponse,
        gasConfig,
      })
      .result()
  }

  writeReportFromRevokeRole(
    runtime: Runtime<unknown>,
    role: `0x${string}`,
    account: `0x${string}`,
    gasConfig?: { gasLimit?: string },
  ) {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'revokeRole' as const,
      args: [role, account],
    })

    const reportResponse = runtime
      .report(prepareReportRequest(callData))
      .result()

    return this.client
      .writeReport(runtime, {
        receiver: this.address,
        report: reportResponse,
        gasConfig,
      })
      .result()
  }

  writeReportFromSetTemplate(
    runtime: Runtime<unknown>,
    templateId: `0x${string}`,
    enabled: boolean,
    gasConfig?: { gasLimit?: string },
  ) {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'setTemplate' as const,
      args: [templateId, enabled],
    })

    const reportResponse = runtime
      .report(prepareReportRequest(callData))
      .result()

    return this.client
      .writeReport(runtime, {
        receiver: this.address,
        report: reportResponse,
        gasConfig,
      })
      .result()
  }

  writeReportFromSuspend(
    runtime: Runtime<unknown>,
    marketId: bigint,
    reason: `0x${string}`,
    gasConfig?: { gasLimit?: string },
  ) {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'suspend' as const,
      args: [marketId, reason],
    })

    const reportResponse = runtime
      .report(prepareReportRequest(callData))
      .result()

    return this.client
      .writeReport(runtime, {
        receiver: this.address,
        report: reportResponse,
        gasConfig,
      })
      .result()
  }

  writeReportFromVoidMarket(
    runtime: Runtime<unknown>,
    marketId: bigint,
    reason: `0x${string}`,
    gasConfig?: { gasLimit?: string },
  ) {
    const callData = encodeFunctionData({
      abi: MarketManagerABI,
      functionName: 'voidMarket' as const,
      args: [marketId, reason],
    })

    const reportResponse = runtime
      .report(prepareReportRequest(callData))
      .result()

    return this.client
      .writeReport(runtime, {
        receiver: this.address,
        report: reportResponse,
        gasConfig,
      })
      .result()
  }

  writeReport(
    runtime: Runtime<unknown>,
    callData: Hex,
    gasConfig?: { gasLimit?: string },
  ) {
    const reportResponse = runtime
      .report(prepareReportRequest(callData))
      .result()

    return this.client
      .writeReport(runtime, {
        receiver: this.address,
        report: reportResponse,
        gasConfig,
      })
      .result()
  }

  /**
   * Creates a log trigger for MarketClosed events.
   * The returned trigger's adapt method decodes the raw log into MarketClosedDecoded,
   * so the handler receives typed event data directly.
   * When multiple filters are provided, topic values are merged with OR semantics (match any).
   */
  logTriggerMarketClosed(
    filters?: MarketClosedTopics[],
  ) {
    let topics: { values: string[] }[]
    if (!filters || filters.length === 0) {
      const encoded = encodeEventTopics({
        abi: MarketManagerABI,
        eventName: 'MarketClosed' as const,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else if (filters.length === 1) {
      const f = filters[0]
      const args = {
        marketId: f.marketId,
      }
      const encoded = encodeEventTopics({
        abi: MarketManagerABI,
        eventName: 'MarketClosed' as const,
        args,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else {
      const allEncoded = filters.map((f) => {
        const args = {
          marketId: f.marketId,
        }
        return encodeEventTopics({
          abi: MarketManagerABI,
          eventName: 'MarketClosed' as const,
          args,
        })
      })
      topics = allEncoded[0].map((_, i) => ({
        values: [...new Set(allEncoded.flatMap((row) => encodeTopicValue(row[i])))],
      }))
    }
    const baseTrigger = this.client.logTrigger({
      addresses: [hexToBase64(this.address)],
      topics,
    })
    const contract = this
    return {
      capabilityId: () => baseTrigger.capabilityId(),
      method: () => baseTrigger.method(),
      outputSchema: () => baseTrigger.outputSchema(),
      configAsAny: () => baseTrigger.configAsAny(),
      adapt: (rawOutput: EVMLog): DecodedLog<MarketClosedDecoded> => contract.decodeMarketClosed(rawOutput),
    }
  }

  /**
   * Decodes a log into MarketClosed data, preserving all log metadata.
   */
  decodeMarketClosed(log: EVMLog): DecodedLog<MarketClosedDecoded> {
    const decoded = decodeEventLog({
      abi: MarketManagerABI,
      data: bytesToHex(log.data),
      topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
    })
    const { data: _, ...rest } = log
    return { ...rest, data: decoded.args as unknown as MarketClosedDecoded }
  }

  /**
   * Creates a log trigger for MarketOpened events.
   * The returned trigger's adapt method decodes the raw log into MarketOpenedDecoded,
   * so the handler receives typed event data directly.
   * When multiple filters are provided, topic values are merged with OR semantics (match any).
   */
  logTriggerMarketOpened(
    filters?: MarketOpenedTopics[],
  ) {
    let topics: { values: string[] }[]
    if (!filters || filters.length === 0) {
      const encoded = encodeEventTopics({
        abi: MarketManagerABI,
        eventName: 'MarketOpened' as const,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else if (filters.length === 1) {
      const f = filters[0]
      const args = {
        marketId: f.marketId,
        matchId: f.matchId,
        templateId: f.templateId,
      }
      const encoded = encodeEventTopics({
        abi: MarketManagerABI,
        eventName: 'MarketOpened' as const,
        args,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else {
      const allEncoded = filters.map((f) => {
        const args = {
          marketId: f.marketId,
          matchId: f.matchId,
          templateId: f.templateId,
        }
        return encodeEventTopics({
          abi: MarketManagerABI,
          eventName: 'MarketOpened' as const,
          args,
        })
      })
      topics = allEncoded[0].map((_, i) => ({
        values: [...new Set(allEncoded.flatMap((row) => encodeTopicValue(row[i])))],
      }))
    }
    const baseTrigger = this.client.logTrigger({
      addresses: [hexToBase64(this.address)],
      topics,
    })
    const contract = this
    return {
      capabilityId: () => baseTrigger.capabilityId(),
      method: () => baseTrigger.method(),
      outputSchema: () => baseTrigger.outputSchema(),
      configAsAny: () => baseTrigger.configAsAny(),
      adapt: (rawOutput: EVMLog): DecodedLog<MarketOpenedDecoded> => contract.decodeMarketOpened(rawOutput),
    }
  }

  /**
   * Decodes a log into MarketOpened data, preserving all log metadata.
   */
  decodeMarketOpened(log: EVMLog): DecodedLog<MarketOpenedDecoded> {
    const decoded = decodeEventLog({
      abi: MarketManagerABI,
      data: bytesToHex(log.data),
      topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
    })
    const { data: _, ...rest } = log
    return { ...rest, data: decoded.args as unknown as MarketOpenedDecoded }
  }

  /**
   * Creates a log trigger for MarketResolved events.
   * The returned trigger's adapt method decodes the raw log into MarketResolvedDecoded,
   * so the handler receives typed event data directly.
   * When multiple filters are provided, topic values are merged with OR semantics (match any).
   */
  logTriggerMarketResolved(
    filters?: MarketResolvedTopics[],
  ) {
    let topics: { values: string[] }[]
    if (!filters || filters.length === 0) {
      const encoded = encodeEventTopics({
        abi: MarketManagerABI,
        eventName: 'MarketResolved' as const,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else if (filters.length === 1) {
      const f = filters[0]
      const args = {
        marketId: f.marketId,
      }
      const encoded = encodeEventTopics({
        abi: MarketManagerABI,
        eventName: 'MarketResolved' as const,
        args,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else {
      const allEncoded = filters.map((f) => {
        const args = {
          marketId: f.marketId,
        }
        return encodeEventTopics({
          abi: MarketManagerABI,
          eventName: 'MarketResolved' as const,
          args,
        })
      })
      topics = allEncoded[0].map((_, i) => ({
        values: [...new Set(allEncoded.flatMap((row) => encodeTopicValue(row[i])))],
      }))
    }
    const baseTrigger = this.client.logTrigger({
      addresses: [hexToBase64(this.address)],
      topics,
    })
    const contract = this
    return {
      capabilityId: () => baseTrigger.capabilityId(),
      method: () => baseTrigger.method(),
      outputSchema: () => baseTrigger.outputSchema(),
      configAsAny: () => baseTrigger.configAsAny(),
      adapt: (rawOutput: EVMLog): DecodedLog<MarketResolvedDecoded> => contract.decodeMarketResolved(rawOutput),
    }
  }

  /**
   * Decodes a log into MarketResolved data, preserving all log metadata.
   */
  decodeMarketResolved(log: EVMLog): DecodedLog<MarketResolvedDecoded> {
    const decoded = decodeEventLog({
      abi: MarketManagerABI,
      data: bytesToHex(log.data),
      topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
    })
    const { data: _, ...rest } = log
    return { ...rest, data: decoded.args as unknown as MarketResolvedDecoded }
  }

  /**
   * Creates a log trigger for MarketResumed events.
   * The returned trigger's adapt method decodes the raw log into MarketResumedDecoded,
   * so the handler receives typed event data directly.
   * When multiple filters are provided, topic values are merged with OR semantics (match any).
   */
  logTriggerMarketResumed(
    filters?: MarketResumedTopics[],
  ) {
    let topics: { values: string[] }[]
    if (!filters || filters.length === 0) {
      const encoded = encodeEventTopics({
        abi: MarketManagerABI,
        eventName: 'MarketResumed' as const,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else if (filters.length === 1) {
      const f = filters[0]
      const args = {
        marketId: f.marketId,
      }
      const encoded = encodeEventTopics({
        abi: MarketManagerABI,
        eventName: 'MarketResumed' as const,
        args,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else {
      const allEncoded = filters.map((f) => {
        const args = {
          marketId: f.marketId,
        }
        return encodeEventTopics({
          abi: MarketManagerABI,
          eventName: 'MarketResumed' as const,
          args,
        })
      })
      topics = allEncoded[0].map((_, i) => ({
        values: [...new Set(allEncoded.flatMap((row) => encodeTopicValue(row[i])))],
      }))
    }
    const baseTrigger = this.client.logTrigger({
      addresses: [hexToBase64(this.address)],
      topics,
    })
    const contract = this
    return {
      capabilityId: () => baseTrigger.capabilityId(),
      method: () => baseTrigger.method(),
      outputSchema: () => baseTrigger.outputSchema(),
      configAsAny: () => baseTrigger.configAsAny(),
      adapt: (rawOutput: EVMLog): DecodedLog<MarketResumedDecoded> => contract.decodeMarketResumed(rawOutput),
    }
  }

  /**
   * Decodes a log into MarketResumed data, preserving all log metadata.
   */
  decodeMarketResumed(log: EVMLog): DecodedLog<MarketResumedDecoded> {
    const decoded = decodeEventLog({
      abi: MarketManagerABI,
      data: bytesToHex(log.data),
      topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
    })
    const { data: _, ...rest } = log
    return { ...rest, data: decoded.args as unknown as MarketResumedDecoded }
  }

  /**
   * Creates a log trigger for MarketSuspended events.
   * The returned trigger's adapt method decodes the raw log into MarketSuspendedDecoded,
   * so the handler receives typed event data directly.
   * When multiple filters are provided, topic values are merged with OR semantics (match any).
   */
  logTriggerMarketSuspended(
    filters?: MarketSuspendedTopics[],
  ) {
    let topics: { values: string[] }[]
    if (!filters || filters.length === 0) {
      const encoded = encodeEventTopics({
        abi: MarketManagerABI,
        eventName: 'MarketSuspended' as const,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else if (filters.length === 1) {
      const f = filters[0]
      const args = {
        marketId: f.marketId,
      }
      const encoded = encodeEventTopics({
        abi: MarketManagerABI,
        eventName: 'MarketSuspended' as const,
        args,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else {
      const allEncoded = filters.map((f) => {
        const args = {
          marketId: f.marketId,
        }
        return encodeEventTopics({
          abi: MarketManagerABI,
          eventName: 'MarketSuspended' as const,
          args,
        })
      })
      topics = allEncoded[0].map((_, i) => ({
        values: [...new Set(allEncoded.flatMap((row) => encodeTopicValue(row[i])))],
      }))
    }
    const baseTrigger = this.client.logTrigger({
      addresses: [hexToBase64(this.address)],
      topics,
    })
    const contract = this
    return {
      capabilityId: () => baseTrigger.capabilityId(),
      method: () => baseTrigger.method(),
      outputSchema: () => baseTrigger.outputSchema(),
      configAsAny: () => baseTrigger.configAsAny(),
      adapt: (rawOutput: EVMLog): DecodedLog<MarketSuspendedDecoded> => contract.decodeMarketSuspended(rawOutput),
    }
  }

  /**
   * Decodes a log into MarketSuspended data, preserving all log metadata.
   */
  decodeMarketSuspended(log: EVMLog): DecodedLog<MarketSuspendedDecoded> {
    const decoded = decodeEventLog({
      abi: MarketManagerABI,
      data: bytesToHex(log.data),
      topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
    })
    const { data: _, ...rest } = log
    return { ...rest, data: decoded.args as unknown as MarketSuspendedDecoded }
  }

  /**
   * Creates a log trigger for MarketVoided events.
   * The returned trigger's adapt method decodes the raw log into MarketVoidedDecoded,
   * so the handler receives typed event data directly.
   * When multiple filters are provided, topic values are merged with OR semantics (match any).
   */
  logTriggerMarketVoided(
    filters?: MarketVoidedTopics[],
  ) {
    let topics: { values: string[] }[]
    if (!filters || filters.length === 0) {
      const encoded = encodeEventTopics({
        abi: MarketManagerABI,
        eventName: 'MarketVoided' as const,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else if (filters.length === 1) {
      const f = filters[0]
      const args = {
        marketId: f.marketId,
      }
      const encoded = encodeEventTopics({
        abi: MarketManagerABI,
        eventName: 'MarketVoided' as const,
        args,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else {
      const allEncoded = filters.map((f) => {
        const args = {
          marketId: f.marketId,
        }
        return encodeEventTopics({
          abi: MarketManagerABI,
          eventName: 'MarketVoided' as const,
          args,
        })
      })
      topics = allEncoded[0].map((_, i) => ({
        values: [...new Set(allEncoded.flatMap((row) => encodeTopicValue(row[i])))],
      }))
    }
    const baseTrigger = this.client.logTrigger({
      addresses: [hexToBase64(this.address)],
      topics,
    })
    const contract = this
    return {
      capabilityId: () => baseTrigger.capabilityId(),
      method: () => baseTrigger.method(),
      outputSchema: () => baseTrigger.outputSchema(),
      configAsAny: () => baseTrigger.configAsAny(),
      adapt: (rawOutput: EVMLog): DecodedLog<MarketVoidedDecoded> => contract.decodeMarketVoided(rawOutput),
    }
  }

  /**
   * Decodes a log into MarketVoided data, preserving all log metadata.
   */
  decodeMarketVoided(log: EVMLog): DecodedLog<MarketVoidedDecoded> {
    const decoded = decodeEventLog({
      abi: MarketManagerABI,
      data: bytesToHex(log.data),
      topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
    })
    const { data: _, ...rest } = log
    return { ...rest, data: decoded.args as unknown as MarketVoidedDecoded }
  }

  /**
   * Creates a log trigger for MatchCreated events.
   * The returned trigger's adapt method decodes the raw log into MatchCreatedDecoded,
   * so the handler receives typed event data directly.
   * When multiple filters are provided, topic values are merged with OR semantics (match any).
   */
  logTriggerMatchCreated(
    filters?: MatchCreatedTopics[],
  ) {
    let topics: { values: string[] }[]
    if (!filters || filters.length === 0) {
      const encoded = encodeEventTopics({
        abi: MarketManagerABI,
        eventName: 'MatchCreated' as const,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else if (filters.length === 1) {
      const f = filters[0]
      const args = {
        matchId: f.matchId,
      }
      const encoded = encodeEventTopics({
        abi: MarketManagerABI,
        eventName: 'MatchCreated' as const,
        args,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else {
      const allEncoded = filters.map((f) => {
        const args = {
          matchId: f.matchId,
        }
        return encodeEventTopics({
          abi: MarketManagerABI,
          eventName: 'MatchCreated' as const,
          args,
        })
      })
      topics = allEncoded[0].map((_, i) => ({
        values: [...new Set(allEncoded.flatMap((row) => encodeTopicValue(row[i])))],
      }))
    }
    const baseTrigger = this.client.logTrigger({
      addresses: [hexToBase64(this.address)],
      topics,
    })
    const contract = this
    return {
      capabilityId: () => baseTrigger.capabilityId(),
      method: () => baseTrigger.method(),
      outputSchema: () => baseTrigger.outputSchema(),
      configAsAny: () => baseTrigger.configAsAny(),
      adapt: (rawOutput: EVMLog): DecodedLog<MatchCreatedDecoded> => contract.decodeMatchCreated(rawOutput),
    }
  }

  /**
   * Decodes a log into MatchCreated data, preserving all log metadata.
   */
  decodeMatchCreated(log: EVMLog): DecodedLog<MatchCreatedDecoded> {
    const decoded = decodeEventLog({
      abi: MarketManagerABI,
      data: bytesToHex(log.data),
      topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
    })
    const { data: _, ...rest } = log
    return { ...rest, data: decoded.args as unknown as MatchCreatedDecoded }
  }

  /**
   * Creates a log trigger for RoleAdminChanged events.
   * The returned trigger's adapt method decodes the raw log into RoleAdminChangedDecoded,
   * so the handler receives typed event data directly.
   * When multiple filters are provided, topic values are merged with OR semantics (match any).
   */
  logTriggerRoleAdminChanged(
    filters?: RoleAdminChangedTopics[],
  ) {
    let topics: { values: string[] }[]
    if (!filters || filters.length === 0) {
      const encoded = encodeEventTopics({
        abi: MarketManagerABI,
        eventName: 'RoleAdminChanged' as const,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else if (filters.length === 1) {
      const f = filters[0]
      const args = {
        role: f.role,
        previousAdminRole: f.previousAdminRole,
        newAdminRole: f.newAdminRole,
      }
      const encoded = encodeEventTopics({
        abi: MarketManagerABI,
        eventName: 'RoleAdminChanged' as const,
        args,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else {
      const allEncoded = filters.map((f) => {
        const args = {
          role: f.role,
          previousAdminRole: f.previousAdminRole,
          newAdminRole: f.newAdminRole,
        }
        return encodeEventTopics({
          abi: MarketManagerABI,
          eventName: 'RoleAdminChanged' as const,
          args,
        })
      })
      topics = allEncoded[0].map((_, i) => ({
        values: [...new Set(allEncoded.flatMap((row) => encodeTopicValue(row[i])))],
      }))
    }
    const baseTrigger = this.client.logTrigger({
      addresses: [hexToBase64(this.address)],
      topics,
    })
    const contract = this
    return {
      capabilityId: () => baseTrigger.capabilityId(),
      method: () => baseTrigger.method(),
      outputSchema: () => baseTrigger.outputSchema(),
      configAsAny: () => baseTrigger.configAsAny(),
      adapt: (rawOutput: EVMLog): DecodedLog<RoleAdminChangedDecoded> => contract.decodeRoleAdminChanged(rawOutput),
    }
  }

  /**
   * Decodes a log into RoleAdminChanged data, preserving all log metadata.
   */
  decodeRoleAdminChanged(log: EVMLog): DecodedLog<RoleAdminChangedDecoded> {
    const decoded = decodeEventLog({
      abi: MarketManagerABI,
      data: bytesToHex(log.data),
      topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
    })
    const { data: _, ...rest } = log
    return { ...rest, data: decoded.args as unknown as RoleAdminChangedDecoded }
  }

  /**
   * Creates a log trigger for RoleGranted events.
   * The returned trigger's adapt method decodes the raw log into RoleGrantedDecoded,
   * so the handler receives typed event data directly.
   * When multiple filters are provided, topic values are merged with OR semantics (match any).
   */
  logTriggerRoleGranted(
    filters?: RoleGrantedTopics[],
  ) {
    let topics: { values: string[] }[]
    if (!filters || filters.length === 0) {
      const encoded = encodeEventTopics({
        abi: MarketManagerABI,
        eventName: 'RoleGranted' as const,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else if (filters.length === 1) {
      const f = filters[0]
      const args = {
        role: f.role,
        account: f.account,
        sender: f.sender,
      }
      const encoded = encodeEventTopics({
        abi: MarketManagerABI,
        eventName: 'RoleGranted' as const,
        args,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else {
      const allEncoded = filters.map((f) => {
        const args = {
          role: f.role,
          account: f.account,
          sender: f.sender,
        }
        return encodeEventTopics({
          abi: MarketManagerABI,
          eventName: 'RoleGranted' as const,
          args,
        })
      })
      topics = allEncoded[0].map((_, i) => ({
        values: [...new Set(allEncoded.flatMap((row) => encodeTopicValue(row[i])))],
      }))
    }
    const baseTrigger = this.client.logTrigger({
      addresses: [hexToBase64(this.address)],
      topics,
    })
    const contract = this
    return {
      capabilityId: () => baseTrigger.capabilityId(),
      method: () => baseTrigger.method(),
      outputSchema: () => baseTrigger.outputSchema(),
      configAsAny: () => baseTrigger.configAsAny(),
      adapt: (rawOutput: EVMLog): DecodedLog<RoleGrantedDecoded> => contract.decodeRoleGranted(rawOutput),
    }
  }

  /**
   * Decodes a log into RoleGranted data, preserving all log metadata.
   */
  decodeRoleGranted(log: EVMLog): DecodedLog<RoleGrantedDecoded> {
    const decoded = decodeEventLog({
      abi: MarketManagerABI,
      data: bytesToHex(log.data),
      topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
    })
    const { data: _, ...rest } = log
    return { ...rest, data: decoded.args as unknown as RoleGrantedDecoded }
  }

  /**
   * Creates a log trigger for RoleRevoked events.
   * The returned trigger's adapt method decodes the raw log into RoleRevokedDecoded,
   * so the handler receives typed event data directly.
   * When multiple filters are provided, topic values are merged with OR semantics (match any).
   */
  logTriggerRoleRevoked(
    filters?: RoleRevokedTopics[],
  ) {
    let topics: { values: string[] }[]
    if (!filters || filters.length === 0) {
      const encoded = encodeEventTopics({
        abi: MarketManagerABI,
        eventName: 'RoleRevoked' as const,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else if (filters.length === 1) {
      const f = filters[0]
      const args = {
        role: f.role,
        account: f.account,
        sender: f.sender,
      }
      const encoded = encodeEventTopics({
        abi: MarketManagerABI,
        eventName: 'RoleRevoked' as const,
        args,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else {
      const allEncoded = filters.map((f) => {
        const args = {
          role: f.role,
          account: f.account,
          sender: f.sender,
        }
        return encodeEventTopics({
          abi: MarketManagerABI,
          eventName: 'RoleRevoked' as const,
          args,
        })
      })
      topics = allEncoded[0].map((_, i) => ({
        values: [...new Set(allEncoded.flatMap((row) => encodeTopicValue(row[i])))],
      }))
    }
    const baseTrigger = this.client.logTrigger({
      addresses: [hexToBase64(this.address)],
      topics,
    })
    const contract = this
    return {
      capabilityId: () => baseTrigger.capabilityId(),
      method: () => baseTrigger.method(),
      outputSchema: () => baseTrigger.outputSchema(),
      configAsAny: () => baseTrigger.configAsAny(),
      adapt: (rawOutput: EVMLog): DecodedLog<RoleRevokedDecoded> => contract.decodeRoleRevoked(rawOutput),
    }
  }

  /**
   * Decodes a log into RoleRevoked data, preserving all log metadata.
   */
  decodeRoleRevoked(log: EVMLog): DecodedLog<RoleRevokedDecoded> {
    const decoded = decodeEventLog({
      abi: MarketManagerABI,
      data: bytesToHex(log.data),
      topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
    })
    const { data: _, ...rest } = log
    return { ...rest, data: decoded.args as unknown as RoleRevokedDecoded }
  }

  /**
   * Creates a log trigger for TemplateSet events.
   * The returned trigger's adapt method decodes the raw log into TemplateSetDecoded,
   * so the handler receives typed event data directly.
   * When multiple filters are provided, topic values are merged with OR semantics (match any).
   */
  logTriggerTemplateSet(
    filters?: TemplateSetTopics[],
  ) {
    let topics: { values: string[] }[]
    if (!filters || filters.length === 0) {
      const encoded = encodeEventTopics({
        abi: MarketManagerABI,
        eventName: 'TemplateSet' as const,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else if (filters.length === 1) {
      const f = filters[0]
      const args = {
        templateId: f.templateId,
      }
      const encoded = encodeEventTopics({
        abi: MarketManagerABI,
        eventName: 'TemplateSet' as const,
        args,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else {
      const allEncoded = filters.map((f) => {
        const args = {
          templateId: f.templateId,
        }
        return encodeEventTopics({
          abi: MarketManagerABI,
          eventName: 'TemplateSet' as const,
          args,
        })
      })
      topics = allEncoded[0].map((_, i) => ({
        values: [...new Set(allEncoded.flatMap((row) => encodeTopicValue(row[i])))],
      }))
    }
    const baseTrigger = this.client.logTrigger({
      addresses: [hexToBase64(this.address)],
      topics,
    })
    const contract = this
    return {
      capabilityId: () => baseTrigger.capabilityId(),
      method: () => baseTrigger.method(),
      outputSchema: () => baseTrigger.outputSchema(),
      configAsAny: () => baseTrigger.configAsAny(),
      adapt: (rawOutput: EVMLog): DecodedLog<TemplateSetDecoded> => contract.decodeTemplateSet(rawOutput),
    }
  }

  /**
   * Decodes a log into TemplateSet data, preserving all log metadata.
   */
  decodeTemplateSet(log: EVMLog): DecodedLog<TemplateSetDecoded> {
    const decoded = decodeEventLog({
      abi: MarketManagerABI,
      data: bytesToHex(log.data),
      topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
    })
    const { data: _, ...rest } = log
    return { ...rest, data: decoded.args as unknown as TemplateSetDecoded }
  }
}

