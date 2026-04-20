// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title BridgeVault
 * @notice Deployed on the source chain (Sepolia).
 *         Users lock USDC here; the bridging engine listens to
 *         TokensLocked and mints equivalent bUSDC on the destination chain.
 */
contract BridgeVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── State ───────────────────────────────────────────────────────────────

    IERC20 public immutable usdc;
    address public relayer;
    uint256 public nonce;

    /// @dev Prevents the relayer from releasing the same releaseId twice.
    ///      For forward bridge failures the releaseId equals the lockId.
    ///      For reverse bridge the releaseId equals the burnId from BridgedUSDC.
    mapping(bytes32 => bool) public processedReleases;

    // ─── Events ──────────────────────────────────────────────────────────────

    /**
     * @notice Emitted when a user locks USDC for bridging.
     * @param sender          User who initiated the lock.
     * @param amount          Amount of USDC locked (in token decimals).
     * @param nonce           Monotonically increasing counter per vault.
     * @param lockId          Globally unique ID: keccak256(chainId, vault, nonce).
     * @param destinationChainId  Target chain where bUSDC will be minted.
     * @param destinationAddress  Address on the destination chain to receive bUSDC.
     */
    event TokensLocked(
        address indexed sender,
        uint256 amount,
        uint256 nonce,
        bytes32 indexed lockId,
        uint256 destinationChainId,
        address destinationAddress
    );

    /**
     * @notice Emitted when the relayer releases USDC back to a user
     *         (failed forward-bridge mint or reverse bridge via burn).
     * @param releaseId  For forward failures: the original lockId.
     *                   For reverse bridge: the burnId from BridgedUSDC.TokensBurned.
     */
    event TokensUnlocked(
        address indexed recipient,
        uint256 amount,
        bytes32 indexed releaseId
    );

    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyRelayer() {
        require(msg.sender == relayer, "BridgeVault: caller is not relayer");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _usdc, address _relayer) Ownable(msg.sender) {
        require(_usdc != address(0), "BridgeVault: zero usdc address");
        require(_relayer != address(0), "BridgeVault: zero relayer address");
        usdc = IERC20(_usdc);
        relayer = _relayer;
    }

    // ─── User-facing ─────────────────────────────────────────────────────────

    /**
     * @notice Lock USDC and emit an event for the bridging engine to pick up.
     * @dev    Caller must have approved this contract for at least `amount` USDC.
     * @param amount              How much USDC to bridge (in token decimals, i.e. 6).
     * @param destinationChainId  Chain ID of the destination network.
     * @param destinationAddress  Address on the destination chain to receive bUSDC.
     */
    function lock(
        uint256 amount,
        uint256 destinationChainId,
        address destinationAddress
    ) external nonReentrant {
        require(amount > 0, "BridgeVault: zero amount");
        require(destinationAddress != address(0), "BridgeVault: zero destination address");
        require(destinationChainId != 0, "BridgeVault: zero destination chain");

        // Pull USDC from sender into this vault.
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        uint256 currentNonce = nonce;
        nonce++;

        // Deterministic, globally unique lock ID.
        bytes32 lockId = keccak256(
            abi.encodePacked(block.chainid, address(this), currentNonce)
        );

        emit TokensLocked(
            msg.sender,
            amount,
            currentNonce,
            lockId,
            destinationChainId,
            destinationAddress
        );
    }

    // ─── Relayer-facing ──────────────────────────────────────────────────────

    /**
     * @notice Release locked USDC back to a recipient.
     *         Used when a forward-bridge mint fails (releaseId = lockId) or
     *         when processing a reverse bridge burn (releaseId = burnId from BridgedUSDC).
     * @param recipient  Address to receive the USDC.
     * @param amount     Amount to release.
     * @param releaseId  Unique ID that prevents double-releases:
     *                   - Forward failure: pass the lockId from TokensLocked.
     *                   - Reverse bridge:  pass the burnId from TokensBurned.
     */
    function unlock(
        address recipient,
        uint256 amount,
        bytes32 releaseId
    ) external nonReentrant onlyRelayer {
        require(!processedReleases[releaseId], "BridgeVault: releaseId already processed");
        require(recipient != address(0), "BridgeVault: zero recipient");
        require(amount > 0, "BridgeVault: zero amount");

        processedReleases[releaseId] = true;
        usdc.safeTransfer(recipient, amount);

        emit TokensUnlocked(recipient, amount, releaseId);
    }

    // ─── Owner-facing ────────────────────────────────────────────────────────

    function setRelayer(address newRelayer) external onlyOwner {
        require(newRelayer != address(0), "BridgeVault: zero relayer address");
        emit RelayerUpdated(relayer, newRelayer);
        relayer = newRelayer;
    }

    /**
     * @notice Emergency escape hatch — only owner, any ERC20.
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }
}
