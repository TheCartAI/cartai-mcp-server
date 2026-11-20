<p align="center">
  <img src="images/cartai-logo.png" alt="CartAI" height="50" />
</p>

# CartAI MCP Server

> **<a href="https://cartai.ai" target="_blank" rel="noopener noreferrer">CartAI</a> Powered MCP Server for autonomous product discovery, agentic payments, and checkout.**
> **<a href="https://portal.cartai.ai/" target="_blank" rel="noopener noreferrer">Sign up and try it on the CartAI Portal →</a>**

An <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer">MCP (Model Context Protocol)</a> server that exposes the CartAI Catalog, Payments, Credentials, and Checkout APIs as tools inside Claude Desktop, Claude Code, Cursor, or any MCP-compatible AI host. Powered entirely by CartAI — search for products, fetch detailed variant and pricing info, get pre-checkout shipping and tax estimates, get a customer's card authorized for agentic payments, securely store merchant logins, and execute the entire checkout autonomously — from product URLs or just product names — asynchronously, with full status tracking and interactive MFA support.

<br/>

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
  - [Checkout](#checkout-tools)
  - [Catalog](#catalog-tools)
  - [Payments](#payment-tools)
  - [Credentials](#credential-tools)
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
| `create_checkout` | Start an async checkout for one or more product URLs |
| `create_search_checkout` | Start an async checkout from product **names** on a given merchant — no URLs needed |
| `get_checkout` | Fetch the current state of a checkout task |
| `cancel_checkout` | Cancel an in-progress checkout |
| `get_status_history` | Get the full step-by-step event log for a task |
| `send_interactive_inputs` | Send an MFA/OTP code to a checkout task that is waiting for it |
| `search_products` | Discover products by name across merchants |
| `get_product_details` | Retrieve detailed info, variants, and pricing for a product URL |
| `get_checkout_estimates` | Compute pre-checkout shipping and tax estimates before placing an order |
| `create_payment_session` | Create a hosted payment session URL for the customer to authorize their card |
| `delete_payment_session` | Invalidate a payment session |
| `get_payment_credentials` | Retrieve card credentials for an authorized payment session |
| `create_credential_session` | Create a secure vault URL where the customer stores their merchant login |

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

### Checkout tools

### `create_checkout`

Creates a new async checkout task from product page URLs. CartAI runs the checkout in the background and emits status updates via webhooks. Multi-merchant carts are split into one task per merchant.

**Required inputs:**

| Field | Type | Description |
|-------|------|-------------|
| `customer` | `object` | Customer contact, addresses, shipping method, and payment — see [Customer object](#customer-object) |
| `tasks[].url` | `string` (URI) | Full product page URL |
| `tasks[].quantity` | `integer` | Units to purchase (min 1) |

**Optional inputs:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tasks[].selectedVariant.color` | `string` | — | Variant color |
| `tasks[].selectedVariant.size` | `string` | — | Variant size |
| `options` | `object` | — | Checkout behaviour flags — see [Checkout options](#checkout-options) |
| `addons.couponCode` | `string[]` | — | Coupon / promo codes to apply, e.g. `["SUMMER15"]` |

**Returns:** a `groupId` and a `tasks[]` list — one entry per merchant with `taskId`, `executionId`, `merchant`, initial `status` (`queued`), and a `liveUrl` to watch the checkout run live.

---

### `create_search_checkout`

Creates an async checkout task from product **names** instead of URLs. Give it the merchant website and a list of item names — the CartAI agent searches the merchant's catalog, resolves each item (and any selected variant), assembles the cart, and completes shipping, payment and order confirmation in one call.

> **When to use:** this is the go-to tool when the user already knows what they want to buy and from which store (e.g. *"order X, Y and Z from Kylie Cosmetics"*). There's no need to call `search_products` first.

**Required inputs:**

| Field | Type | Description |
|-------|------|-------------|
| `customer` | `object` | Same as `create_checkout` — see [Customer object](#customer-object) |
| `merchant` | `string` (URI) | Merchant website URL, e.g. `https://kyliecosmetics.com/` |
| `itemList[].name` | `string` | Product name to search for on the merchant's site |

**Optional inputs:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `itemList[].quantity` | `integer` | `1` | Units to purchase (min 1) |
| `itemList[].selectedVariant` | `object` | — | Free-form key/value pairs using the option names shown on the merchant's site, e.g. `{ "Shade": "candy k" }` or `{ "Color": "Black", "Size": "M" }` |
| `options` | `object` | — | Same as `create_checkout` — see [Checkout options](#checkout-options) |
| `addons.couponCode` | `string[]` | — | Coupon / promo codes to apply |

**Returns:** same shape as `create_checkout` — `groupId` plus `taskId`, `merchant`, `status`, and `liveUrl` per task.

---

#### Customer object

Shared by `create_checkout` and `create_search_checkout`.

| Field | Type | Description |
|-------|------|-------------|
| `customer.contact.firstName` | `string` | — |
| `customer.contact.lastName` | `string` | — |
| `customer.contact.phone` | `string` | Digits, spaces, hyphens, leading `+` (7–20 chars) |
| `customer.contact.email` | `string` | — |
| `customer.shippingAddress.addressLine1` | `string` | — |
| `customer.shippingAddress.addressLine2` | `string` | — |
| `customer.shippingAddress.city` | `string` | — |
| `customer.shippingAddress.province` | `string` | State/province code e.g. `NY` |
| `customer.shippingAddress.postalCode` | `string` | ZIP or postal code |
| `customer.shippingAddress.country` | `string` | Country code e.g. `US` |
| `customer.billingAddress` | `object` | Same shape as `shippingAddress` |
| `customer.shippingMethod.strategy` | `string` | e.g. `"cheapest"` \| `"fastest"` \| `"standard"` |
| `customer.payment.data.sessionId` | `string` | **Agentic payments:** sessionId from `create_payment_session`, after the customer has authorized their card. No `provider` needed. |
| `customer.payment.provider` | `string` | Set to `"test"` to pass raw card details (`cardNumber`, `cvv`, `name`, `expiryMonth`, `expiryYear`) in `data` instead of a `sessionId` |

#### Checkout options

All flags default to `false`.

| Field | Description |
|-------|-------------|
| `options.verifyBeforePlacement` | Agent asks for confirmation just before placing the order |
| `options.useSavedCredentialToLogin` | Agent signs in to the merchant using credentials stored via `create_credential_session` |
| `options.useGuestCheckoutIfLoginFails` | If the stored credentials don't work, fall back to guest checkout when the merchant offers it |
| `options.allowInteraction` | Interactive flow instead of fire-and-forget — the agent can pause and request input (e.g. an OTP via `send_interactive_inputs`) |
| `options.allowPartialCheckout` | If some items fail (e.g. out of stock), still complete checkout for the remaining items |

---

### `get_checkout`

Retrieves the full state of a checkout task.

**Required:** `taskId` — returned by `create_checkout` or `create_search_checkout`.

> Tip: hook this to a CartAI webhook event rather than polling.

**Returns:** current `status`, `merchant`, execution `iterations`, `derivedDetails` (pricing, shipping method, selected shipping option), `addons`, and the original customer and task data.

---

### `cancel_checkout`

Cancels an in-progress checkout task.

**Required:** `taskId`

**Returns:** Confirmation that the checkout task has been stopped and will not proceed further.

---

### `get_status_history`

Returns the full step-by-step event log for a checkout task.

**Required:** `taskId`

**Returns:** a `data[]` list of steps, each with `status` (the checkout step, e.g. `CREDIT_CARD_INPUT`, `ORDER_CONFIRMED`), `systemStatus` (e.g. `IN_PROGRESS`, `FAILED`), `createdAt`, `isFailed`, `note`, `creditsConsumed`, and `retryCount`.

---

### `send_interactive_inputs`

Sends input from the customer to a checkout task that is paused and waiting for it. Only applies to tasks created with `options.allowInteraction: true`. Currently the only supported input is an MFA/OTP code.

**Required inputs:**

| Field | Type | Description |
|-------|------|-------------|
| `taskId` | `string` | ID of the checkout task that is waiting for input |
| `otp` | `string` | The OTP/MFA code, 4–8 characters (surrounding spaces are trimmed) |

**Optional inputs:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `intent` | `string` | `"mfa"` | Type of input being sent. Supported: `mfa` |

**Returns:** confirmation message and the task's updated status (e.g. `mfa_received`).

**Errors:** `400` bad intent / OTP length / extra fields · `403` task belongs to another account or is past the OTP stage · `404` task not found · `409` an OTP was already submitted for this task.

---

### Catalog tools

### `search_products`

Searches for products by name across merchants. Returns ranked results with pricing, images, and purchase links.

> **When to use:** for discovery — browsing, comparing, or exploring products before deciding what to buy. If the user already has a list of products to buy from a specific store, use `create_search_checkout` instead.

**Required inputs:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Product name or search query |

**Optional inputs:**

| Field | Type | Description |
|-------|------|-------------|
| `merchant` | `string` | Merchant name to prioritize results (e.g. `"Macy's"`). Other retailers are still returned. |

**Returns:** Ranked `products[]` each with `name`, `brand`, `merchant`, `image`, `priceFrom`, `currency`, and `directUrl` (use as `url` in `create_checkout` or `get_product_details`). Also returns `targetMerchant` and `targetMatchCount`.

---

### `get_product_details`

Retrieves detailed product information for a given product page URL, including all available variants, pricing, and availability.

**Required inputs:**

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string` (URI) | Full product page URL |

**Optional inputs:**

| Field | Type | Description |
|-------|------|-------------|
| `allVariants` | `boolean` | When `true`, returns all available variants (color, size, etc.) |

**Returns:** Product metadata (`name`, `brand`, `retailer`, `image`, `url`), `directUrl`, `canCheckout` (`login` / `guest` modes the retailer supports), variant `dimensions` (e.g. `["Color", "Size"]`), and a `variants[]` list with per-variant `variantId`, `price`, `available`, `image`, `attributes`, `url`, and `monetizationUrl`.

---

### `get_checkout_estimates`

Computes a pre-checkout cost estimate for a given merchant, destination ZIP, and list of items — before placing an order.

**Required inputs:**

| Field | Type | Description |
|-------|------|-------------|
| `merchant` | `string` | Merchant name to estimate costs for (e.g. `"Alo Yoga"`) |
| `destination.zip` | `string` | Destination ZIP code |
| `items[].url` | `string` (URI) | Product page URL |
| `items[].quantity` | `integer` | Number of units (min 1) |
| `items[].unitPrice` | `number` | Price per unit (e.g. from `get_product_details`) |
| `items[].category` | `string` | Product category, e.g. `"clothing"` |

**Returns:** `subtotal`, `shipping`, `shippingKnown`, `tax`, `taxKnown`, `total`, `currency`, the resolved `destination` (`zip`, `state`, `country`), and a per-item `items[]` breakdown with `lineSubtotal` and `tax`.

---

### Payment tools

### `create_payment_session`

Creates a hosted payment session and returns a secure URL for the customer to authorize their card. The session automatically starts Visa Intelligent Commerce or Mastercard Agent Pay based on the card on file for the customer's email — no additional integration required.

> The tool result includes the session `url` as a clickable markdown link — present it as-is (a clickable "Open" button) rather than rewriting or reformatting it, so the customer can click through to authorize their card.

**Required inputs:**

| Field | Type | Description |
|-------|------|-------------|
| `email` | `string` | Customer's email address |
| `price` | `string` | Payment amount in USD, no currency symbol, e.g. `"700"` |
| `purpose` | `string` | What the payment is for (e.g. agent name or product) — shown to the customer |

**Optional inputs:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `currency` | `string` | `"USD"` | Currency code |
| `expiry` | `string` (ISO 8601) | 1 week from creation | When the session URL stops being valid |
| `merchantUrl` | `string` | — | Website URL of the merchant the payment is for |
| `merchantName` | `string` | — | Display name of the merchant the payment is for |

**Returns:** `sessionId`, a hosted `url` (formatted as a clickable link for the customer), `mode` (`production` / `test`), `created_at`, and the session's `authorization` details (price, currency, purpose, expiry).

---

### `delete_payment_session`

Deletes an existing payment session. Once deleted, the hosted payment URL stops working and payment credentials can no longer be retrieved for the session.

**Required:** `sessionId` — returned by `create_payment_session`.

**Returns:** confirmation message. Returns `404` if the session doesn't exist.

---

### `get_payment_credentials`

Retrieves the payment credentials for a payment session the customer has already authorized through the hosted payment flow.

> ⚠️ The response contains full card details (card number, CVV, expiry). Only use it to complete a purchase and never display it back to the user.

**Required inputs:**

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | `string` | The sessionId returned by `create_payment_session` |

**Optional inputs:**

| Field | Type | Description |
|-------|------|-------------|
| `merchantUrl` | `string` | Website URL of the merchant the credentials will be used on |

**Returns:** `type` (e.g. `"card"`) and `info` with `cardNumber`, `cvv`, `expiryMonth`, and `expiryYear`.

---

### Credential tools

### `create_credential_session`

Creates a credential vault session for a merchant and returns a secure URL where the customer stores their login for that merchant. Checkouts created with `options.useSavedCredentialToLogin: true` then sign in with those credentials.

**Required inputs:**

| Field | Type | Description |
|-------|------|-------------|
| `merchantDomain` | `string` | Merchant website URL the credentials belong to, e.g. `https://saltiebeauty.com` |
| `email` | `string` | Customer's email address |

**Returns:** `iframeUrl` (presented as a clickable link for the customer) and `expiresIn` — session validity in minutes.

---

## Example prompts

Once the server is connected, try these in Claude:

```
I want to buy the Velvet Brew Eau De Parfum Pen Spray, the Face Brush Trio,
and 2 Blush Wood Eau De Parfum from Kylie Cosmetics.
Ship to Carol Sturka, 609 Royal Crest Dr, Richardson TX 75081.
```

```
Show me some high-rise jeans, preferably from Macy's.
```

```
Order 2 units of https://example.com/product/sneakers in size 10, color black,
with coupon SUMMER15. Ship to John Doe, 123 Main St, New York NY 10001.
Use card 4242 4242 4242 4242, CVV 123, exp 12/2034.
```

```
What would shipping and tax be for the Alo Yoga Oasis Tank ($64, clothing) to ZIP 75001?
```

```
Check the status of checkout task abc-123-def.
```

```
The checkout is asking for a code — it's 482913.
```

```
Show me the full status history for task abc-123-def including how many credits were used.
```

```
Create a payment session for customer@example.com to pay $700 for "Carol's Purchase Agent".
```

```
Let me save my Saltie Beauty login so you can sign in when checking out.
```

---

## How it works

CartAI exposes four sets of capabilities: **Catalog** (discover and evaluate products), **Payments** (get the customer's card authorized for agentic use), **Credentials** (securely store merchant logins), and **Checkout** (autonomously place orders).

### Catalog flow

Use the catalog tools to find products and validate details before committing to a purchase:

1. **`search_products`** — search by name across merchants to get a ranked list with pricing and `directUrl` for each result.
2. **`get_product_details`** — pass a `directUrl` to retrieve all variants, stock availability, per-variant pricing, and supported checkout modes.
3. **`get_checkout_estimates`** — compute shipping and tax for a destination ZIP before placing the order.

> Already know what to buy and where? Skip the catalog flow and go straight to **`create_search_checkout`**.

### Payment flow

Before a checkout can charge a customer's real card, the customer has to authorize it once through a hosted payment session:

```
Your App                  CartAI                    Customer
    |                          |                          |
    |— POST /payment/session ——>|                         |
    |<— { sessionId, url } ————|                          |
    |                          |                          |
    |———————————— share the url with the customer ———————>|
    |                          |<——————— opens url ———————|
    |                          |   Adds card, authorizes  |
    |                          |<— Authorization complete —|
```

1. **`create_payment_session`** — pass the customer's `email`, `price`, and `purpose` (plus optional `currency`, `expiry`, `merchantUrl`, `merchantName`). Returns a `sessionId` and a hosted `url`.
2. **Click through the `url` link** — the customer adds their card and authorizes CartAI to transact on it via Visa Intelligent Commerce or Mastercard Agent Pay.
3. **Hold onto the `sessionId`** — once the customer has authorized, pass it into `create_checkout` / `create_search_checkout` as `customer.payment.data.sessionId` (no `provider` needed for this flavour).
4. **Optional:** retrieve the card credentials directly with `get_payment_credentials`, or invalidate the session with `delete_payment_session` when it's no longer needed.

### Saved credentials flow

For merchants where signing in unlocks loyalty pricing or saved details:

1. **`create_credential_session`** — pass the merchant URL and the customer's email. Returns a short-lived vault URL.
2. **The customer opens the URL** and securely stores their login for that merchant.
3. **Create the checkout** with `options.useSavedCredentialToLogin: true` (and optionally `options.useGuestCheckoutIfLoginFails: true` as a fallback).

### Checkout flow

Once you have products (URLs or names), customer details, and either an authorized `sessionId` or test card details, hand off to CartAI:

```
Your App                  CartAI Agent              Merchant Website
    |                          |                          |
    |— POST /checkout ————————>|                          |
    |   or /search-checkout    |                          |
    |<— { groupId, tasks[] } ——|                          |
    |                          |— Navigates site ————————>|
    |                          |  Finds / adds to cart    |
    |                          |  Selects shipping        |
    |                          |  Completes payment       |
    |                          |<— Order confirmed ———————|
    |<— Webhook: COMPLETED ————|                          |
```

1. **Start the checkout** — `create_checkout` with product URLs, or `create_search_checkout` with a merchant URL and product names. Two payment flavours are supported:
   - **Agentic (recommended):** `{ "data": { "sessionId": "<sessionId from create_payment_session>" } }`
   - **Direct card (testing):** `{ "provider": "test", "data": { "cardNumber": "...", "cvv": "...", "name": "...", "expiryMonth": "...", "expiryYear": "..." } }`
2. **Receive a `groupId` and one `taskId` + `liveUrl` per merchant immediately** — the checkout runs asynchronously in the background, and the `liveUrl` lets you watch it live.
3. **The AI agent does the work** — navigating the merchant's live website, finding and selecting the right variant, applying coupons and your shipping strategy, and placing the order.
4. **Respond if asked** — with `options.allowInteraction: true`, the agent can pause for an MFA/OTP code; send it with `send_interactive_inputs`.
5. **Track progress** — use `get_checkout` or `get_status_history` to monitor the task; cancel anytime with `cancel_checkout`.

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
- Check that newly added tools are enabled in the client's tool list for this server.
- Run `node src/index.js` directly in a terminal to check for startup errors.

**HTTP 401 from CartAI**
Your API key is invalid or expired. Regenerate it in the CartAI Admin Portal.

**HTTP 404 on get_checkout / get_status_history**
The `taskId` doesn't exist or belongs to a different account.

**HTTP 409 on send_interactive_inputs**
An OTP has already been submitted for this task — each task accepts only one.

**HTTP 403 on send_interactive_inputs**
The task belongs to a different account, or it has already moved past the stage where it accepts an OTP.

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
