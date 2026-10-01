// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Test } from "forge-std/Test.sol";

import { AgentRegistry } from "../src/AgentRegistry.sol";
import { AgentVault } from "../src/AgentVault.sol";
import { BetRouter } from "../src/BetRouter.sol";
import { MarketManager } from "../src/MarketManager.sol";
import { OddsLock } from "../src/OddsLock.sol";

import { Bet, Quote, Side, SignedQuote } from "../src/interfaces/IBetRouter.sol";
import { MockUSD } from "./mocks/MockUSD.sol";

contract OddsLockTest is Test {
    uint256 internal constant nUSD = 1e6;
    bytes32 internal constant SHOT = keccak256("SHOT_ON_TARGET_NEXT_N");

    MockUSD internal usd;
    AgentRegistry internal registry;
    MarketManager internal mm;
    BetRouter internal router;
    OddsLock internal locks;

    address internal admin = makeAddr("admin");
    address internal scheduler = makeAddr("scheduler");
    address internal fan = makeAddr("fan");
    address internal backer = makeAddr("backer");

    uint256 internal agentPk = 0xA11CE;
    uint32 internal agentId;
    AgentVault internal vault;
    uint256 internal marketId;

    bytes32 internal offerTypehash;
    bytes32 internal lockDomain;
    bytes32 internal quoteTypehash;
    bytes32 internal routerDomain;

    function setUp() public {
        vm.warp(1_700_000_000);

        usd = new MockUSD();
        registry = new AgentRegistry(IERC20(address(usd)), admin, 2000, 3000, 0);
        mm = new MarketManager(admin);
        router = new BetRouter(IERC20(address(usd)), registry, mm);
        locks = new OddsLock(IERC20(address(usd)), registry, mm);
        offerTypehash = locks.LOCK_OFFER_TYPEHASH();
        lockDomain = locks.domainSeparator();
        quoteTypehash = router.QUOTE_TYPEHASH();
        routerDomain = router.domainSeparator();

        vm.startPrank(admin);
        registry.setBetRouter(address(router));
        mm.grantRole(mm.SCHEDULER_ROLE(), scheduler);
        mm.setTemplate(SHOT, true);
        vm.stopPrank();

        vm.prank(makeAddr("operator"));
        (uint32 aid, address v) = registry.register(vm.addr(agentPk), hex"cafe", "steady");
        agentId = aid;
        vault = AgentVault(v);

        usd.mint(backer, 5000 * nUSD);
        vm.startPrank(backer);
        usd.approve(address(vault), type(uint256).max);
        vault.deposit(5000 * nUSD, backer);
        vm.stopPrank();

        vm.prank(scheduler);
        uint64 matchId = mm.createMatch(keccak256("wyscout:1694390"), uint64(block.timestamp), "");
        vm.prank(scheduler);
        marketId = mm.openMarket(matchId, SHOT, 600, 720, uint64(block.timestamp + 120), 0);

        usd.mint(fan, 1000 * nUSD);
        vm.startPrank(fan);
        usd.approve(address(locks), type(uint256).max);
        usd.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    function _offer(
        Side side,
        uint16 probBps,
        uint16 feeBps
    ) internal view returns (OddsLock.LockOffer memory) {
        return OddsLock.LockOffer({
            marketId: marketId,
            agentId: agentId,
            side: side,
            probBps: probBps,
            maxStake: uint128(50 * nUSD),
            feeBps: feeBps,
            holdSeconds: 30,
            expiry: uint64(block.timestamp + 5),
            salt: 1
        });
    }

    function _signOffer(uint256 pk, OddsLock.LockOffer memory o) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                offerTypehash,
                o.marketId,
                o.agentId,
                o.side,
                o.probBps,
                o.maxStake,
                o.feeBps,
                o.holdSeconds,
                o.expiry,
                o.salt
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", lockDomain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _signQuote(
        Quote memory q
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                quoteTypehash, q.marketId, q.agentId, q.probYesBps, q.probNoBps, q.maxStake, q.expiry, q.salt
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(agentPk, keccak256(abi.encodePacked("\x19\x01", routerDomain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function test_buy_recordsTheHold_andPaysTheFeeIntoTheVault() public {
        OddsLock.LockOffer memory o = _offer(Side.Yes, 4000, 300);
        bytes memory sig = _signOffer(agentPk, o);
        uint256 vaultBefore = vault.totalAssets();

        vm.prank(fan);
        uint256 lockId = locks.buy(o, sig, uint128(10 * nUSD), uint128(1 * nUSD));

        OddsLock.Lock memory l = locks.getLock(lockId);
        assertEq(l.fan, fan);
        assertEq(l.probBps, 4000);
        assertEq(l.stake, 10 * nUSD);
        assertEq(l.fee, 300_000); // 3% of 10 nUSD
        assertEq(l.heldUntil, block.timestamp + 30);
        assertEq(vault.totalAssets(), vaultBefore + 300_000);
        assertEq(usd.balanceOf(fan), 1000 * nUSD - 300_000);
    }

    function test_fee_roundsUp_soAHoldIsNeverFree() public {
        OddsLock.LockOffer memory o = _offer(Side.Yes, 4000, 1);
        bytes memory sig = _signOffer(agentPk, o);
        vm.prank(fan);
        uint256 lockId = locks.buy(o, sig, 1, 1);
        assertEq(locks.getLock(lockId).fee, 1);
    }

    /// The whole point: after the market has moved, the fan still bets at the held price, through
    /// BetRouter, on the quote the agent hands over for the hold.
    function test_heldPrice_isHonouredThroughBetRouter_afterTheMarketMoves() public {
        OddsLock.LockOffer memory o = _offer(Side.Yes, 4000, 300);
        bytes memory sig = _signOffer(agentPk, o);
        vm.prank(fan);
        uint256 lockId = locks.buy(o, sig, uint128(10 * nUSD), uint128(1 * nUSD));
        OddsLock.Lock memory l = locks.getLock(lockId);

        vm.warp(block.timestamp + 20); // the market has since moved; the hold hasn't expired

        Quote memory q = Quote({
            marketId: marketId,
            agentId: agentId,
            probYesBps: l.probBps,
            probNoBps: locks.MAX_PROB_BPS(),
            maxStake: l.stake,
            expiry: l.heldUntil,
            salt: lockId
        });
        SignedQuote[] memory qs = new SignedQuote[](1);
        qs[0] = SignedQuote({ quote: q, signature: _signQuote(q) });

        vm.prank(fan);
        (, uint256[] memory betIds) = router.placeBet(marketId, Side.Yes, l.stake, 0, qs);
        Bet memory b = router.getBet(betIds[0]);
        assertEq(b.probBps, 4000);
        assertEq(b.payout, 25 * nUSD);
    }

    function test_lowestHeldPrice_stillLeavesAValidHonouringQuote() public {
        // 400 + 9800 = 10200: exactly BetRouter's minimum margin.
        Quote memory q = Quote({
            marketId: marketId,
            agentId: agentId,
            probYesBps: locks.MIN_PROB_BPS(),
            probNoBps: locks.MAX_PROB_BPS(),
            maxStake: uint128(1 * nUSD),
            expiry: uint64(block.timestamp + 30),
            salt: 1
        });
        SignedQuote[] memory qs = new SignedQuote[](1);
        qs[0] = SignedQuote({ quote: q, signature: _signQuote(q) });
        vm.prank(fan);
        router.placeBet(marketId, Side.Yes, uint128(1 * nUSD), 0, qs);
    }

    function test_buy_rejectsAnOfferNotSignedByTheAgent() public {
        OddsLock.LockOffer memory o = _offer(Side.Yes, 4000, 300);
        bytes memory sig = _signOffer(0xBAD, o);
        vm.prank(fan);
        vm.expectRevert(abi.encodeWithSelector(OddsLock.AgentNotQuotable.selector, agentId, vm.addr(0xBAD)));
        locks.buy(o, sig, uint128(10 * nUSD), uint128(1 * nUSD));
    }

    function test_buy_rejectsAnExpiredOffer() public {
        OddsLock.LockOffer memory o = _offer(Side.Yes, 4000, 300);
        bytes memory sig = _signOffer(agentPk, o);
        vm.warp(block.timestamp + 6);
        vm.prank(fan);
        vm.expectRevert(
            abi.encodeWithSelector(OddsLock.OfferExpired.selector, o.expiry, uint64(block.timestamp))
        );
        locks.buy(o, sig, uint128(10 * nUSD), uint128(1 * nUSD));
    }

    function test_buy_rejectsAFeeAboveWhatTheFanAgreedTo() public {
        OddsLock.LockOffer memory o = _offer(Side.Yes, 4000, 300);
        bytes memory sig = _signOffer(agentPk, o);
        vm.prank(fan);
        vm.expectRevert(
            abi.encodeWithSelector(OddsLock.FeeAboveMaximum.selector, uint128(300_000), uint128(299_999))
        );
        locks.buy(o, sig, uint128(10 * nUSD), 299_999);
    }

    function test_buy_cannotSellAnOfferPastItsMaxStake() public {
        OddsLock.LockOffer memory o = _offer(Side.No, 6000, 300);
        bytes memory sig = _signOffer(agentPk, o);
        vm.startPrank(fan);
        locks.buy(o, sig, uint128(30 * nUSD), uint128(1 * nUSD));
        vm.expectRevert();
        locks.buy(o, sig, uint128(30 * nUSD), uint128(1 * nUSD));
        locks.buy(o, sig, uint128(20 * nUSD), uint128(1 * nUSD));
        vm.stopPrank();
    }

    function test_buy_rejectsOutOfRangeTerms() public {
        OddsLock.LockOffer memory o = _offer(Side.Yes, 399, 300);
        bytes memory sig = _signOffer(agentPk, o);
        vm.prank(fan);
        vm.expectRevert(abi.encodeWithSelector(OddsLock.PriceOutOfRange.selector, uint16(399)));
        locks.buy(o, sig, uint128(10 * nUSD), uint128(1 * nUSD));

        o = _offer(Side.Yes, 4000, 300);
        o.holdSeconds = 121;
        sig = _signOffer(agentPk, o);
        vm.prank(fan);
        vm.expectRevert(abi.encodeWithSelector(OddsLock.HoldOutOfRange.selector, uint32(121)));
        locks.buy(o, sig, uint128(10 * nUSD), uint128(1 * nUSD));

        o = _offer(Side.Yes, 4000, 0);
        sig = _signOffer(agentPk, o);
        vm.prank(fan);
        vm.expectRevert(abi.encodeWithSelector(OddsLock.FeeOutOfRange.selector, uint16(0)));
        locks.buy(o, sig, uint128(10 * nUSD), uint128(1 * nUSD));
    }

    function test_buy_rejectsAClosedMarket() public {
        OddsLock.LockOffer memory o = _offer(Side.Yes, 4000, 300);
        bytes memory sig = _signOffer(agentPk, o);
        vm.warp(block.timestamp + 121);
        vm.prank(scheduler);
        mm.close(marketId);
        vm.prank(fan);
        vm.expectRevert(abi.encodeWithSelector(OddsLock.MarketNotBettable.selector, marketId));
        locks.buy(o, sig, uint128(10 * nUSD), uint128(1 * nUSD));
    }

    function testFuzz_fee_isStakeTimesFeeBps_roundedUp(uint128 stake, uint16 feeBps) public {
        stake = uint128(bound(stake, 1, 50 * nUSD));
        feeBps = uint16(bound(feeBps, 1, locks.MAX_FEE_BPS()));
        OddsLock.LockOffer memory o = _offer(Side.Yes, 4000, feeBps);
        bytes memory sig = _signOffer(agentPk, o);
        vm.prank(fan);
        uint256 lockId = locks.buy(o, sig, stake, type(uint128).max);
        uint256 fee = locks.getLock(lockId).fee;
        assertGe(fee * 10_000, uint256(stake) * feeBps);
        assertLt((fee - 1) * 10_000, uint256(stake) * feeBps);
    }
}
