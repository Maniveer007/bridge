// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title BridgedUSDC
 * @notice Deployed on the destination chain (local / custom chain).
 *         The bridging engine calls mint() after detecting a TokensLocked
 *         event on the source chain. Users can burn to bridge back.
 */
contract BridgedUSDC is ERC20, AccessControl {
    // ─── Roles ───────────────────────────────────────────────────────────────

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // ─── State ───────────────────────────────────────────────────────────────

    uint8 private immutable _dec;

    /// @dev lockId → minted? Prevents the relayer from minting twice for the same lock.
    mapping(bytes32 => bool) public processedMints;

    /// @dev Monotonically increasing counter used to derive a unique burnId per burn.
    uint256 public burnNonce;

    // ─── Events ──────────────────────────────────────────────────────────────

    /**
     * @notice Emitted after the relayer successfully mints bUSDC.
     * @param recipient  Address that received the bUSDC.
     * @param amount     Amount minted.
     * @param lockId     Source-chain lock ID — matches the vault's TokensLocked event.
     */
    event TokensMinted(
        address indexed recipient,
        uint256 amount,
        bytes32 indexed lockId
    );

    /**
     * @notice Emitted when a user burns bUSDC to initiate a return bridge.
     * @param burner              User who burned.
     * @param amount              Amount burned.
     * @param burnId              Globally unique ID: keccak256(chainId, contract, burnNonce).
     *                            The relayer uses this as the releaseId on BridgeVault.unlock().
     * @param destinationChainId  Source chain to receive unlocked USDC.
     * @param destinationAddress  Address on the source chain to receive USDC.
     */
    event TokensBurned(
        address indexed burner,
        uint256 amount,
        bytes32 indexed burnId,
        uint256 destinationChainId,
        address destinationAddress
    );

    // ─── Constructor ─────────────────────────────────────────────────────────

    /**
     * @param admin     Address that receives DEFAULT_ADMIN_ROLE and MINTER_ROLE.
     * @param decimals_ Token decimals — pass 6 to match real USDC.
     */
    constructor(address admin, uint8 decimals_) ERC20("Bridged USDC", "bUSDC") {
        require(admin != address(0), "BridgedUSDC: zero admin");
        _dec = decimals_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    // ─── ERC20 overrides ─────────────────────────────────────────────────────

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    // ─── Minter-facing ───────────────────────────────────────────────────────

    /**
     * @notice Mint bUSDC to a recipient.
     *         Idempotent — reverts if lockId was already processed.
     * @param recipient  Address to receive bUSDC.
     * @param amount     Amount to mint (must equal the locked amount on source).
     * @param lockId     Unique lock ID from the source chain's TokensLocked event.
     */
    function mint(
        address recipient,
        uint256 amount,
        bytes32 lockId
    ) external onlyRole(MINTER_ROLE) {
        require(!processedMints[lockId], "BridgedUSDC: lockId already minted");
        require(recipient != address(0), "BridgedUSDC: zero recipient");
        require(amount > 0, "BridgedUSDC: zero amount");

        processedMints[lockId] = true;
        _mint(recipient, amount);

        emit TokensMinted(recipient, amount, lockId);
    }

    // ─── User-facing ─────────────────────────────────────────────────────────

    /**
     * @notice Burn bUSDC to request USDC unlock on the source chain.
     *         The bridging engine listens to TokensBurned and calls BridgeVault.unlock().
     * @param amount              How much bUSDC to burn.
     * @param destinationChainId  Source chain ID.
     * @param destinationAddress  Address on the source chain to receive unlocked USDC.
     */
    function burn(
        uint256 amount,
        uint256 destinationChainId,
        address destinationAddress
    ) external {
        require(amount > 0, "BridgedUSDC: zero amount");
        require(destinationAddress != address(0), "BridgedUSDC: zero destination address");
        require(destinationChainId != 0, "BridgedUSDC: zero destination chain");

        uint256 currentBurnNonce = burnNonce;
        burnNonce++;

        // Deterministic, globally unique burn ID — relayer passes this as releaseId
        // to BridgeVault.unlock() on the source chain.
        bytes32 burnId = keccak256(
            abi.encodePacked(block.chainid, address(this), currentBurnNonce)
        );

        _burn(msg.sender, amount);

        emit TokensBurned(msg.sender, amount, burnId, destinationChainId, destinationAddress);
    }
}
