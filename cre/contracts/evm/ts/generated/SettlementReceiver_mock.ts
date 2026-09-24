// Code generated — DO NOT EDIT.
import type { Address } from 'viem'
import { addContractMock, type ContractMock, type EvmMock } from '@chainlink/cre-sdk/test'

import { SettlementReceiverABI } from './SettlementReceiver'

export type SettlementReceiverMock = {
  mARKETS?: () => `0x${string}`
  pRODUCTIONFORWARDER?: () => `0x${string}`
  sIMULATIONFORWARDER?: () => `0x${string}`
  expectedWorkflowId?: () => `0x${string}`
  expectedWorkflowName?: () => `0x${string}`
  expectedWorkflowOwner?: () => `0x${string}`
  isAllowedForwarder?: (forwarder: `0x${string}`) => boolean
  lastProducedAt?: (matchId: bigint) => bigint
  owner?: () => `0x${string}`
  pendingOwner?: () => `0x${string}`
  productionLocked?: () => boolean
  simAttestor?: () => `0x${string}`
  simEnabled?: () => boolean
  simNonce?: (matchId: bigint) => bigint
  supportsInterface?: (interfaceId: `0x${string}`) => boolean
} & Pick<ContractMock<typeof SettlementReceiverABI>, 'writeReport'>

export function newSettlementReceiverMock(address: Address, evmMock: EvmMock): SettlementReceiverMock {
  return addContractMock(evmMock, { address, abi: SettlementReceiverABI }) as SettlementReceiverMock
}

