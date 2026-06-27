<p align="center">
  <img src="images/cartai-logo.png" alt="CartAI" height="50" />
</p>

# CartAI MCP Server

> **<a href="https://cartai.ai" target="_blank" rel="noopener noreferrer">CartAI</a> Powered MCP Server to execute autonomous checkouts.**
>
> **<a href="https://portal.cartai.ai/" target="_blank" rel="noopener noreferrer">Sign up and try it on the CartAI Portal →</a>**

An <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer">MCP (Model Context Protocol)</a> server that exposes the CartAI Catalog and Checkout APIs as tools inside Claude Desktop, Claude Code, Cursor, or any MCP-compatible AI host. Search for products, fetch detailed variant and pricing info, get pre-checkout shipping and tax estimates — then hand off to CartAI to execute the entire checkout autonomously, asynchronously, with full status tracking.

<a href="https://nodejs.org" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen" alt="Node.js ≥ 18"/></a>
<a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/MCP-compatible-blue" alt="MCP Compatible"/></a>
<a href="LICENSE" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License: Apache 2.0"/></a>

---

## Table of Contents

- [What is MCP?](#what-is-mcp)
- [What this server does](#what-this-server-does)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
  - [Claude Desktop](#claude-desktop)
  - [VS Code](#vs-code)
  - [MCP Inspector](#mcp-inspector)
- [Tools](#tools)
- [Example prompts](#example-prompts)
- [How it works](#how-it-works)
- [Environment variables](#environment-variables)
- [Troubleshooting](#troubleshooting)
- [Resources & Support](#resources--support)
- [License](#license)

---

## What is MCP?

<a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer">Model Context Protocol</a> is an open standard that lets AI assistants call external tools — APIs, databases, file systems — through a common interface. Think of it like a USB-C port for AI: one standard, any device. This server plugs CartAI's checkout capability into that port.

---

## What this server does

| Tool | Description |
|------|-------------|
| `create_checkout` | Start an async checkout for one or more products |
| `get_checkout` | Fetch the current state of a checkout task |
| `cancel_checkout` | Cancel an in-progress checkout |
| `get_status_history` | Get the full lifecycle event log for a task |
| `search_products` | Search for products by name across merchants |
| `get_product_details` | Retrieve detailed info, variants, and pricing for a product URL |
| `get_checkout_estimates` | Compute pre-checkout shipping and tax estimates before placing an order |

Under the hood every tool maps 1-to-1 to a CartAI REST endpoint — the MCP server is a thin, type-safe bridge with no additional logic.

---

## Prerequisites

| Requirement | Version / Notes |
|-------------|-----------------|
| **Node.js** | `>= 18.0.0` (uses native `fetch` and ES modules) |
| **CartAI API key** | Obtain from the <a href="https://cartai.ai" target="_blank" rel="noopener noreferrer">CartAI Admin Portal</a> — see <a href="https://docs.cartai.ai/" target="_blank" rel="noopener noreferrer">API Docs</a> for full reference |
| **MCP host** | Claude Desktop, VS Code (with MCP extension), or MCP Inspector |

---

## Installation

```bash
# 1. Clone the repo
git clone https://github.com/your-username/cartai-mcp.git
cd cartai-mcp

# 2. Install dependencies
npm install

# 3. Set your API key
export CARTAI_API_KEY=your_api_key_here

# 4. Verify it starts
npm start
# → [cartai-mcp] Running on stdio ✓
```

> **Never commit your API key.** The repo ships with a `.gitignore` that excludes `.env`.

---

## Configuration

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "cartai": {
      "command": "node",
      "args": ["/absolute/path/to/cartai-mcp/src/index.js"],
      "env": {
        "CARTAI_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

Restart Claude Desktop — you should see the CartAI tools in the tool picker.

---

### VS Code

Install the **MCP extension** for VS Code, then add the following to your `.vscode/mcp.json` (or user-level `settings.json` under `"mcp.servers"`):

```json
{
  "servers": {
    "cartai": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/cartai-mcp/src/index.js"],
      "env": {
        "CARTAI_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

Reload the VS Code window — the CartAI tools will be available to any MCP-aware agent running in the editor.

---

### MCP Inspector

<a href="https://github.com/modelcontextprotocol/inspector" target="_blank" rel="noopener noreferrer">MCP Inspector</a> is the official browser-based tool for testing and debugging MCP servers without needing a full AI client.

```bash
# Run Inspector against this server in one command
npx @modelcontextprotocol/inspector node /absolute/path/to/cartai-mcp/src/index.js
```

Set the API key in the **Environment Variables** panel inside Inspector (`CARTAI_API_KEY = your_api_key_here`), then use the **Tools** tab to call `create_checkout`, `get_checkout`, etc. interactively.

> MCP Inspector is the fastest way to validate tool inputs/outputs before wiring up a full client.

---

## Tools

### `create_checkout`

Creates a new async checkout task. CartAI runs the checkout in the background and emits status updates via webhooks. Returns a `taskId` for tracking.

**Required inputs:**

| Field | Type | Description |
|-------|------|-------------|
| `customer.contact.firstName` | `string` | — |
| `customer.contact.lastName` | `string` | — |
| `customer.contact.phone` | `string` | — |
| `customer.contact.email` | `string` | — |
| `customer.shippingAddress.addressLine1` | `string` | — |
| `customer.shippingAddress.addressLine2` | `string` | — |
| `customer.shippingAddress.city` | `string` | — |
| `customer.shippingAddress.province` | `string` | State/province code e.g. `NY` |
| `customer.shippingAddress.postalCode` | `string` | ZIP or postal code |
| `customer.shippingAddress.country` | `string` | Country code e.g. `US` |
| `customer.payment.provider` | `string` | Payment provider identifier |
| `tasks[].url` | `string` | Full product page URL |
| `tasks[].quantity` | `integer` | Units to purchase (min 1) |

**Optional inputs:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `customer.customerId` | `UUID` | `null` | Existing CartAI customer ID |
| `customer.billingAddress` | object | `null` | Same shape as `shippingAddress`; defaults to shipping address if omitted |
| `customer.shippingMethod.strategy` | `string` | `"cheapest"` | `"cheapest"` \| `"fastest"` \| `"standard"` |
| `customer.payment.data.userId` | `string` | `null` | User ID for provider-linked payment |
| `tasks[].selectedVariant.color` | `string` | `null` | — |
| `tasks[].selectedVariant.size` | `string` | `null` | — |
| `tasks[].metadata.title` | `string` | `null` | Display only — not used for checkout logic |
| `tasks[].metadata.description` | `string` | `null` | Display only |
| `tasks[].metadata.primaryImage` | `string` | `null` | Display only |
| `tasks[].metadata.price` | `string` | `null` | Display only |
| `options.cartId` | `UUID` | `null` | Associate checkout with an existing cart |
| `options.verifyBeforePlacement` | `boolean` | `false` | Pause for customer confirmation before placing |
| `options.failTaskIfNotConfirmed` | `boolean` | `false` | Fail the task if confirmation is not received |
| `options.allowPartialCheckout` | `boolean` | `true` | Allow partial success on multi-SKU orders |
| `options.isRetryEnable` | `boolean` | `false` | Automatically retry failed checkout attempts |
| `options.loginForLoyaltyDiscounts` | `boolean` | `false` | Log in to apply loyalty/rewards discounts |
| `metadata.profile_id` | `string` | `null` | Internal profile identifier for tracking |

**Returns:** `taskId` and initial task status confirming the checkout has been queued.

---

### `get_checkout`

Retrieves the current state of a checkout task.

**Required:** `taskId` — returned by `create_checkout`.

> Tip: hook this to a CartAI webhook event rather than polling.

**Returns:** Current task status, customer info, task items, and derived pricing/shipping details.

---

### `cancel_checkout`

Cancels an in-progress checkout task.

**Required:** `taskId`

**Returns:** Confirmation that the checkout task has been stopped and will not proceed further.

---

### `get_status_history`

Returns the full lifecycle event log — all steps, timestamps, and credits consumed.

**Required:** `taskId`

**Returns:** Ordered list of lifecycle events with statuses, timestamps, and credits consumed per step.

---

### `search_products`

Searches for products by name across merchants. Returns ranked results with pricing, images, and purchase links.

**Required inputs:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Product name or search query |

**Optional inputs:**

| Field | Type | Description |
|-------|------|-------------|
| `merchant` | `string` | Merchant name to prioritize results (e.g. `"amazon"`, `"walmart"`). Other retailers are still returned. |

**Returns:** Ranked `products[]` each with `name`, `brand`, `merchant`, `image`, `priceFrom`, `currency`, and `directUrl` (use as `url` in `create_checkout` or `get_product_details`). Also returns `targetMerchant` and `targetMatchCount`.

---

### `get_product_details`

Retrieves detailed product information for a given product page URL, including all available variants, pricing, and availability.

**Required inputs:**

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string` (URI) | Full product page URL |

**Optional inputs:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `allVariants` | `boolean` | `true` | When `true`, returns all available variants (color, size, etc.) |

**Returns:** Product metadata (`name`, `brand`, `retailer`, `image`), `directUrl`, `commissionUrl`, variant `dimensions`, and a `variants[]` list with per-variant `price`, `available`, `attributes`, `url`, and `commissionUrl`.

---

### `get_checkout_estimates`

Computes a pre-checkout cost estimate for a given merchant, destination, and list of items — before placing an order.

**Required inputs:**

| Field | Type | Description |
|-------|------|-------------|
| `merchant` | `string` | Merchant name to estimate costs for (e.g. `"amazon"`) |
| `destination` | `object` | Delivery destination for shipping and tax calculation |
| `destination.city` | `string` | — |
| `destination.province` | `string` | State/province code e.g. `NY` |
| `destination.postalCode` | `string` | ZIP or postal code |
| `destination.country` | `string` | Country code e.g. `US` |
| `items` | `array` | List of items to estimate |
| `items[].url` | `string` (URI) | Full product page URL |
| `items[].quantity` | `integer` | Number of units (min 1) |

**Optional inputs:**

| Field | Type | Description |
|-------|------|-------------|
| `destination.addressLine1` | `string` | Street address line 1 |
| `destination.addressLine2` | `string` | Street address line 2 |
| `items[].selectedVariant.color` | `string` | Variant color |
| `items[].selectedVariant.size` | `string` | Variant size |

**Returns:** Full cost breakdown with `subtotal`, `shipping`, `shippingKnown`, `tax`, `total`, `currency`, and a per-item `items[]` breakdown — all in the resolved `destination` context.

---

## Example prompts

Once the server is connected, try these in Claude:

```
Order 2 units of https://example.com/product/sneakers in size 10, color black.
Ship to John Doe, 123 Main St, New York NY 10001.
Use card 4242 4242 4242 4242, CVV 123, exp 12/2034.
```

```
Check the status of checkout task abc-123-def.
```

```
Cancel checkout task abc-123-def with execution ID xyz-789.
```

```
Show me the full status history for task abc-123-def including how many credits were used.
```

---

## How it works

CartAI exposes two sets of capabilities: **Catalog** (discover and evaluate products) and **Checkout** (autonomously place orders).

### Catalog flow

Use the catalog tools to find products and validate details before committing to a purchase:

1. **`search_products`** — search by name across merchants to get a ranked list with pricing and `directUrl` for each result.
2. **`get_product_details`** — pass a `directUrl` to retrieve all variants, stock availability, and per-variant pricing.
3. **`get_checkout_estimates`** — compute shipping and tax for a destination before placing the order.

### Checkout flow

Once you have a product URL and customer details, hand off to CartAI:

```
Your App                  CartAI Agent              Merchant Website
    |                          |                          |
    |— POST /checkout ————————>|                          |
    |<— { taskId } ———————————|                          |
    |                          |— Navigates site ————————>|
    |                          |  Adds to cart            |
    |                          |  Selects shipping        |
    |                          |  Completes payment       |
    |                          |<— Order confirmed ———————|
    |<— Webhook: COMPLETED ————|                          |
```

1. **`create_checkout`** — pass the product URL, customer shipping address, and payment credentials.
2. **Receive a `taskId` immediately** — the checkout runs asynchronously in the background.
3. **The AI agent does the work** — navigating the merchant's live website, selecting the right variant, applying your shipping strategy, and placing the order.
4. **Track progress** — use `get_checkout` or `get_status_history` to monitor the task; cancel anytime with `cancel_checkout`.

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CARTAI_API_KEY` | Yes | Your CartAI API key from the Admin Portal |

The server will start without the key but every API call will be rejected with an auth error. A warning is printed to stderr on startup if the key is missing.

---

## Troubleshooting

**"All API calls will be rejected" warning on startup**
The `CARTAI_API_KEY` env var is not set. Pass it in the MCP config's `env` block (see [Configuration](#configuration)) or export it before running.

**Tool doesn't appear in Claude**
- Confirm the absolute path in the MCP config is correct (`node /full/path/to/src/index.js`).
- Restart Claude Desktop / reload the MCP session after editing config.
- Run `node src/index.js` directly in a terminal to check for startup errors.

**HTTP 401 from CartAI**
Your API key is invalid or expired. Regenerate it in the CartAI Admin Portal.

**HTTP 404 on get_checkout / get_status_history**
The `taskId` doesn't exist or belongs to a different account.

**Node version error**
This package uses native `fetch` and ES modules — Node.js 18 or newer is required. Run `node --version` to check.

---

## Resources & Support

- **API Docs:** <a href="https://docs.cartai.ai/" target="_blank" rel="noopener noreferrer">docs.cartai.ai</a>
- **Website:** <a href="https://cartai.ai" target="_blank" rel="noopener noreferrer">cartai.ai</a>
- **Email:** <a href="mailto:arb@cartai.ai">arb@cartai.ai</a>
- **Portal:** <a href="https://portal.cartai.ai/" target="_blank" rel="noopener noreferrer">Sign up, explore, and manage your account</a>

---

## License

Licensed under the <a href="LICENSE" target="_blank" rel="noopener noreferrer">Apache License 2.0</a>.
