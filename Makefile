# ════════════════════════════════════════════════════════════════════════
#  Bridge Project
#  Edit  .env  at the project root, then run  make sync-env.
#  sync-env runs automatically before deploy / fund-relayer.
# ════════════════════════════════════════════════════════════════════════

ROOT_ENV := .env

# Load root .env so Make itself can reference the variables.
ifneq (,$(wildcard $(ROOT_ENV)))
  include $(ROOT_ENV)
  export $(shell sed 's/=.*//' $(ROOT_ENV) | grep -v '^\#' | grep -v '^$$')
endif

# Anvil pre-funded account #0 — used to send gas to the relayer.
ANVIL_FAUCET_KEY  := 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ANVIL_FAUCET_ADDR := 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
FUND_AMOUNT       := 10ether

.PHONY: sync-env deploy-vault deploy-bridged node fund-relayer 

# ── sync-env ─────────────────────────────────────────────────────────────────
# Generates the per-service .env files from the single root .env.
#   smartcontracts/.env  — direct copy (forge reads plain var names)
#   bridging-engine/.env — direct copy (engine reads plain var names)
#   frontend/.env        — chain/contract vars re-exported as NEXT_PUBLIC_*

FRONTEND_VARS := SOURCE_RPC_URL SOURCE_BACKUP_RPC_URL SOURCE_CHAIN_ID SOURCE_CHAIN_NAME SOURCE_EXPLORER \
                 DEST_RPC_URL DEST_BACKUP_RPC_URL DEST_CHAIN_ID DEST_CHAIN_NAME DEST_EXPLORER \
                 VAULT_ADDRESS USDC_ADDRESS BRIDGED_USDC_ADDRESS USDC_DECIMALS \
                 SOURCE_LEGACY_TX DEST_LEGACY_TX DEST_GAS_LIMIT

sync-env: $(ROOT_ENV)
	@echo "==> Syncing root .env to all services ..."

	@# smartcontracts/.env — plain copy
	@echo "# Auto-generated from root .env — do not edit directly" >  smartcontracts/.env
	@cat $(ROOT_ENV)                                               >> smartcontracts/.env

	@# bridging-engine/.env — plain copy
	@echo "# Auto-generated from root .env — do not edit directly" >  bridging-engine/.env
	@cat $(ROOT_ENV)                                               >> bridging-engine/.env

	@# frontend/.env — NEXT_PUBLIC_ prefix on chain + contract vars
	@echo "# Auto-generated from root .env — do not edit directly" >  frontend/.env
	@grep -E "^($(shell echo '$(FRONTEND_VARS)' | tr ' ' '|'))=" $(ROOT_ENV) \
		| sed 's/^/NEXT_PUBLIC_/'                                 >> frontend/.env
	@grep -E "^MONGODB_URI=" $(ROOT_ENV)                          >> frontend/.env

	@echo "  ✓ smartcontracts/.env"
	@echo "  ✓ bridging-engine/.env"
	@echo "  ✓ frontend/.env"

# ── Local Anvil node ──────────────────────────────────────────────────────────
# Run in a separate terminal before deploying the destination contract.

node:
	@echo "Starting Anvil on :8545 (chain-id 31337) ..."
	anvil --chain-id 31337

# ── Deploy BridgeVault on source chain (Sepolia) ──────────────────────────────

deploy-vault: sync-env
	@echo ""
	@echo "==> Deploying BridgeVault on $(SOURCE_CHAIN_NAME) ($(SOURCE_RPC_URL)) ..."
	@echo ""
	cd smartcontracts && forge script script/DeployVault.s.sol \
		--rpc-url "$(SOURCE_RPC_URL)" \
		--broadcast \
		-vvvv
	@echo ""
	@echo "==> Copy the deployed VAULT_ADDRESS into root .env, then run  make sync-env"

# ── Deploy BridgedUSDC on destination chain ───────────────────────────────────
# Requires: make node is running in another terminal.

deploy-bridged: sync-env
	@echo ""
	@echo "==> Deploying BridgedUSDC on $(DEST_CHAIN_NAME) ($(DEST_RPC_URL)) ..."
	@echo ""
	cd smartcontracts && forge script script/DeployBridgedUSDC.s.sol \
		--rpc-url "$(DEST_RPC_URL)" \
		--broadcast \
		--legacy \
		-vvvv
	@echo ""
	@echo "==> Copy the deployed BRIDGED_USDC_ADDRESS into root .env, then run  make sync-env"

# ── Fund relayer on local chain ───────────────────────────────────────────────
# Sends 10 ETH from the Anvil faucet to RELAYER_ADDRESS for gas.

fund-relayer: sync-env
	@[ -n "$(RELAYER_ADDRESS)" ] || { echo "ERROR: RELAYER_ADDRESS not set in $(ROOT_ENV)"; exit 1; }
	@echo ""
	@echo "==> Funding relayer $(RELAYER_ADDRESS) with $(FUND_AMOUNT) ..."
	cast send \
		--rpc-url  "$(DEST_RPC_URL)" \
		--private-key "$(ANVIL_FAUCET_KEY)" \
		--value    "$(FUND_AMOUNT)" \
		"$(RELAYER_ADDRESS)"
	@echo ""
	@echo "==> Relayer balance:"
	@cast balance "$(RELAYER_ADDRESS)" --rpc-url "$(DEST_RPC_URL)" --ether


