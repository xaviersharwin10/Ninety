// Code generated — DO NOT EDIT.
import type { Address } from 'viem'
import { addContractMock, type ContractMock, type EvmMock } from '@chainlink/cre-sdk/test'

import { MarketManagerABI } from './MarketManager'

export type MarketManagerMock = {
  dEFAULTADMINROLE?: () => `0x${string}`
  sCHEDULERROLE?: () => `0x${string}`
  sETTLERROLE?: () => `0x${string}`
  getMarket?: (marketId: bigint) => { matchId: bigint; templateId: `0x${string}`; windowStart: number; windowEnd: number; openedAt: bigint; closesAt: bigint; qualifyingEventTs: bigint; state: number; outcome: number; teamFilter: number }
  getRoleAdmin?: (role: `0x${string}`) => `0x${string}`
  hasRole?: (role: `0x${string}`, account: `0x${string}`) => boolean
  isBettable?: (marketId: bigint) => boolean
  marketCount?: () => bigint
  matchCount?: () => bigint
  matchExists?: (matchId: bigint) => boolean
  supportsInterface?: (interfaceId: `0x${string}`) => boolean
  templateEnabled?: (templateId: `0x${string}`) => boolean
} & Pick<ContractMock<typeof MarketManagerABI>, 'writeReport'>

export function newMarketManagerMock(address: Address, evmMock: EvmMock): MarketManagerMock {
  return addContractMock(evmMock, { address, abi: MarketManagerABI }) as MarketManagerMock
}

