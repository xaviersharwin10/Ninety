// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Test } from "forge-std/Test.sol";

import { AgentRegistry } from "../src/AgentRegistry.sol";
import { AgentVault } from "../src/AgentVault.sol";
import { BetRouter } from "../src/BetRouter.sol";
import { MarketManager } from "../src/MarketManager.sol";

import { Bet, BetStatus, Quote, Side, SignedQuote } from "../src/interfaces/IBetRouter.sol";
import { MarketState, Outcome } from "../src/interfaces/IMarketManager.sol";
import { OddsMath } from "../src/libraries/OddsMath.sol";
import { MockUSD } from "./mocks/MockUSD.sol";

contract BetRouterTest is Test {
    uint256 internal constant AUSD = 1e6;
    bytes32 internal constant SHOT = keccak256("SHOT_ON_TARGET_NEXT_N");

    MockUSD internal usd;
    AgentRegistry internal registry;
    MarketManager internal mm;
    BetRouter internal router;

    address internal admin = makeAddr("admin");
    address internal scheduler = makeAddr("scheduler");
    address internal settler = makeAddr("settler");
    address internal fan = makeAddr("fan");
    address internal backer = makeAddr("backer");

    // Three agents. Steady quotes the best YES price, Pulse the worst.
    uint256 internal steadyPk = 0xA11CE;
    uint256 internal tempoPk = 0xB0B;
    uint256 internal pulsePk = 0xC0FFEE;

    uint32 internal steadyId;
    uint32 internal tempoId;
    uint32 internal pulseId;

    AgentVault internal steadyVault;
    AgentVault internal tempoVault;
    AgentVault internal pulseVault;

    uint256 internal marketId;
    uint64 internal closesAt;

    // Cached so that _quote/_sign perform no external calls. Building a book inside a pranked
    // statement would otherwise spend vm.prank on router.QUOTE_TYPEHASH() and the bet would be
    // placed by the test contract instead of the fan.
    bytes32 internal typehash;
    bytes32 internal domainSep;

    function setUp() public {
        vm.warp(1_700_000_000);

        usd = new MockUSD();
        registry = new AgentRegistry(IERC20(address(usd)), admin, 2000, 3000, 0);
        mm = new MarketManager(admin);
        router = new BetRouter(IERC20(address(usd)), registry, mm);
        typehash = router.QUOTE_TYPEHASH();
        domainSep = router.domainSeparator();

        vm.startPrank(admin);
        registry.setBetRouter(address(router));
        mm.grantRole(mm.SCHEDULER_ROLE(), scheduler);
        mm.grantRole(mm.SETTLER_ROLE(), settler);
        mm.setTemplate(SHOT, true);
        vm.stopPrank();

        (steadyId, steadyVault) = _registerAgent(steadyPk, "steady");
        (tempoId, tempoVault) = _registerAgent(tempoPk, "tempo");
        (pulseId, pulseVault) = _registerAgent(pulsePk, "pulse");

        _fundVault(steadyVault, 5000 * AUSD);
        _fundVault(tempoVault, 5000 * AUSD);
        _fundVault(pulseVault, 5000 * AUSD);

        vm.prank(scheduler);
        uint64 matchId = mm.createMatch(keccak256("wyscout:1694390"), uint64(block.timestamp), "");
        closesAt = uint64(block.timestamp + 120);
        vm.prank(scheduler);
        marketId = mm.openMarket(matchId, SHOT, 600, 720, closesAt, 0);

        usd.mint(fan, 10_000 * AUSD);
        vm.prank(fan);
        usd.approve(address(router), type(uint256).max);
    }

    function _registerAgent(uint256 pk, string memory label) internal returns (uint32 id, AgentVault vault) {
        address operator = makeAddr(label);
        vm.prank(operator);
        (uint32 aid, address v) = registry.register(vm.addr(pk), hex"cafe", label);
        return (aid, AgentVault(v));
    }

    function _fundVault(AgentVault vault, uint256 amount) internal {
        usd.mint(backer, amount);
        vm.startPrank(backer);
        usd.approve(address(vault), amount);
        vault.deposit(amount, backer);
        vm.stopPrank();
    }

    function _quote(
        uint256 pk,
        uint32 agentId,
        uint16 yes,
        uint16 no,
        uint128 maxStake
    ) internal view returns (SignedQuote memory sq) {
        Quote memory q = Quote({
            marketId: marketId,
            agentId: agentId,
            probYesBps: yes,
            probNoBps: no,
            maxStake: maxStake,
            expiry: uint64(block.timestamp + 5),
            salt: uint256(keccak256(abi.encode(pk, yes, no, maxStake)))
        });
        sq = SignedQuote({ quote: q, signature: _sign(pk, q) });
    }

    function _sign(uint256 pk, Quote memory q) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                typehash, q.marketId, q.agentId, q.probYesBps, q.probNoBps, q.maxStake, q.expiry, q.salt
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev The three quotes from the worked example: 300bps overround, ascending YES price.
    function _standardBook() internal view returns (SignedQuote[] memory qs) {
        qs = new SignedQuote[](3);
        qs[0] = _quote(steadyPk, steadyId, 4635, 5665, 25 * uint128(AUSD));
        qs[1] = _quote(tempoPk, tempoId, 4680, 5620, 25 * uint128(AUSD));
        qs[2] = _quote(pulsePk, pulseId, 4700, 5600, 25 * uint128(AUSD));
    }

    /// @dev The same three agents ranked for a NO bet: ascending by probNoBps, which is the
    ///      reverse of the YES ranking.
    function _standardBookNo() internal view returns (SignedQuote[] memory qs) {
        qs = new SignedQuote[](3);
        qs[0] = _quote(pulsePk, pulseId, 4700, 5600, 25 * uint128(AUSD));
        qs[1] = _quote(tempoPk, tempoId, 4680, 5620, 25 * uint128(AUSD));
        qs[2] = _quote(steadyPk, steadyId, 4635, 5665, 25 * uint128(AUSD));
    }

    // ------------------------------------------------------------------
    // The worked example, end to end
    // ------------------------------------------------------------------

    function test_placeBet_reproducesTheWorkedExample() public {
        vm.prank(fan);
        (, uint256[] memory betIds) =
            router.placeBet(marketId, Side.Yes, 30 * uint128(AUSD), 0, _standardBook());

        assertEq(betIds.length, 3, "one bet per rung");

        uint128[3] memory expectedStakes = [15 * uint128(AUSD), 9 * uint128(AUSD), 6 * uint128(AUSD)];
        uint128[3] memory expectedPayouts = [uint128(32_362_459), 19_230_769, 12_765_957];

        uint256 totalPayout;
        for (uint256 i = 0; i < 3; ++i) {
            Bet memory b = router.getBet(betIds[i]);
            assertEq(b.stake, expectedStakes[i], "ladder stake");
            assertEq(b.payout, expectedPayouts[i], "payout");
            assertEq(uint8(b.status), uint8(BetStatus.Open));
            assertEq(b.bettor, fan);
            totalPayout += b.payout;
        }

        assertEq(totalPayout, 64_359_185, "blended payout matches the design note");
        assertEq(usd.balanceOf(address(router)), 30 * AUSD, "router escrows the stake");

        // Liability is reserved in each vault but no assets moved.
        assertEq(steadyVault.lockedLiability(), 17_362_459);
        assertEq(tempoVault.lockedLiability(), 10_230_769);
        assertEq(pulseVault.lockedLiability(), 6_765_957);
        assertEq(steadyVault.totalAssets(), 5000 * AUSD, "vault assets untouched at bet time");
    }

    // ------------------------------------------------------------------
    // Quote validation
    // ------------------------------------------------------------------

    function test_placeBet_rejectsExpiredQuote() public {
        SignedQuote[] memory qs = _standardBook();
        vm.warp(block.timestamp + 10);

        vm.prank(fan);
        vm.expectRevert(
            abi.encodeWithSelector(
                BetRouter.QuoteExpired.selector, qs[0].quote.expiry, uint64(block.timestamp)
            )
        );
        router.placeBet(marketId, Side.Yes, 30 * uint128(AUSD), 0, qs);
    }

    function test_placeBet_rejectsForeignSignature() public {
        SignedQuote[] memory qs = new SignedQuote[](1);
        qs[0] = _quote(steadyPk, steadyId, 4635, 5665, 25 * uint128(AUSD));
        // Re-sign the same quote with a key that backs no agent.
        qs[0].signature = _sign(0xDEAD, qs[0].quote);

        vm.prank(fan);
        vm.expectRevert(
            abi.encodeWithSelector(BetRouter.AgentNotQuotable.selector, steadyId, vm.addr(0xDEAD))
        );
        router.placeBet(marketId, Side.Yes, 10 * uint128(AUSD), 0, qs);
    }

    function test_placeBet_rejectsDisabledAgent() public {
        vm.prank(admin);
        registry.setEnabled(steadyId, false);

        SignedQuote[] memory qs = new SignedQuote[](1);
        qs[0] = _quote(steadyPk, steadyId, 4635, 5665, 25 * uint128(AUSD));

        vm.prank(fan);
        vm.expectRevert(
            abi.encodeWithSelector(BetRouter.AgentNotQuotable.selector, steadyId, vm.addr(steadyPk))
        );
        router.placeBet(marketId, Side.Yes, 10 * uint128(AUSD), 0, qs);
    }

    /// @dev Below the minimum overround an agent is racing to zero margin.
    function test_placeBet_rejectsInsufficientMargin() public {
        SignedQuote[] memory qs = new SignedQuote[](1);
        qs[0] = _quote(steadyPk, steadyId, 4600, 5599, 25 * uint128(AUSD)); // sums to 10_199

        vm.prank(fan);
        vm.expectRevert(
            abi.encodeWithSelector(OddsMath.MarginTooLow.selector, uint256(10_199), uint256(10_200))
        );
        router.placeBet(marketId, Side.Yes, 10 * uint128(AUSD), 0, qs);
    }

    function test_placeBet_rejectsQuoteForAnotherMarket() public {
        SignedQuote[] memory qs = new SignedQuote[](1);
        qs[0] = _quote(steadyPk, steadyId, 4635, 5665, 25 * uint128(AUSD));
        qs[0].quote.marketId = 999;
        qs[0].signature = _sign(steadyPk, qs[0].quote);

        vm.prank(fan);
        vm.expectRevert(
            abi.encodeWithSelector(BetRouter.QuoteForWrongMarket.selector, marketId, uint256(999))
        );
        router.placeBet(marketId, Side.Yes, 10 * uint128(AUSD), 0, qs);
    }

    /// @dev One agent must not be able to occupy several rungs of the ladder.
    function test_placeBet_rejectsDuplicateAgent() public {
        SignedQuote[] memory qs = new SignedQuote[](2);
        qs[0] = _quote(steadyPk, steadyId, 4635, 5665, 25 * uint128(AUSD));
        qs[1] = _quote(steadyPk, steadyId, 4700, 5600, 25 * uint128(AUSD));

        vm.prank(fan);
        vm.expectRevert(abi.encodeWithSelector(BetRouter.DuplicateAgent.selector, steadyId));
        router.placeBet(marketId, Side.Yes, 10 * uint128(AUSD), 0, qs);
    }

    function test_placeBet_rejectsFillsOutOfPriceOrder() public {
        SignedQuote[] memory qs = new SignedQuote[](2);
        qs[0] = _quote(tempoPk, tempoId, 4700, 5600, 25 * uint128(AUSD)); // worse first
        qs[1] = _quote(steadyPk, steadyId, 4635, 5665, 25 * uint128(AUSD));

        vm.prank(fan);
        vm.expectRevert(
            abi.encodeWithSelector(BetRouter.FillsNotBestPriceFirst.selector, uint16(4700), uint16(4635))
        );
        router.placeBet(marketId, Side.Yes, 10 * uint128(AUSD), 0, qs);
    }

    function test_placeBet_rejectsTooManyFills() public {
        SignedQuote[] memory qs = new SignedQuote[](4);
        vm.prank(fan);
        vm.expectRevert(abi.encodeWithSelector(BetRouter.InvalidFillCount.selector, uint256(4)));
        router.placeBet(marketId, Side.Yes, 10 * uint128(AUSD), 0, qs);
    }

    function test_placeBet_rejectsClosedMarket() public {
        SignedQuote[] memory qs = _standardBook();
        vm.warp(closesAt);

        vm.prank(fan);
        vm.expectRevert(abi.encodeWithSelector(BetRouter.MarketNotBettable.selector, marketId));
        router.placeBet(marketId, Side.Yes, 30 * uint128(AUSD), 0, qs);
    }

    function test_placeBet_rejectsSuspendedMarket() public {
        SignedQuote[] memory qs = _standardBook();
        vm.prank(scheduler);
        mm.suspend(marketId, "VAR");

        vm.prank(fan);
        vm.expectRevert(abi.encodeWithSelector(BetRouter.MarketNotBettable.selector, marketId));
        router.placeBet(marketId, Side.Yes, 30 * uint128(AUSD), 0, qs);
    }

    // ------------------------------------------------------------------
    // Slippage and replay
    // ------------------------------------------------------------------

    /// @dev The relay is untrusted. All it can do is offer a worse price, and minPayout is the
    ///      fan's protection against exactly that.
    function test_placeBet_revertsWhenPayoutIsBelowMinimum() public {
        vm.prank(fan);
        vm.expectRevert(
            abi.encodeWithSelector(
                BetRouter.PayoutBelowMinimum.selector, uint256(64_359_185), uint128(64_500_000)
            )
        );
        router.placeBet(marketId, Side.Yes, 30 * uint128(AUSD), 64_500_000, _standardBook());
    }

    /// @dev A quote is a standing offer up to maxStake, consumable across several bets, and never
    ///      beyond it.
    function test_quoteFilled_accumulatesAcrossBetsAndCapsAtMaxStake() public {
        SignedQuote[] memory qs = new SignedQuote[](1);
        qs[0] = _quote(steadyPk, steadyId, 4635, 5665, 20 * uint128(AUSD));
        bytes32 h = router.hashQuote(qs[0].quote);

        vm.prank(fan);
        router.placeBet(marketId, Side.Yes, 12 * uint128(AUSD), 0, qs);
        assertEq(router.quoteFilled(h), 12 * AUSD);

        vm.prank(fan);
        router.placeBet(marketId, Side.Yes, 8 * uint128(AUSD), 0, qs);
        assertEq(router.quoteFilled(h), 20 * AUSD, "exhausted");

        vm.prank(fan);
        vm.expectRevert(
            abi.encodeWithSelector(
                BetRouter.QuoteOverfilled.selector, h, uint128(20 * AUSD), uint128(20 * AUSD)
            )
        );
        router.placeBet(marketId, Side.Yes, 1 * uint128(AUSD), 0, qs);
    }

    /// @dev A stretched vault should be routed around, not reverted on. Quote sizes here are
    ///      deliberately large so that free capital, not `maxStake`, is the binding constraint.
    function test_placeBet_sizesFillsAgainstAgentFreeCapital() public {
        // Consume most of Steady's exposure headroom on this market.
        SignedQuote[] memory drain = new SignedQuote[](1);
        drain[0] = _quote(steadyPk, steadyId, 4635, 5665, 2000 * uint128(AUSD));
        vm.prank(fan);
        router.placeBet(marketId, Side.Yes, 1250 * uint128(AUSD), 0, drain);

        uint256 budgetLeft = steadyVault.quotableBudget(marketId);
        assertLt(budgetLeft, 100 * AUSD, "Steady is now stretched on this market");

        SignedQuote[] memory book = new SignedQuote[](3);
        book[0] = _quote(steadyPk, steadyId, 4635, 5665, 1000 * uint128(AUSD));
        book[1] = _quote(tempoPk, tempoId, 4680, 5620, 1000 * uint128(AUSD));
        book[2] = _quote(pulsePk, pulseId, 4700, 5600, 1000 * uint128(AUSD));

        vm.prank(fan);
        (, uint256[] memory betIds) = router.placeBet(marketId, Side.Yes, 100 * uint128(AUSD), 0, book);

        uint256 placed;
        uint256 steadyStake;
        for (uint256 i = 0; i < betIds.length; ++i) {
            Bet memory b = router.getBet(betIds[i]);
            placed += b.stake;
            if (b.agentId == steadyId) steadyStake = b.stake;
        }

        assertEq(placed, 100 * AUSD, "whole stake still placed");
        assertLt(steadyStake, 50 * AUSD, "Steady took less than its ladder share");
    }

    // ------------------------------------------------------------------
    // Settlement
    // ------------------------------------------------------------------

    function _settleAll(Outcome outcome, uint64 eventTs) internal returns (uint256[] memory betIds) {
        betIds = new uint256[](3);
        for (uint256 i = 0; i < 3; ++i) {
            betIds[i] = i + 1;
        }

        vm.warp(closesAt);
        vm.prank(settler);
        mm.resolve(marketId, outcome, eventTs);
        router.settleBatch(betIds);
    }

    function test_settle_fanWinsAndClaimsBlendedPayout() public {
        vm.prank(fan);
        router.placeBet(marketId, Side.Yes, 30 * uint128(AUSD), 0, _standardBook());

        uint256[] memory betIds = _settleAll(Outcome.Yes, 0);

        for (uint256 i = 0; i < 3; ++i) {
            assertEq(uint8(router.getBet(betIds[i]).status), uint8(BetStatus.Won));
        }

        uint256 before = usd.balanceOf(fan);
        vm.prank(fan);
        uint256 total = router.claim(betIds);

        assertEq(total, 64_359_185, "blended payout");
        assertEq(usd.balanceOf(fan) - before, 64_359_185);
        assertEq(steadyVault.lockedLiability(), 0, "liability released");
        assertEq(steadyVault.totalAssets(), 5000 * AUSD - 17_362_459, "vault paid its share");
    }

    function test_settle_fanLosesAndVaultsKeepTheStake() public {
        vm.prank(fan);
        router.placeBet(marketId, Side.Yes, 30 * uint128(AUSD), 0, _standardBook());

        uint256[] memory betIds = _settleAll(Outcome.No, 0);

        assertEq(uint8(router.getBet(betIds[0]).status), uint8(BetStatus.Lost));
        assertEq(router.claimableAmount(betIds[0]), 0, "nothing to claim on a loss");
        assertEq(steadyVault.totalAssets(), 5000 * AUSD + 15 * AUSD, "kept the 15 AUSD stake");
        assertEq(steadyVault.lockedLiability(), 0);
    }

    function test_settle_voidedMarketRefundsEveryStake() public {
        vm.prank(fan);
        router.placeBet(marketId, Side.Yes, 30 * uint128(AUSD), 0, _standardBook());

        uint256[] memory betIds = new uint256[](3);
        for (uint256 i = 0; i < 3; ++i) {
            betIds[i] = i + 1;
        }

        vm.prank(settler);
        mm.voidMarket(marketId, "DATA_GAP");
        router.settleBatch(betIds);

        vm.prank(fan);
        assertEq(router.claim(betIds), 30 * AUSD, "stake returned in full");
        assertEq(steadyVault.totalAssets(), 5000 * AUSD, "vault neither gained nor lost");
    }

    /// @dev The anti-sniping rule. A bet struck inside the delay window before the event is
    ///      refunded even though it would have won.
    function test_settle_voidsBetsStruckJustBeforeTheEvent() public {
        vm.prank(fan);
        router.placeBet(marketId, Side.Yes, 30 * uint128(AUSD), 0, _standardBook());

        uint64 placedAt = uint64(block.timestamp);
        // Event lands 5 seconds later; the rule covers 8.
        uint256[] memory betIds = _settleAll(Outcome.Yes, placedAt + 5);

        for (uint256 i = 0; i < 3; ++i) {
            assertEq(
                uint8(router.getBet(betIds[i]).status),
                uint8(BetStatus.Voided),
                "sniped bet refunded, not paid"
            );
        }

        vm.prank(fan);
        assertEq(router.claim(betIds), 30 * AUSD, "stake back, no winnings");
    }

    function test_settle_keepsBetsPlacedOutsideTheDelayWindow() public {
        vm.prank(fan);
        router.placeBet(marketId, Side.Yes, 30 * uint128(AUSD), 0, _standardBook());

        uint64 placedAt = uint64(block.timestamp);
        // Event lands 9 seconds later: outside the 8 second rule.
        uint256[] memory betIds = _settleAll(Outcome.Yes, placedAt + 9);

        assertEq(uint8(router.getBet(betIds[0]).status), uint8(BetStatus.Won));
    }

    /// @dev Voiding must be symmetric. Refunding only the side that gained would let a sniper take
    ///      the losing side to force a refund and bet for free.
    function test_settle_sniperRuleAppliesToTheLosingSideToo() public {
        vm.prank(fan);
        router.placeBet(marketId, Side.No, 30 * uint128(AUSD), 0, _standardBookNo());

        uint64 placedAt = uint64(block.timestamp);
        uint256[] memory betIds = _settleAll(Outcome.Yes, placedAt + 5);

        assertEq(
            uint8(router.getBet(betIds[0]).status), uint8(BetStatus.Voided), "losing side refunded as well"
        );
    }

    function test_settleBatch_isIdempotent() public {
        vm.prank(fan);
        router.placeBet(marketId, Side.Yes, 30 * uint128(AUSD), 0, _standardBook());

        uint256[] memory betIds = _settleAll(Outcome.Yes, 0);
        router.settleBatch(betIds); // second pass must be a no-op

        assertEq(steadyVault.lockedLiability(), 0);
        vm.prank(fan);
        assertEq(router.claim(betIds), 64_359_185, "paid exactly once");
    }

    function test_settleBatch_revertsWhileMarketIsUnresolved() public {
        vm.prank(fan);
        router.placeBet(marketId, Side.Yes, 30 * uint128(AUSD), 0, _standardBook());

        uint256[] memory betIds = new uint256[](1);
        betIds[0] = 1;

        vm.expectRevert(
            abi.encodeWithSelector(BetRouter.MarketNotSettled.selector, marketId, MarketState.Open)
        );
        router.settleBatch(betIds);
    }

    function test_claim_isNotRepeatable() public {
        vm.prank(fan);
        router.placeBet(marketId, Side.Yes, 30 * uint128(AUSD), 0, _standardBook());
        uint256[] memory betIds = _settleAll(Outcome.Yes, 0);

        vm.prank(fan);
        router.claim(betIds);
        vm.prank(fan);
        assertEq(router.claim(betIds), 0, "second claim pays nothing");
    }

    function test_claim_rejectsSomeoneElsesBet() public {
        vm.prank(fan);
        router.placeBet(marketId, Side.Yes, 30 * uint128(AUSD), 0, _standardBook());
        uint256[] memory betIds = _settleAll(Outcome.Yes, 0);

        vm.prank(backer);
        vm.expectRevert(abi.encodeWithSelector(BetRouter.NotBettor.selector, betIds[0], backer));
        router.claim(betIds);
    }

    // ------------------------------------------------------------------
    // Conservation
    // ------------------------------------------------------------------

    /// @dev Money is neither created nor destroyed: what the fan gets back plus what the vaults
    ///      hold must equal what everyone started with.
    function testFuzz_settlementConservesValue(uint96 stakeRaw, bool yesWins, bool betYes) public {
        uint128 stake = uint128(bound(stakeRaw, 1 * AUSD, 60 * AUSD));

        uint256 startFan = usd.balanceOf(fan);
        uint256 startVaults = steadyVault.totalAssets() + tempoVault.totalAssets() + pulseVault.totalAssets();

        SignedQuote[] memory book = betYes ? _standardBook() : _standardBookNo();
        vm.prank(fan);
        (, uint256[] memory betIds) = router.placeBet(marketId, betYes ? Side.Yes : Side.No, stake, 0, book);

        vm.warp(closesAt);
        vm.prank(settler);
        mm.resolve(marketId, yesWins ? Outcome.Yes : Outcome.No, 0);
        router.settleBatch(betIds);

        vm.prank(fan);
        router.claim(betIds);

        uint256 endVaults = steadyVault.totalAssets() + tempoVault.totalAssets() + pulseVault.totalAssets();

        assertEq(
            usd.balanceOf(fan) + endVaults, startFan + startVaults, "value is conserved across settlement"
        );
        assertEq(usd.balanceOf(address(router)), 0, "router holds nothing afterwards");
        assertEq(steadyVault.lockedLiability(), 0);
        assertEq(tempoVault.lockedLiability(), 0);
        assertEq(pulseVault.lockedLiability(), 0);
    }
}
