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
 * Filter params for ExpectedWorkflowSet. Only indexed fields can be used for filtering.
 * Indexed string/bytes must be passed as keccak256 hash (Hex).
 */
export type ExpectedWorkflowSetTopics = {
}

/**
 * Decoded ExpectedWorkflowSet event data.
 */
export type ExpectedWorkflowSetDecoded = {
  workflowId: `0x${string}`
  workflowName: `0x${string}`
  workflowOwner: `0x${string}`
}


/**
 * Filter params for ForwarderAllowed. Only indexed fields can be used for filtering.
 * Indexed string/bytes must be passed as keccak256 hash (Hex).
 */
export type ForwarderAllowedTopics = {
  forwarder?: `0x${string}`
}

/**
 * Decoded ForwarderAllowed event data.
 */
export type ForwarderAllowedDecoded = {
  forwarder: `0x${string}`
  allowed: boolean
}


/**
 * Filter params for MarketSettledFromReport. Only indexed fields can be used for filtering.
 * Indexed string/bytes must be passed as keccak256 hash (Hex).
 */
export type MarketSettledFromReportTopics = {
  marketId?: bigint
}

/**
 * Decoded MarketSettledFromReport event data.
 */
export type MarketSettledFromReportDecoded = {
  marketId: bigint
  outcome: number
  qualifyingEventTs: bigint
  evidenceHash: `0x${string}`
}


/**
 * Filter params for OwnershipTransferStarted. Only indexed fields can be used for filtering.
 * Indexed string/bytes must be passed as keccak256 hash (Hex).
 */
export type OwnershipTransferStartedTopics = {
  previousOwner?: `0x${string}`
  newOwner?: `0x${string}`
}

/**
 * Decoded OwnershipTransferStarted event data.
 */
export type OwnershipTransferStartedDecoded = {
  previousOwner: `0x${string}`
  newOwner: `0x${string}`
}


/**
 * Filter params for OwnershipTransferred. Only indexed fields can be used for filtering.
 * Indexed string/bytes must be passed as keccak256 hash (Hex).
 */
export type OwnershipTransferredTopics = {
  previousOwner?: `0x${string}`
  newOwner?: `0x${string}`
}

/**
 * Decoded OwnershipTransferred event data.
 */
export type OwnershipTransferredDecoded = {
  previousOwner: `0x${string}`
  newOwner: `0x${string}`
}


/**
 * Filter params for ProductionLocked. Only indexed fields can be used for filtering.
 * Indexed string/bytes must be passed as keccak256 hash (Hex).
 */
export type ProductionLockedTopics = {
}

/**
 * Decoded ProductionLocked event data.
 */
export type ProductionLockedDecoded = {
}


/**
 * Filter params for ReportAccepted. Only indexed fields can be used for filtering.
 * Indexed string/bytes must be passed as keccak256 hash (Hex).
 */
export type ReportAcceptedTopics = {
  forwarder?: `0x${string}`
  matchId?: bigint
}

/**
 * Decoded ReportAccepted event data.
 */
export type ReportAcceptedDecoded = {
  forwarder: `0x${string}`
  workflowId: `0x${string}`
  workflowName: `0x${string}`
  workflowOwner: `0x${string}`
  matchId: bigint
  marketCount: bigint
  producedAt: bigint
}


/**
 * Filter params for ReportRejected. Only indexed fields can be used for filtering.
 * Indexed string/bytes must be passed as keccak256 hash (Hex).
 */
export type ReportRejectedTopics = {
  marketId?: bigint
}

/**
 * Decoded ReportRejected event data.
 */
export type ReportRejectedDecoded = {
  marketId: bigint
  reason: `0x${string}`
}


/**
 * Filter params for SimAttestorSet. Only indexed fields can be used for filtering.
 * Indexed string/bytes must be passed as keccak256 hash (Hex).
 */
export type SimAttestorSetTopics = {
  attestor?: `0x${string}`
}

/**
 * Decoded SimAttestorSet event data.
 */
export type SimAttestorSetDecoded = {
  attestor: `0x${string}`
}


export const SettlementReceiverABI = [{"type":"constructor","inputs":[{"name":"admin","type":"address","internalType":"address"},{"name":"markets_","type":"address","internalType":"contractIMarketManager"},{"name":"productionForwarder_","type":"address","internalType":"address"},{"name":"simulationForwarder_","type":"address","internalType":"address"}],"stateMutability":"nonpayable"},{"type":"function","name":"MARKETS","inputs":[],"outputs":[{"name":"","type":"address","internalType":"contractIMarketManager"}],"stateMutability":"view"},{"type":"function","name":"PRODUCTION_FORWARDER","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},{"type":"function","name":"SIMULATION_FORWARDER","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},{"type":"function","name":"acceptOwnership","inputs":[],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"expectedWorkflowId","inputs":[],"outputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"stateMutability":"view"},{"type":"function","name":"expectedWorkflowName","inputs":[],"outputs":[{"name":"","type":"bytes10","internalType":"bytes10"}],"stateMutability":"view"},{"type":"function","name":"expectedWorkflowOwner","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},{"type":"function","name":"isAllowedForwarder","inputs":[{"name":"forwarder","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"lastProducedAt","inputs":[{"name":"matchId","type":"uint64","internalType":"uint64"}],"outputs":[{"name":"","type":"uint64","internalType":"uint64"}],"stateMutability":"view"},{"type":"function","name":"lockProduction","inputs":[],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"onReport","inputs":[{"name":"metadata","type":"bytes","internalType":"bytes"},{"name":"reportPayload","type":"bytes","internalType":"bytes"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"owner","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},{"type":"function","name":"pendingOwner","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},{"type":"function","name":"productionLocked","inputs":[],"outputs":[{"name":"","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"renounceOwnership","inputs":[],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"setExpectedWorkflow","inputs":[{"name":"workflowId","type":"bytes32","internalType":"bytes32"},{"name":"workflowName","type":"bytes10","internalType":"bytes10"},{"name":"workflowOwner","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"setForwarder","inputs":[{"name":"forwarder","type":"address","internalType":"address"},{"name":"allowed","type":"bool","internalType":"bool"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"setSimAttestor","inputs":[{"name":"attestor","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"simAttestor","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},{"type":"function","name":"simEnabled","inputs":[],"outputs":[{"name":"","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"simNonce","inputs":[{"name":"matchId","type":"uint64","internalType":"uint64"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"supportsInterface","inputs":[{"name":"interfaceId","type":"bytes4","internalType":"bytes4"}],"outputs":[{"name":"","type":"bool","internalType":"bool"}],"stateMutability":"pure"},{"type":"function","name":"transferOwnership","inputs":[{"name":"newOwner","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"event","name":"ExpectedWorkflowSet","inputs":[{"name":"workflowId","type":"bytes32","indexed":false,"internalType":"bytes32"},{"name":"workflowName","type":"bytes10","indexed":false,"internalType":"bytes10"},{"name":"workflowOwner","type":"address","indexed":false,"internalType":"address"}],"anonymous":false},{"type":"event","name":"ForwarderAllowed","inputs":[{"name":"forwarder","type":"address","indexed":true,"internalType":"address"},{"name":"allowed","type":"bool","indexed":false,"internalType":"bool"}],"anonymous":false},{"type":"event","name":"MarketSettledFromReport","inputs":[{"name":"marketId","type":"uint256","indexed":true,"internalType":"uint256"},{"name":"outcome","type":"uint8","indexed":false,"internalType":"uint8"},{"name":"qualifyingEventTs","type":"uint64","indexed":false,"internalType":"uint64"},{"name":"evidenceHash","type":"bytes32","indexed":false,"internalType":"bytes32"}],"anonymous":false},{"type":"event","name":"OwnershipTransferStarted","inputs":[{"name":"previousOwner","type":"address","indexed":true,"internalType":"address"},{"name":"newOwner","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},{"type":"event","name":"OwnershipTransferred","inputs":[{"name":"previousOwner","type":"address","indexed":true,"internalType":"address"},{"name":"newOwner","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},{"type":"event","name":"ProductionLocked","inputs":[],"anonymous":false},{"type":"event","name":"ReportAccepted","inputs":[{"name":"forwarder","type":"address","indexed":true,"internalType":"address"},{"name":"workflowId","type":"bytes32","indexed":false,"internalType":"bytes32"},{"name":"workflowName","type":"bytes10","indexed":false,"internalType":"bytes10"},{"name":"workflowOwner","type":"address","indexed":false,"internalType":"address"},{"name":"matchId","type":"uint64","indexed":true,"internalType":"uint64"},{"name":"marketCount","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"producedAt","type":"uint64","indexed":false,"internalType":"uint64"}],"anonymous":false},{"type":"event","name":"ReportRejected","inputs":[{"name":"marketId","type":"uint256","indexed":true,"internalType":"uint256"},{"name":"reason","type":"bytes32","indexed":false,"internalType":"bytes32"}],"anonymous":false},{"type":"event","name":"SimAttestorSet","inputs":[{"name":"attestor","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},{"type":"error","name":"ECDSAInvalidSignature","inputs":[]},{"type":"error","name":"ECDSAInvalidSignatureLength","inputs":[{"name":"length","type":"uint256","internalType":"uint256"}]},{"type":"error","name":"ECDSAInvalidSignatureS","inputs":[{"name":"s","type":"bytes32","internalType":"bytes32"}]},{"type":"error","name":"EmptyReport","inputs":[]},{"type":"error","name":"InvalidSimSignature","inputs":[]},{"type":"error","name":"MetadataTooShort","inputs":[{"name":"length","type":"uint256","internalType":"uint256"}]},{"type":"error","name":"NotAllowedForwarder","inputs":[{"name":"caller","type":"address","internalType":"address"}]},{"type":"error","name":"OwnableInvalidOwner","inputs":[{"name":"owner","type":"address","internalType":"address"}]},{"type":"error","name":"OwnableUnauthorizedAccount","inputs":[{"name":"account","type":"address","internalType":"address"}]},{"type":"error","name":"ProductionForwarderCannotBeDisabled","inputs":[]},{"type":"error","name":"ProductionIsLocked","inputs":[]},{"type":"error","name":"ReentrancyGuardReentrantCall","inputs":[]},{"type":"error","name":"StaleReport","inputs":[{"name":"matchId","type":"uint64","internalType":"uint64"},{"name":"producedAt","type":"uint64","internalType":"uint64"},{"name":"lastAccepted","type":"uint64","internalType":"uint64"}]},{"type":"error","name":"WorkflowMismatch","inputs":[{"name":"workflowId","type":"bytes32","internalType":"bytes32"},{"name":"workflowName","type":"bytes10","internalType":"bytes10"},{"name":"workflowOwner","type":"address","internalType":"address"}]}] as const

export class SettlementReceiver {
  constructor(
    private readonly client: EVMClient,
    public readonly address: Address,
  ) {}

  mARKETS(
    runtime: Runtime<unknown>,
  ): `0x${string}` {
    const callData = encodeFunctionData({
      abi: SettlementReceiverABI,
      functionName: 'MARKETS' as const,
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: SettlementReceiverABI,
      functionName: 'MARKETS' as const,
      data: bytesToHex(result.data),
    }) as `0x${string}`
  }

  pRODUCTIONFORWARDER(
    runtime: Runtime<unknown>,
  ): `0x${string}` {
    const callData = encodeFunctionData({
      abi: SettlementReceiverABI,
      functionName: 'PRODUCTION_FORWARDER' as const,
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: SettlementReceiverABI,
      functionName: 'PRODUCTION_FORWARDER' as const,
      data: bytesToHex(result.data),
    }) as `0x${string}`
  }

  sIMULATIONFORWARDER(
    runtime: Runtime<unknown>,
  ): `0x${string}` {
    const callData = encodeFunctionData({
      abi: SettlementReceiverABI,
      functionName: 'SIMULATION_FORWARDER' as const,
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: SettlementReceiverABI,
      functionName: 'SIMULATION_FORWARDER' as const,
      data: bytesToHex(result.data),
    }) as `0x${string}`
  }

  expectedWorkflowId(
    runtime: Runtime<unknown>,
  ): `0x${string}` {
    const callData = encodeFunctionData({
      abi: SettlementReceiverABI,
      functionName: 'expectedWorkflowId' as const,
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: SettlementReceiverABI,
      functionName: 'expectedWorkflowId' as const,
      data: bytesToHex(result.data),
    }) as `0x${string}`
  }

  expectedWorkflowName(
    runtime: Runtime<unknown>,
  ): `0x${string}` {
    const callData = encodeFunctionData({
      abi: SettlementReceiverABI,
      functionName: 'expectedWorkflowName' as const,
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: SettlementReceiverABI,
      functionName: 'expectedWorkflowName' as const,
      data: bytesToHex(result.data),
    }) as `0x${string}`
  }

  expectedWorkflowOwner(
    runtime: Runtime<unknown>,
  ): `0x${string}` {
    const callData = encodeFunctionData({
      abi: SettlementReceiverABI,
      functionName: 'expectedWorkflowOwner' as const,
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: SettlementReceiverABI,
      functionName: 'expectedWorkflowOwner' as const,
      data: bytesToHex(result.data),
    }) as `0x${string}`
  }

  isAllowedForwarder(
    runtime: Runtime<unknown>,
    forwarder: `0x${string}`,
  ): boolean {
    const callData = encodeFunctionData({
      abi: SettlementReceiverABI,
      functionName: 'isAllowedForwarder' as const,
      args: [forwarder],
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: SettlementReceiverABI,
      functionName: 'isAllowedForwarder' as const,
      data: bytesToHex(result.data),
    }) as boolean
  }

  lastProducedAt(
    runtime: Runtime<unknown>,
    matchId: bigint,
  ): bigint {
    const callData = encodeFunctionData({
      abi: SettlementReceiverABI,
      functionName: 'lastProducedAt' as const,
      args: [matchId],
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: SettlementReceiverABI,
      functionName: 'lastProducedAt' as const,
      data: bytesToHex(result.data),
    }) as bigint
  }

  owner(
    runtime: Runtime<unknown>,
  ): `0x${string}` {
    const callData = encodeFunctionData({
      abi: SettlementReceiverABI,
      functionName: 'owner' as const,
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: SettlementReceiverABI,
      functionName: 'owner' as const,
      data: bytesToHex(result.data),
    }) as `0x${string}`
  }

  pendingOwner(
    runtime: Runtime<unknown>,
  ): `0x${string}` {
    const callData = encodeFunctionData({
      abi: SettlementReceiverABI,
      functionName: 'pendingOwner' as const,
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: SettlementReceiverABI,
      functionName: 'pendingOwner' as const,
      data: bytesToHex(result.data),
    }) as `0x${string}`
  }

  productionLocked(
    runtime: Runtime<unknown>,
  ): boolean {
    const callData = encodeFunctionData({
      abi: SettlementReceiverABI,
      functionName: 'productionLocked' as const,
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: SettlementReceiverABI,
      functionName: 'productionLocked' as const,
      data: bytesToHex(result.data),
    }) as boolean
  }

  simAttestor(
    runtime: Runtime<unknown>,
  ): `0x${string}` {
    const callData = encodeFunctionData({
      abi: SettlementReceiverABI,
      functionName: 'simAttestor' as const,
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: SettlementReceiverABI,
      functionName: 'simAttestor' as const,
      data: bytesToHex(result.data),
    }) as `0x${string}`
  }

  simEnabled(
    runtime: Runtime<unknown>,
  ): boolean {
    const callData = encodeFunctionData({
      abi: SettlementReceiverABI,
      functionName: 'simEnabled' as const,
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: SettlementReceiverABI,
      functionName: 'simEnabled' as const,
      data: bytesToHex(result.data),
    }) as boolean
  }

  simNonce(
    runtime: Runtime<unknown>,
    matchId: bigint,
  ): bigint {
    const callData = encodeFunctionData({
      abi: SettlementReceiverABI,
      functionName: 'simNonce' as const,
      args: [matchId],
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: SettlementReceiverABI,
      functionName: 'simNonce' as const,
      data: bytesToHex(result.data),
    }) as bigint
  }

  supportsInterface(
    runtime: Runtime<unknown>,
    interfaceId: `0x${string}`,
  ): boolean {
    const callData = encodeFunctionData({
      abi: SettlementReceiverABI,
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
      abi: SettlementReceiverABI,
      functionName: 'supportsInterface' as const,
      data: bytesToHex(result.data),
    }) as boolean
  }

  writeReportFromOnReport(
    runtime: Runtime<unknown>,
    metadata: `0x${string}`,
    reportPayload: `0x${string}`,
    gasConfig?: { gasLimit?: string },
  ) {
    const callData = encodeFunctionData({
      abi: SettlementReceiverABI,
      functionName: 'onReport' as const,
      args: [metadata, reportPayload],
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

  writeReportFromSetExpectedWorkflow(
    runtime: Runtime<unknown>,
    workflowId: `0x${string}`,
    workflowName: `0x${string}`,
    workflowOwner: `0x${string}`,
    gasConfig?: { gasLimit?: string },
  ) {
    const callData = encodeFunctionData({
      abi: SettlementReceiverABI,
      functionName: 'setExpectedWorkflow' as const,
      args: [workflowId, workflowName, workflowOwner],
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

  writeReportFromSetForwarder(
    runtime: Runtime<unknown>,
    forwarder: `0x${string}`,
    allowed: boolean,
    gasConfig?: { gasLimit?: string },
  ) {
    const callData = encodeFunctionData({
      abi: SettlementReceiverABI,
      functionName: 'setForwarder' as const,
      args: [forwarder, allowed],
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

  writeReportFromSetSimAttestor(
    runtime: Runtime<unknown>,
    attestor: `0x${string}`,
    gasConfig?: { gasLimit?: string },
  ) {
    const callData = encodeFunctionData({
      abi: SettlementReceiverABI,
      functionName: 'setSimAttestor' as const,
      args: [attestor],
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

  writeReportFromTransferOwnership(
    runtime: Runtime<unknown>,
    newOwner: `0x${string}`,
    gasConfig?: { gasLimit?: string },
  ) {
    const callData = encodeFunctionData({
      abi: SettlementReceiverABI,
      functionName: 'transferOwnership' as const,
      args: [newOwner],
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
   * Creates a log trigger for ExpectedWorkflowSet events.
   * The returned trigger's adapt method decodes the raw log into ExpectedWorkflowSetDecoded,
   * so the handler receives typed event data directly.
   * When multiple filters are provided, topic values are merged with OR semantics (match any).
   */
  logTriggerExpectedWorkflowSet(
    filters?: ExpectedWorkflowSetTopics[],
  ) {
    let topics: { values: string[] }[]
    if (!filters || filters.length === 0) {
      const encoded = encodeEventTopics({
        abi: SettlementReceiverABI,
        eventName: 'ExpectedWorkflowSet' as const,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else if (filters.length === 1) {
      const f = filters[0]
      const args = {
      }
      const encoded = encodeEventTopics({
        abi: SettlementReceiverABI,
        eventName: 'ExpectedWorkflowSet' as const,
        args,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else {
      const allEncoded = filters.map((f) => {
        const args = {
        }
        return encodeEventTopics({
          abi: SettlementReceiverABI,
          eventName: 'ExpectedWorkflowSet' as const,
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
      adapt: (rawOutput: EVMLog): DecodedLog<ExpectedWorkflowSetDecoded> => contract.decodeExpectedWorkflowSet(rawOutput),
    }
  }

  /**
   * Decodes a log into ExpectedWorkflowSet data, preserving all log metadata.
   */
  decodeExpectedWorkflowSet(log: EVMLog): DecodedLog<ExpectedWorkflowSetDecoded> {
    const decoded = decodeEventLog({
      abi: SettlementReceiverABI,
      data: bytesToHex(log.data),
      topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
    })
    const { data: _, ...rest } = log
    return { ...rest, data: decoded.args as unknown as ExpectedWorkflowSetDecoded }
  }

  /**
   * Creates a log trigger for ForwarderAllowed events.
   * The returned trigger's adapt method decodes the raw log into ForwarderAllowedDecoded,
   * so the handler receives typed event data directly.
   * When multiple filters are provided, topic values are merged with OR semantics (match any).
   */
  logTriggerForwarderAllowed(
    filters?: ForwarderAllowedTopics[],
  ) {
    let topics: { values: string[] }[]
    if (!filters || filters.length === 0) {
      const encoded = encodeEventTopics({
        abi: SettlementReceiverABI,
        eventName: 'ForwarderAllowed' as const,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else if (filters.length === 1) {
      const f = filters[0]
      const args = {
        forwarder: f.forwarder,
      }
      const encoded = encodeEventTopics({
        abi: SettlementReceiverABI,
        eventName: 'ForwarderAllowed' as const,
        args,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else {
      const allEncoded = filters.map((f) => {
        const args = {
          forwarder: f.forwarder,
        }
        return encodeEventTopics({
          abi: SettlementReceiverABI,
          eventName: 'ForwarderAllowed' as const,
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
      adapt: (rawOutput: EVMLog): DecodedLog<ForwarderAllowedDecoded> => contract.decodeForwarderAllowed(rawOutput),
    }
  }

  /**
   * Decodes a log into ForwarderAllowed data, preserving all log metadata.
   */
  decodeForwarderAllowed(log: EVMLog): DecodedLog<ForwarderAllowedDecoded> {
    const decoded = decodeEventLog({
      abi: SettlementReceiverABI,
      data: bytesToHex(log.data),
      topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
    })
    const { data: _, ...rest } = log
    return { ...rest, data: decoded.args as unknown as ForwarderAllowedDecoded }
  }

  /**
   * Creates a log trigger for MarketSettledFromReport events.
   * The returned trigger's adapt method decodes the raw log into MarketSettledFromReportDecoded,
   * so the handler receives typed event data directly.
   * When multiple filters are provided, topic values are merged with OR semantics (match any).
   */
  logTriggerMarketSettledFromReport(
    filters?: MarketSettledFromReportTopics[],
  ) {
    let topics: { values: string[] }[]
    if (!filters || filters.length === 0) {
      const encoded = encodeEventTopics({
        abi: SettlementReceiverABI,
        eventName: 'MarketSettledFromReport' as const,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else if (filters.length === 1) {
      const f = filters[0]
      const args = {
        marketId: f.marketId,
      }
      const encoded = encodeEventTopics({
        abi: SettlementReceiverABI,
        eventName: 'MarketSettledFromReport' as const,
        args,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else {
      const allEncoded = filters.map((f) => {
        const args = {
          marketId: f.marketId,
        }
        return encodeEventTopics({
          abi: SettlementReceiverABI,
          eventName: 'MarketSettledFromReport' as const,
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
      adapt: (rawOutput: EVMLog): DecodedLog<MarketSettledFromReportDecoded> => contract.decodeMarketSettledFromReport(rawOutput),
    }
  }

  /**
   * Decodes a log into MarketSettledFromReport data, preserving all log metadata.
   */
  decodeMarketSettledFromReport(log: EVMLog): DecodedLog<MarketSettledFromReportDecoded> {
    const decoded = decodeEventLog({
      abi: SettlementReceiverABI,
      data: bytesToHex(log.data),
      topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
    })
    const { data: _, ...rest } = log
    return { ...rest, data: decoded.args as unknown as MarketSettledFromReportDecoded }
  }

  /**
   * Creates a log trigger for OwnershipTransferStarted events.
   * The returned trigger's adapt method decodes the raw log into OwnershipTransferStartedDecoded,
   * so the handler receives typed event data directly.
   * When multiple filters are provided, topic values are merged with OR semantics (match any).
   */
  logTriggerOwnershipTransferStarted(
    filters?: OwnershipTransferStartedTopics[],
  ) {
    let topics: { values: string[] }[]
    if (!filters || filters.length === 0) {
      const encoded = encodeEventTopics({
        abi: SettlementReceiverABI,
        eventName: 'OwnershipTransferStarted' as const,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else if (filters.length === 1) {
      const f = filters[0]
      const args = {
        previousOwner: f.previousOwner,
        newOwner: f.newOwner,
      }
      const encoded = encodeEventTopics({
        abi: SettlementReceiverABI,
        eventName: 'OwnershipTransferStarted' as const,
        args,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else {
      const allEncoded = filters.map((f) => {
        const args = {
          previousOwner: f.previousOwner,
          newOwner: f.newOwner,
        }
        return encodeEventTopics({
          abi: SettlementReceiverABI,
          eventName: 'OwnershipTransferStarted' as const,
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
      adapt: (rawOutput: EVMLog): DecodedLog<OwnershipTransferStartedDecoded> => contract.decodeOwnershipTransferStarted(rawOutput),
    }
  }

  /**
   * Decodes a log into OwnershipTransferStarted data, preserving all log metadata.
   */
  decodeOwnershipTransferStarted(log: EVMLog): DecodedLog<OwnershipTransferStartedDecoded> {
    const decoded = decodeEventLog({
      abi: SettlementReceiverABI,
      data: bytesToHex(log.data),
      topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
    })
    const { data: _, ...rest } = log
    return { ...rest, data: decoded.args as unknown as OwnershipTransferStartedDecoded }
  }

  /**
   * Creates a log trigger for OwnershipTransferred events.
   * The returned trigger's adapt method decodes the raw log into OwnershipTransferredDecoded,
   * so the handler receives typed event data directly.
   * When multiple filters are provided, topic values are merged with OR semantics (match any).
   */
  logTriggerOwnershipTransferred(
    filters?: OwnershipTransferredTopics[],
  ) {
    let topics: { values: string[] }[]
    if (!filters || filters.length === 0) {
      const encoded = encodeEventTopics({
        abi: SettlementReceiverABI,
        eventName: 'OwnershipTransferred' as const,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else if (filters.length === 1) {
      const f = filters[0]
      const args = {
        previousOwner: f.previousOwner,
        newOwner: f.newOwner,
      }
      const encoded = encodeEventTopics({
        abi: SettlementReceiverABI,
        eventName: 'OwnershipTransferred' as const,
        args,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else {
      const allEncoded = filters.map((f) => {
        const args = {
          previousOwner: f.previousOwner,
          newOwner: f.newOwner,
        }
        return encodeEventTopics({
          abi: SettlementReceiverABI,
          eventName: 'OwnershipTransferred' as const,
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
      adapt: (rawOutput: EVMLog): DecodedLog<OwnershipTransferredDecoded> => contract.decodeOwnershipTransferred(rawOutput),
    }
  }

  /**
   * Decodes a log into OwnershipTransferred data, preserving all log metadata.
   */
  decodeOwnershipTransferred(log: EVMLog): DecodedLog<OwnershipTransferredDecoded> {
    const decoded = decodeEventLog({
      abi: SettlementReceiverABI,
      data: bytesToHex(log.data),
      topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
    })
    const { data: _, ...rest } = log
    return { ...rest, data: decoded.args as unknown as OwnershipTransferredDecoded }
  }

  /**
   * Creates a log trigger for ProductionLocked events.
   * The returned trigger's adapt method decodes the raw log into ProductionLockedDecoded,
   * so the handler receives typed event data directly.
   * When multiple filters are provided, topic values are merged with OR semantics (match any).
   */
  logTriggerProductionLocked(
    filters?: ProductionLockedTopics[],
  ) {
    let topics: { values: string[] }[]
    if (!filters || filters.length === 0) {
      const encoded = encodeEventTopics({
        abi: SettlementReceiverABI,
        eventName: 'ProductionLocked' as const,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else if (filters.length === 1) {
      // ProductionLocked has no fields, so there is nothing a filter could narrow on.
      const args = [] as const
      const encoded = encodeEventTopics({
        abi: SettlementReceiverABI,
        eventName: 'ProductionLocked' as const,
        args,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else {
      const allEncoded = filters.map(() => {
        const args = [] as const
        return encodeEventTopics({
          abi: SettlementReceiverABI,
          eventName: 'ProductionLocked' as const,
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
      adapt: (rawOutput: EVMLog): DecodedLog<ProductionLockedDecoded> => contract.decodeProductionLocked(rawOutput),
    }
  }

  /**
   * Decodes a log into ProductionLocked data, preserving all log metadata.
   */
  decodeProductionLocked(log: EVMLog): DecodedLog<ProductionLockedDecoded> {
    const decoded = decodeEventLog({
      abi: SettlementReceiverABI,
      data: bytesToHex(log.data),
      topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
    })
    const { data: _, ...rest } = log
    return { ...rest, data: decoded.args as unknown as ProductionLockedDecoded }
  }

  /**
   * Creates a log trigger for ReportAccepted events.
   * The returned trigger's adapt method decodes the raw log into ReportAcceptedDecoded,
   * so the handler receives typed event data directly.
   * When multiple filters are provided, topic values are merged with OR semantics (match any).
   */
  logTriggerReportAccepted(
    filters?: ReportAcceptedTopics[],
  ) {
    let topics: { values: string[] }[]
    if (!filters || filters.length === 0) {
      const encoded = encodeEventTopics({
        abi: SettlementReceiverABI,
        eventName: 'ReportAccepted' as const,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else if (filters.length === 1) {
      const f = filters[0]
      const args = {
        forwarder: f.forwarder,
        matchId: f.matchId,
      }
      const encoded = encodeEventTopics({
        abi: SettlementReceiverABI,
        eventName: 'ReportAccepted' as const,
        args,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else {
      const allEncoded = filters.map((f) => {
        const args = {
          forwarder: f.forwarder,
          matchId: f.matchId,
        }
        return encodeEventTopics({
          abi: SettlementReceiverABI,
          eventName: 'ReportAccepted' as const,
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
      adapt: (rawOutput: EVMLog): DecodedLog<ReportAcceptedDecoded> => contract.decodeReportAccepted(rawOutput),
    }
  }

  /**
   * Decodes a log into ReportAccepted data, preserving all log metadata.
   */
  decodeReportAccepted(log: EVMLog): DecodedLog<ReportAcceptedDecoded> {
    const decoded = decodeEventLog({
      abi: SettlementReceiverABI,
      data: bytesToHex(log.data),
      topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
    })
    const { data: _, ...rest } = log
    return { ...rest, data: decoded.args as unknown as ReportAcceptedDecoded }
  }

  /**
   * Creates a log trigger for ReportRejected events.
   * The returned trigger's adapt method decodes the raw log into ReportRejectedDecoded,
   * so the handler receives typed event data directly.
   * When multiple filters are provided, topic values are merged with OR semantics (match any).
   */
  logTriggerReportRejected(
    filters?: ReportRejectedTopics[],
  ) {
    let topics: { values: string[] }[]
    if (!filters || filters.length === 0) {
      const encoded = encodeEventTopics({
        abi: SettlementReceiverABI,
        eventName: 'ReportRejected' as const,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else if (filters.length === 1) {
      const f = filters[0]
      const args = {
        marketId: f.marketId,
      }
      const encoded = encodeEventTopics({
        abi: SettlementReceiverABI,
        eventName: 'ReportRejected' as const,
        args,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else {
      const allEncoded = filters.map((f) => {
        const args = {
          marketId: f.marketId,
        }
        return encodeEventTopics({
          abi: SettlementReceiverABI,
          eventName: 'ReportRejected' as const,
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
      adapt: (rawOutput: EVMLog): DecodedLog<ReportRejectedDecoded> => contract.decodeReportRejected(rawOutput),
    }
  }

  /**
   * Decodes a log into ReportRejected data, preserving all log metadata.
   */
  decodeReportRejected(log: EVMLog): DecodedLog<ReportRejectedDecoded> {
    const decoded = decodeEventLog({
      abi: SettlementReceiverABI,
      data: bytesToHex(log.data),
      topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
    })
    const { data: _, ...rest } = log
    return { ...rest, data: decoded.args as unknown as ReportRejectedDecoded }
  }

  /**
   * Creates a log trigger for SimAttestorSet events.
   * The returned trigger's adapt method decodes the raw log into SimAttestorSetDecoded,
   * so the handler receives typed event data directly.
   * When multiple filters are provided, topic values are merged with OR semantics (match any).
   */
  logTriggerSimAttestorSet(
    filters?: SimAttestorSetTopics[],
  ) {
    let topics: { values: string[] }[]
    if (!filters || filters.length === 0) {
      const encoded = encodeEventTopics({
        abi: SettlementReceiverABI,
        eventName: 'SimAttestorSet' as const,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else if (filters.length === 1) {
      const f = filters[0]
      const args = {
        attestor: f.attestor,
      }
      const encoded = encodeEventTopics({
        abi: SettlementReceiverABI,
        eventName: 'SimAttestorSet' as const,
        args,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else {
      const allEncoded = filters.map((f) => {
        const args = {
          attestor: f.attestor,
        }
        return encodeEventTopics({
          abi: SettlementReceiverABI,
          eventName: 'SimAttestorSet' as const,
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
      adapt: (rawOutput: EVMLog): DecodedLog<SimAttestorSetDecoded> => contract.decodeSimAttestorSet(rawOutput),
    }
  }

  /**
   * Decodes a log into SimAttestorSet data, preserving all log metadata.
   */
  decodeSimAttestorSet(log: EVMLog): DecodedLog<SimAttestorSetDecoded> {
    const decoded = decodeEventLog({
      abi: SettlementReceiverABI,
      data: bytesToHex(log.data),
      topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
    })
    const { data: _, ...rest } = log
    return { ...rest, data: decoded.args as unknown as SimAttestorSetDecoded }
  }
}

