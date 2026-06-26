#!/usr/bin/env node
/**
 * CartAI MCP Server
 *
 * Implements 4 tools backed by the CartAI Checkout APIs:
 *
 *  Tool                 Method  URL
 *  ─────────────────────────────────────────────────────────────────────
 *  create_checkout        POST    https://api.cartai.ai/checkout
 *  get_checkout           GET     https://api.cartai.ai/checkout/{taskId}
 *  cancel_checkout        DELETE  https://api.cartai.ai/checkout/{taskId}
 *  get_status_history     GET     https://api.cartai.ai/checkout/{taskId}/status-history
 *  search_products        POST    https://api.cartai.ai/product/search
 *  get_product_details    POST    https://api.cartai.ai/product/details
 *  get_checkout_estimates POST    https://api.cartai.ai/checkout-estimates
 *
 * Auth: x-api-key header — set CARTAI_API_KEY env var before starting.
 *
 * Usage (stdio transport for Claude Desktop / any MCP host):
 *   CARTAI_API_KEY=<your-key> node src/index.js
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE_URL = "https://api.cartai.ai";
const API_KEY      = process.env.CARTAI_API_KEY ?? "";

if (!API_KEY) {
  process.stderr.write(
    "[cartai-mcp] WARNING: CARTAI_API_KEY env var is not set. " +
    "All API calls will be rejected.\n"
  );
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

async function cartaiRequest(method, url, body = null) {
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": API_KEY,
  };

  const init = { method, headers };
  if (body !== null) init.body = JSON.stringify(body);

  const res = await fetch(url, init);

  let data;
  try {
    data = await res.json();
  } catch {
    data = { raw: await res.text() };
  }

  return { ok: res.ok, status: res.status, data };
}

// ─── Tool definitions (JSON Schema) ──────────────────────────────────────────

const TOOLS = [

  // 1. CREATE CHECKOUT TASK
  // POST https://sandbox.api.cartai.ai/checkout
  {
    name: "create_checkout",
    description:
      "Creates a new CartAI checkout task. This is an async API — the checkout " +
      "executes in the background and emits status updates via webhooks. " +
      "Supports single-SKU, multi-SKU, and multi-merchant orders. " +
      "Returns a taskId to track progress with get_checkout or get_status_history.",
    inputSchema: {
      type: "object",
      required: ["customer", "tasks"],
      properties: {

        customer: {
          type: "object",
          description: "All customer information for the checkout",
          properties: {

            contact: {
              type: "object",
              description: "Customer contact details",
              properties: {
                firstName: { type: "string", description: "First name" },
                lastName:  { type: "string", description: "Last name" },
                phone: {
                  type: "string",
                  pattern: "^[+0-9\\- ]{7,20}$",
                  description: "Phone number — digits, spaces, hyphens, leading +"
                },
                email: { type: "string", format: "email", description: "Email address" }
              }
            },

            shippingAddress: {
              type: "object",
              description: "Delivery address",
              properties: {
                addressLine1: { type: "string" },
                addressLine2: { type: "string" },
                city:         { type: "string" },
                province:     { type: "string", description: "State/province code e.g. NY" },
                postalCode: {
                  type: "string",
                  pattern: "^[A-Za-z0-9\\- ]{3,10}$",
                  description: "ZIP or postal code"
                },
                country: { type: "string", description: "Country code e.g. US" }
              }
            },

            billingAddress: {
              type: "object",
              description: "Billing address (same shape as shippingAddress)",
              properties: {
                addressLine1: { type: "string" },
                addressLine2: { type: "string" },
                city:         { type: "string" },
                province:     { type: "string" },
                postalCode:   { type: "string", pattern: "^[A-Za-z0-9\\- ]{3,10}$" },
                country:      { type: "string" }
              }
            },

            shippingMethod: {
              type: "object",
              description: "Preferred shipping strategy",
              properties: {
                strategy: {
                  type: "string",
                  description: "e.g. 'cheapest' | 'fastest' | 'standard'"
                }
              }
            },

            payment: {
              type: "object",
              description: "Payment configuration",
              properties: {
                provider: {
                  type: "string",
                  description: "Payment provider — use 'test' for testing"
                },
                data: {
                  type: "object",
                  description: "Card details",
                  properties: {
                    cardNumber:   { type: "string", description: "Card number e.g. '4242424242424242'" },
                    cvv:          { type: "string", description: "Card CVV" },
                    name:         { type: "string", description: "Cardholder name" },
                    expiryMonth:  { type: "string", description: "Expiry month e.g. '12'" },
                    expiryYear:   { type: "string", description: "Expiry year e.g. '2034'" }
                  }
                }
              }
            }
          }
        },

        tasks: {
          type: "array",
          description: "One or more products to checkout. Each item maps to a product URL.",
          items: {
            type: "object",
            required: ["url", "quantity"],
            properties: {
              url: {
                type: "string",
                format: "uri",
                description: "Full product page URL"
              },
              quantity: {
                type: "integer",
                minimum: 1,
                description: "Number of units to purchase"
              },
              selectedVariant: {
                type: "object",
                description: "Specific variant to select (color, size, etc.)",
                properties: {
                  color: { type: "string" },
                  size:  { type: "string" }
                }
              },
              metadata: {
                type: "object",
                description: "Optional display metadata (title, image, price) — not used for checkout logic",
                properties: {
                  title:        { type: "string" },
                  description:  { type: "string" },
                  primaryImage: { type: "string" },
                  price:        { type: "number" }
                }
              }
            }
          }
        },

        options: {
          type: "object",
          description: "Checkout behaviour flags",
          properties: {
            verifyBeforePlacement: {
              type: "boolean",
              description:
                "When true, CartAI pauses for customer confirmation (PENDING_CONFIRMATION) " +
                "before placing the order. Default: false."
            },
            failTaskIfNotConfirmed: {
              type: "boolean",
              description: "Fail the task if customer confirmation is not received. Default: false."
            },
            allowPartialCheckoutForMultiSku: {
              type: "boolean",
              description:
                "For multi-SKU carts, allow checkout to succeed partially " +
                "if one item fails. Default: true."
            }
          }
        }
      }
    }
  },

  // 2. GET CHECKOUT TASK
  // GET https://api.cartai.ai/checkout/{taskId}
  {
    name: "get_checkout",
    description:
      "Retrieves the current state of a CartAI checkout task by taskId. " +
      "Best called on a webhook event; polling is possible but not recommended. " +
      "Returns status, customer info, tasks, and derivedDetails (pricing, shipping).",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: {
        taskId: {
          type: "string",
          description: "The taskId returned by create_checkout"
        }
      }
    }
  },

  // 3. CANCEL CHECKOUT TASK
  // DELETE https://api.cartai.ai/checkout/{taskId}
  {
    name: "cancel_checkout",
    description:
      "Cancels an in-progress CartAI checkout task. " +
      "Stops all ongoing checkout processes and prevents further execution. " +
      "Requires only the taskId.",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: {
        taskId: {
          type: "string",
          description: "The ID of the checkout task to cancel"
        }
      }
    }
  },

  // 4. GET STATUS HISTORY
  // GET https://api.cartai.ai/checkout/{taskId}/status-history
  {
    name: "get_status_history",
    description:
      "Retrieves the complete status history for a checkout task — all execution steps, " +
      "their statuses, timestamps, and credits consumed. " +
      "Lifecycle: QUEUED → STARTED → IN-PROGRESS → PENDING_CONFIRMATION → " +
      "CONFIRMED → PLACED → COMPLETED (or CANCELLED / FAILED).",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: {
        taskId: {
          type: "string",
          description: "The ID of the checkout task"
        }
      }
    }
  },

  // 5. SEARCH PRODUCTS
  // POST https://api.cartai.ai/product/search
  {
    name: "search_products",
    description:
      "Searches for products by name across merchants. " +
      "Returns ranked results with pricing, images, and purchase links. " +
      "Optionally narrow results to a specific merchant while still returning others.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: {
          type: "string",
          description: "Product name or search query"
        },
        merchant: {
          type: "string",
          description: "Optional merchant name to prioritize results (e.g. 'amazon', 'walmart')"
        }
      }
    }
  },

  // 6. GET PRODUCT DETAILS
  // POST https://api.cartai.ai/product/details
  {
    name: "get_product_details",
    description:
      "Retrieves detailed product information for a given product page URL. " +
      "Returns metadata, available variants, pricing, availability, and images.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: {
          type: "string",
          format: "uri",
          description: "Full product page URL to fetch details for"
        },
        allVariants: {
          type: "boolean",
          description: "When true, returns all available variants. Defaults to true."
        }
      }
    }
  },

  // 7. GET CHECKOUT ESTIMATES
  // POST https://api.cartai.ai/checkout-estimates
  {
    name: "get_checkout_estimates",
    description:
      "Computes a pre-checkout cost estimate for a given merchant, destination, and list of items. " +
      "Returns subtotal, shipping cost, tax, and total amounts before placing an order.",
    inputSchema: {
      type: "object",
      required: ["merchant", "destination", "items"],
      properties: {
        merchant: {
          type: "string",
          description: "Name of the merchant to estimate costs for (e.g. 'amazon')"
        },
        destination: {
          type: "object",
          description: "Delivery destination for shipping and tax calculation",
          properties: {
            addressLine1: { type: "string" },
            addressLine2: { type: "string" },
            city:         { type: "string" },
            province:     { type: "string", description: "State/province code e.g. NY" },
            postalCode:   { type: "string", description: "ZIP or postal code" },
            country:      { type: "string", description: "Country code e.g. US" }
          }
        },
        items: {
          type: "array",
          description: "List of items to estimate costs for",
          items: {
            type: "object",
            required: ["url", "quantity"],
            properties: {
              url: {
                type: "string",
                format: "uri",
                description: "Full product page URL"
              },
              quantity: {
                type: "integer",
                minimum: 1,
                description: "Number of units"
              },
              selectedVariant: {
                type: "object",
                description: "Specific variant (color, size, etc.)",
                properties: {
                  color: { type: "string" },
                  size:  { type: "string" }
                }
              }
            }
          }
        }
      }
    }
  }

];

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleCreateCheckout(args) {
  const { customer, tasks, options } = args;

  const payload = { customer, tasks };
  if (options !== undefined) payload.options = options;

  const url = `${BASE_URL}/checkout`;
  const result = await cartaiRequest("POST", url, payload);

  if (!result.ok) {
    return errorResult(
      `create_checkout failed — HTTP ${result.status}`,
      result.data
    );
  }

  return {
    content: [{
      type: "text",
      text: [
        `✅ Checkout task created`,
        ``,
        `taskId: ${result.data.taskId}`,
        ``,
        `Track it with get_checkout or get_status_history.`,
        `For real-time updates configure a webhook in the CartAI Admin Portal.`,
        ``,
        `Full response:`,
        JSON.stringify(result.data, null, 2)
      ].join("\n")
    }]
  };
}

async function handleGetCheckout(args) {
  const { taskId } = args;
  const url = `${BASE_URL}/checkout/${encodeURIComponent(taskId)}`;
  const result = await cartaiRequest("GET", url);

  if (!result.ok) {
    return errorResult(
      `get_checkout failed — HTTP ${result.status}`,
      result.data
    );
  }

  const task = result.data;
  return {
    content: [{
      type: "text",
      text: [
        `Checkout Task: ${taskId}`,
        `Status:   ${task.status ?? "—"}`,
        `Merchant: ${task.merchant ?? "—"}`,
        `Created:  ${task.createdAt ?? "—"}`,
        ``,
        `Full response:`,
        JSON.stringify(task, null, 2)
      ].join("\n")
    }]
  };
}

async function handleCancelCheckout(args) {
  const { taskId } = args;
  const url = `${BASE_URL}/checkout/${encodeURIComponent(taskId)}`;
  const result = await cartaiRequest("DELETE", url);

  if (!result.ok) {
    return errorResult(
      `cancel_checkout failed — HTTP ${result.status}`,
      result.data
    );
  }

  return {
    content: [{
      type: "text",
      text: [
        `Checkout task cancelled`,
        `taskId: ${taskId}`,
        ``,
        `Full response:`,
        JSON.stringify(result.data, null, 2)
      ].join("\n")
    }]
  };
}

async function handleGetStatusHistory(args) {
  const { taskId } = args;
  const url = `${BASE_URL}/checkout/${encodeURIComponent(taskId)}/status-history`;
  const result = await cartaiRequest("GET", url);

  if (!result.ok) {
    return errorResult(
      `get_status_history failed — HTTP ${result.status}`,
      result.data
    );
  }

  // Normalise — could be an array or { history: [...] }
  const entries = Array.isArray(result.data)
    ? result.data
    : (result.data.history ?? []);

  const timeline = entries.length
    ? entries.map((e, i) =>
        `${String(i + 1).padStart(2)}. ${e.status} — ${e.timestamp ?? e.createdAt ?? "—"}` +
        (e.creditsConsumed !== undefined ? `  (credits: ${e.creditsConsumed})` : "") +
        (e.message ? `\n      ${e.message}` : "")
      ).join("\n")
    : "  (no history entries)";

  return {
    content: [{
      type: "text",
      text: [
        `Status History for taskId: ${taskId}`,
        ``,
        timeline,
        ``,
        `Full response:`,
        JSON.stringify(result.data, null, 2)
      ].join("\n")
    }]
  };
}

async function handleSearchProducts(args) {
  const { name, merchant } = args;
  const payload = { name };
  if (merchant !== undefined) payload.merchant = merchant;

  const url = `${BASE_URL}/product/search`;
  const result = await cartaiRequest("POST", url, payload);

  if (!result.ok) {
    return errorResult(
      `search_products failed — HTTP ${result.status}`,
      result.data
    );
  }

  return {
    content: [{
      type: "text",
      text: [
        `Search results for: "${name}"`,
        merchant ? `Merchant filter: ${merchant}` : "",
        ``,
        `Full response:`,
        JSON.stringify(result.data, null, 2)
      ].filter(l => l !== "").join("\n")
    }]
  };
}

async function handleGetProductDetails(args) {
  const { url: productUrl, allVariants } = args;
  const payload = { url: productUrl };
  if (allVariants !== undefined) payload.allVariants = allVariants;

  const url = `${BASE_URL}/product/details`;
  const result = await cartaiRequest("POST", url, payload);

  if (!result.ok) {
    return errorResult(
      `get_product_details failed — HTTP ${result.status}`,
      result.data
    );
  }

  return {
    content: [{
      type: "text",
      text: [
        `Product Details`,
        `URL: ${productUrl}`,
        ``,
        `Full response:`,
        JSON.stringify(result.data, null, 2)
      ].join("\n")
    }]
  };
}

async function handleGetCheckoutEstimates(args) {
  const { merchant, destination, items } = args;

  const url = `${BASE_URL}/checkout-estimates`;
  const result = await cartaiRequest("POST", url, { merchant, destination, items });

  if (!result.ok) {
    return errorResult(
      `get_checkout_estimates failed — HTTP ${result.status}`,
      result.data
    );
  }

  const d = result.data;
  return {
    content: [{
      type: "text",
      text: [
        `Checkout Estimate for: ${merchant}`,
        ``,
        `Subtotal: ${d.subtotal ?? "—"}`,
        `Shipping: ${d.shipping ?? "—"}`,
        `Tax:      ${d.tax ?? "—"}`,
        `Total:    ${d.total ?? "—"}`,
        ``,
        `Full response:`,
        JSON.stringify(d, null, 2)
      ].join("\n")
    }]
  };
}

// ─── Util ─────────────────────────────────────────────────────────────────────

function errorResult(message, data) {
  return {
    isError: true,
    content: [{
      type: "text",
      text: `${message}\n\n${JSON.stringify(data, null, 2)}`
    }]
  };
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

const HANDLERS = {
  create_checkout:        handleCreateCheckout,
  get_checkout:           handleGetCheckout,
  cancel_checkout:        handleCancelCheckout,
  get_status_history:     handleGetStatusHistory,
  search_products:        handleSearchProducts,
  get_product_details:    handleGetProductDetails,
  get_checkout_estimates: handleGetCheckoutEstimates,
};

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "cartai-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = HANDLERS[name];

  if (!handler) {
    return errorResult(
      `Unknown tool "${name}"`,
      { available: Object.keys(HANDLERS) }
    );
  }

  try {
    return await handler(args ?? {});
  } catch (err) {
    return errorResult(`Unexpected error in ${name}: ${err.message}`, {
      stack: err.stack
    });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[cartai-mcp] Running on stdio ✓\n");
