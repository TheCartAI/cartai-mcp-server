#!/usr/bin/env node
/**
 * CartAI MCP Server
 *
 * Implements 13 tools backed by the CartAI Checkout APIs:
 *
 *  Tool                       Method  URL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  create_checkout            POST    https://api.cartai.ai/checkout
 *  create_search_checkout     POST    https://api.cartai.ai/search-checkout
 *  get_checkout               GET     https://api.cartai.ai/checkout/{taskId}
 *  cancel_checkout            DELETE  https://api.cartai.ai/checkout/{taskId}
 *  get_status_history         GET     https://api.cartai.ai/checkout/{taskId}/status-history
 *  send_interactive_inputs    POST    https://api.cartai.ai/checkout/{taskId}/{intent}
 *  search_products            POST    https://api.cartai.ai/product/search
 *  get_product_details        POST    https://api.cartai.ai/product/details
 *  get_checkout_estimates     POST    https://api.cartai.ai/checkout-estimates
 *  create_payment_session     POST    https://api.cartai.ai/payment/session
 *  delete_payment_session     DELETE  https://api.cartai.ai/payment/session/{sessionId}
 *  get_payment_credentials    POST    https://api.cartai.ai/payment/session/credentials
 *  create_credential_session  POST    https://api.cartai.ai/credentials/session
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

  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { raw };
  }

  return { ok: res.ok, status: res.status, data };
}

// ─── Shared schema fragments ─────────────────────────────────────────────────

const addressSchema = (description) => ({
  type: "object",
  description,
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
});

const CUSTOMER_SCHEMA = {
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

    shippingAddress: addressSchema("Delivery address"),
    billingAddress:  addressSchema("Billing address (same shape as shippingAddress)"),

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
      description:
        "Payment configuration. Two flavours: (1) agentic — omit provider and set " +
        "data.sessionId to the sessionId returned by create_payment_session, once the " +
        "customer has authorized their card via the hosted session url; " +
        "(2) direct card (testing) — set provider to 'test' and pass raw card details in data.",
      properties: {
        provider: {
          type: "string",
          description: "Payment provider — omit when using data.sessionId; use 'test' for direct card testing"
        },
        data: {
          type: "object",
          description: "Either { sessionId } for agentic payments, or raw card details for provider 'test'",
          properties: {
            sessionId:    { type: "string", description: "sessionId from create_payment_session, after the customer has authorized their card" },
            cardNumber:   { type: "string", description: "Card number e.g. '4242424242424242' — used when provider is 'test'" },
            cvv:          { type: "string", description: "Card CVV — used when provider is 'test'" },
            name:         { type: "string", description: "Cardholder name — used when provider is 'test'" },
            expiryMonth:  { type: "string", description: "Expiry month e.g. '12' — used when provider is 'test'" },
            expiryYear:   { type: "string", description: "Expiry year e.g. '2034' — used when provider is 'test'" }
          }
        }
      }
    }
  }
};

const OPTIONS_SCHEMA = {
  type: "object",
  description: "Checkout behaviour flags (all default to false)",
  properties: {
    verifyBeforePlacement: {
      type: "boolean",
      description: "Agent asks for confirmation just before placing the order. Default: false."
    },
    useSavedCredentialToLogin: {
      type: "boolean",
      description:
        "Agent signs in to the merchant using credentials the customer stored via " +
        "create_credential_session. Default: false."
    },
    useGuestCheckoutIfLoginFails: {
      type: "boolean",
      description:
        "If the stored credentials do not work, fall back to guest checkout when the " +
        "merchant offers it. Default: false."
    },
    allowInteraction: {
      type: "boolean",
      description:
        "Enables the interactive flow instead of fire-and-forget — the agent can pause and " +
        "request additional input (e.g. an MFA/OTP code, sent with send_interactive_inputs). Default: false."
    },
    allowPartialCheckout: {
      type: "boolean",
      description:
        "If some items fail (e.g. out of stock), the agent still completes checkout for the " +
        "remaining items. Default: false."
    }
  }
};

const ADDONS_SCHEMA = {
  type: "object",
  description: "Optional extras applied during checkout",
  properties: {
    couponCode: {
      type: "array",
      items: { type: "string" },
      description: "Coupon / promo codes to apply e.g. ['SUMMER15']"
    }
  }
};

// ─── Tool definitions (JSON Schema) ──────────────────────────────────────────

const TOOLS = [

  // 1. CREATE CHECKOUT TASK
  // POST https://api.cartai.ai/checkout
  {
    name: "create_checkout",
    description:
      "Creates a new CartAI checkout task from product page URLs. This is an async API — the " +
      "checkout executes in the background and emits status updates via webhooks. " +
      "Supports single-SKU, multi-SKU, and multi-merchant orders (one task per merchant). " +
      "Returns a groupId plus one taskId and liveUrl per merchant task; track each with " +
      "get_checkout or get_status_history. " +
      "For agentic payments, first call create_payment_session and have the customer " +
      "authorize their card via the returned url, then pass the resulting sessionId as " +
      "customer.payment.data.sessionId (no provider needed in this case).",
    inputSchema: {
      type: "object",
      required: ["customer", "tasks"],
      properties: {
        customer: CUSTOMER_SCHEMA,
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
              }
            }
          }
        },
        options: OPTIONS_SCHEMA,
        addons:  ADDONS_SCHEMA
      }
    }
  },

  // 2. CREATE SEARCH CHECKOUT TASK
  // POST https://api.cartai.ai/search-checkout
  {
    name: "create_search_checkout",
    description:
      "PRIMARY TOOL FOR BUYING NAMED PRODUCTS FROM A SPECIFIC STORE. Use this whenever the user " +
      "wants to purchase / order one or more products by name from a named merchant — e.g. " +
      "'buy X, Y and Z from Kylie Cosmetics' or a shopping list for one store. Call it directly: " +
      "do NOT call search_products or get_product_details first — this tool does the product " +
      "search on the merchant's site itself. " +
      "If the user gives only a store name, infer its website URL for `merchant` yourself " +
      "(e.g. 'kylie cosmetics' → 'https://kyliecosmetics.com/'). If customer contact, address, " +
      "or payment details are missing, ask the user for them (or use create_payment_session " +
      "for payment) rather than searching for products. " +
      "Creates an async checkout task from product NAMES instead of product URLs — the agent " +
      "searches the merchant's catalog, resolves each item (and any selected variant), assembles " +
      "the cart, and completes shipping, payment and order confirmation in one call. " +
      "Returns a groupId plus taskId and liveUrl per task; track with get_checkout or " +
      "get_status_history. Payment works the same as create_checkout (sessionId from " +
      "create_payment_session, or provider 'test' with card details).",
    inputSchema: {
      type: "object",
      required: ["customer", "merchant", "itemList"],
      properties: {
        customer: CUSTOMER_SCHEMA,
        merchant: {
          type: "string",
          format: "uri",
          description: "Merchant website URL to search and check out from e.g. 'https://kyliecosmetics.com/'"
        },
        itemList: {
          type: "array",
          description: "Items to find on the merchant's site and purchase",
          items: {
            type: "object",
            required: ["name"],
            properties: {
              name: {
                type: "string",
                description: "Product name to search for on the merchant's site"
              },
              quantity: {
                type: "integer",
                minimum: 1,
                description: "Number of units to purchase. Default: 1"
              },
              selectedVariant: {
                type: "object",
                description:
                  "Variant options as key/value pairs, using the option names shown on the " +
                  "merchant's site e.g. { \"Shade\": \"candy k\" } or { \"Color\": \"Black\", \"Size\": \"M\" }",
                additionalProperties: { type: "string" }
              }
            }
          }
        },
        options: OPTIONS_SCHEMA,
        addons:  ADDONS_SCHEMA
      }
    }
  },

  // 3. GET CHECKOUT TASK
  // GET https://api.cartai.ai/checkout/{taskId}
  {
    name: "get_checkout",
    description:
      "Retrieves the full state of a CartAI checkout task by taskId — current status, " +
      "execution iterations, derivedDetails (pricing, shipping), addons, and the original " +
      "customer and product data. Best called on a webhook event; polling is possible but not recommended.",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: {
        taskId: {
          type: "string",
          description: "A taskId returned by create_checkout or create_search_checkout"
        }
      }
    }
  },

  // 4. CANCEL CHECKOUT TASK
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

  // 5. GET STATUS HISTORY
  // GET https://api.cartai.ai/checkout/{taskId}/status-history
  {
    name: "get_status_history",
    description:
      "Retrieves the complete status history for a checkout task — every execution step " +
      "(e.g. CREDIT_CARD_INPUT, ORDER_CONFIRMED) with its systemStatus (e.g. IN_PROGRESS, FAILED), " +
      "timestamp, failure flag, note, credits consumed, and retry count.",
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

  // 6. SEND INTERACTIVE INPUTS
  // POST https://api.cartai.ai/checkout/{taskId}/{intent}
  {
    name: "send_interactive_inputs",
    description:
      "Sends input from the customer to a checkout task that is paused and waiting for it " +
      "(only for tasks created with options.allowInteraction = true). Currently the only " +
      "supported input is an MFA/OTP code (intent 'mfa'). Ask the customer for the code they " +
      "received, then submit it here. An OTP can only be submitted once per task.",
    inputSchema: {
      type: "object",
      required: ["taskId", "otp"],
      properties: {
        taskId: {
          type: "string",
          description: "ID of the checkout task that is waiting for input"
        },
        intent: {
          type: "string",
          enum: ["mfa"],
          description: "Type of input being sent. Supported: 'mfa'. Default: 'mfa'"
        },
        otp: {
          type: "string",
          minLength: 4,
          maxLength: 8,
          description: "The OTP/MFA code, 4–8 characters"
        }
      }
    }
  },

  // 7. SEARCH PRODUCTS
  // POST https://api.cartai.ai/product/search
  {
    name: "search_products",
    description:
      "PRODUCT DISCOVERY ONLY — for when the user is browsing, comparing, or exploring products " +
      "and has not yet decided exactly what to buy. NOT for purchasing: if the user wants to " +
      "buy / order named products from a specific merchant, do NOT call this tool — call " +
      "create_search_checkout directly instead. " +
      "Searches for products by name across merchants and returns ranked results each with " +
      "name, brand, merchant, image, priceFrom, currency, and directUrl. Optionally narrow " +
      "results to a specific merchant while still returning others. If the user later decides " +
      "to order a result, pass its directUrl to create_checkout (or to get_product_details for " +
      "variants).",
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
          description: "Optional merchant name to prioritize results (e.g. 'amazon', \"Macy's\")"
        }
      }
    }
  },

  // 8. GET PRODUCT DETAILS
  // POST https://api.cartai.ai/product/details
  {
    name: "get_product_details",
    description:
      "Retrieves detailed product information for a given product page URL. " +
      "Returns product metadata, supported checkout modes (canCheckout: login / guest), " +
      "variant dimension names (e.g. Color, Size), and per-variant price, availability, image, " +
      "attributes, and monetizationUrl.",
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
          description: "When true, returns all available variants for the product"
        }
      }
    }
  },

  // 9. GET CHECKOUT ESTIMATES
  // POST https://api.cartai.ai/checkout-estimates
  {
    name: "get_checkout_estimates",
    description:
      "Computes a pre-checkout cost estimate for a given merchant, destination ZIP, and list of items. " +
      "Returns subtotal, shipping, tax, and total (with shippingKnown / taxKnown flags) before placing an order. " +
      "unitPrice can be taken from get_product_details or search_products.",
    inputSchema: {
      type: "object",
      required: ["merchant", "destination", "items"],
      properties: {
        merchant: {
          type: "string",
          description: "Name of the merchant to estimate costs for (e.g. 'Alo Yoga')"
        },
        destination: {
          type: "object",
          description: "Delivery destination for shipping and tax calculation",
          required: ["zip"],
          properties: {
            zip: { type: "string", description: "Destination ZIP code" }
          }
        },
        items: {
          type: "array",
          description: "List of items to estimate costs for",
          items: {
            type: "object",
            required: ["url", "quantity", "unitPrice", "category"],
            properties: {
              url: {
                type: "string",
                format: "uri",
                description: "Product page URL"
              },
              quantity: {
                type: "integer",
                minimum: 1,
                description: "Number of units"
              },
              unitPrice: {
                type: "number",
                description: "Price per unit"
              },
              category: {
                type: "string",
                description: "Product category (e.g. 'clothing')"
              }
            }
          }
        }
      }
    }
  },

  // 10. CREATE PAYMENT SESSION
  // POST https://api.cartai.ai/payment/session
  {
    name: "create_payment_session",
    description:
      "Creates a hosted payment session and returns a secure URL for the customer to " +
      "authorize their card. The session automatically initiates Visa Intelligent Commerce " +
      "or Mastercard Agent Pay based on the customer's card on file — no additional " +
      "integration required. REQUIRED FOLLOW-UP — every single time, with no exceptions: " +
      "immediately return the url received in the response " +
      "and present it, so the customer gets a clickable 'Open' button. Do this automatically " +
      "without asking the user first, and do not just print or return the raw url as text.",
    inputSchema: {
      type: "object",
      required: ["email", "price", "purpose"],
      properties: {
        email: {
          type: "string",
          format: "email",
          description: "Customer's email address — used to identify the customer and look up their card"
        },
        price: {
          type: "string",
          description: "Payment amount in USD, as a string with no currency symbol e.g. '700'"
        },
        purpose: {
          type: "string",
          description: "Short description of what the payment is for (e.g. agent name or product), shown to the customer during the payment flow"
        },
        currency: {
          type: "string",
          description: "Currency code. Default: 'USD'"
        },
        expiry: {
          type: "string",
          format: "date-time",
          description: "ISO 8601 timestamp after which the session URL is no longer valid. Default: 1 week from creation"
        },
        merchantUrl: {
          type: "string",
          description: "Optional website URL of the merchant the payment is for"
        },
        merchantName: {
          type: "string",
          description: "Optional display name of the merchant the payment is for"
        }
      }
    }
  },

  // 11. DELETE PAYMENT SESSION
  // DELETE https://api.cartai.ai/payment/session/{sessionId}
  {
    name: "delete_payment_session",
    description:
      "Deletes an existing payment session. Once deleted, the hosted payment URL stops working " +
      "and payment credentials can no longer be retrieved for the session.",
    inputSchema: {
      type: "object",
      required: ["sessionId"],
      properties: {
        sessionId: {
          type: "string",
          description: "The sessionId returned by create_payment_session"
        }
      }
    }
  },

  // 12. GET PAYMENT CREDENTIALS
  // POST https://api.cartai.ai/payment/session/credentials
  {
    name: "get_payment_credentials",
    description:
      "Retrieves the payment credentials (card number, CVV, expiry) for a payment session the " +
      "customer has already authorized through the hosted payment flow. Optionally pass the " +
      "merchant URL to get credentials scoped to a specific merchant. The response contains " +
      "sensitive card data — use it only to complete the purchase and never display it back to the user.",
    inputSchema: {
      type: "object",
      required: ["sessionId"],
      properties: {
        sessionId: {
          type: "string",
          description: "The sessionId returned by create_payment_session"
        },
        merchantUrl: {
          type: "string",
          description: "Optional website URL of the merchant the credentials will be used on"
        }
      }
    }
  },

  // 13. CREATE CREDENTIAL VAULT SESSION
  // POST https://api.cartai.ai/credentials/session
  {
    name: "create_credential_session",
    description:
      "Creates a credential vault session for a merchant and returns a secure URL where the " +
      "customer can store their login credentials for that merchant. Stored credentials are " +
      "used by checkouts created with options.useSavedCredentialToLogin = true. The URL is " +
      "valid for a limited time (expiresIn, in minutes). REQUIRED FOLLOW-UP: immediately present " +
      "the returned url as a clickable link so the customer can open it.",
    inputSchema: {
      type: "object",
      required: ["merchantDomain", "email"],
      properties: {
        merchantDomain: {
          type: "string",
          description: "Merchant website URL the credentials belong to e.g. 'https://saltiebeauty.com'"
        },
        email: {
          type: "string",
          format: "email",
          description: "Customer's email address"
        }
      }
    }
  }

];

// ─── Handlers ─────────────────────────────────────────────────────────────────

function formatCheckoutSubmitted(data) {
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const taskLines = tasks.length
    ? tasks.map((t, i) => [
        `${i + 1}. taskId:   ${t.taskId ?? "—"}`,
        `   merchant: ${t.merchant ?? "—"}`,
        `   status:   ${t.status ?? "—"}`,
        t.liveUrl ? `   [Watch live](${t.liveUrl})` : null
      ].filter(Boolean).join("\n")).join("\n")
    : "  (no tasks returned)";

  return [
    `✅ ${data.message ?? "Checkout tasks submitted"}`,
    ``,
    `groupId: ${data.groupId ?? "—"}`,
    ``,
    `Tasks:`,
    taskLines,
    ``,
    `Track each task with get_checkout or get_status_history.`,
    `For real-time updates configure a webhook in the CartAI Admin Portal.`,
    ``,
    `Full response:`,
    JSON.stringify(data, null, 2)
  ].join("\n");
}

async function handleCreateCheckout(args) {
  const { customer, tasks, options, addons } = args;

  const payload = { customer, tasks };
  if (options !== undefined) payload.options = options;
  if (addons !== undefined) payload.addons = addons;

  const result = await cartaiRequest("POST", `${BASE_URL}/checkout`, payload);

  if (!result.ok) {
    return errorResult(`create_checkout failed — HTTP ${result.status}`, result.data);
  }

  return { content: [{ type: "text", text: formatCheckoutSubmitted(result.data) }] };
}

async function handleCreateSearchCheckout(args) {
  const { customer, merchant, itemList, options, addons } = args;

  const payload = { customer, merchant, itemList };
  if (options !== undefined) payload.options = options;
  if (addons !== undefined) payload.addons = addons;

  const result = await cartaiRequest("POST", `${BASE_URL}/search-checkout`, payload);

  if (!result.ok) {
    return errorResult(`create_search_checkout failed — HTTP ${result.status}`, result.data);
  }

  return { content: [{ type: "text", text: formatCheckoutSubmitted(result.data) }] };
}

async function handleGetCheckout(args) {
  const { taskId } = args;
  const url = `${BASE_URL}/checkout/${encodeURIComponent(taskId)}`;
  const result = await cartaiRequest("GET", url);

  if (!result.ok) {
    return errorResult(`get_checkout failed — HTTP ${result.status}`, result.data);
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
    return errorResult(`cancel_checkout failed — HTTP ${result.status}`, result.data);
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
    return errorResult(`get_status_history failed — HTTP ${result.status}`, result.data);
  }

  const entries = Array.isArray(result.data?.data)
    ? result.data.data
    : (Array.isArray(result.data) ? result.data : []);

  const timeline = entries.length
    ? entries.map((e, i) =>
        `${String(i + 1).padStart(2)}. ${e.status ?? "—"}` +
        (e.systemStatus ? ` [${e.systemStatus}]` : "") +
        ` — ${e.createdAt ?? "—"}` +
        (e.isFailed ? "  ❌ failed" : "") +
        (e.creditsConsumed !== undefined && e.creditsConsumed !== null ? `  (credits: ${e.creditsConsumed})` : "") +
        (e.retryCount !== undefined && e.retryCount !== null ? `  (retry: ${e.retryCount})` : "") +
        (e.note ? `\n      ${e.note}` : "")
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

async function handleSendInteractiveInputs(args) {
  const { taskId, intent = "mfa", otp } = args;

  const url = `${BASE_URL}/checkout/${encodeURIComponent(taskId)}/${encodeURIComponent(intent)}`;
  const result = await cartaiRequest("POST", url, { otp: String(otp ?? "").trim() });

  if (!result.ok) {
    const hints = {
      400: "intent isn't supported, otp is missing or the wrong length, or the body has extra fields",
      403: "the task doesn't belong to this API key, or it is past the stage where it accepts an OTP",
      404: "the task wasn't found",
      409: "an OTP was already submitted for this task"
    };
    const hint = hints[result.status] ? ` (${hints[result.status]})` : "";
    return errorResult(`send_interactive_inputs failed — HTTP ${result.status}${hint}`, result.data);
  }

  return {
    content: [{
      type: "text",
      text: [
        `✅ ${result.data.message ?? "Input submitted"}`,
        `taskId: ${taskId}`,
        `intent: ${intent}`,
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

  const result = await cartaiRequest("POST", `${BASE_URL}/product/search`, payload);

  if (!result.ok) {
    return errorResult(`search_products failed — HTTP ${result.status}`, result.data);
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

  const result = await cartaiRequest("POST", `${BASE_URL}/product/details`, payload);

  if (!result.ok) {
    return errorResult(`get_product_details failed — HTTP ${result.status}`, result.data);
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

  const result = await cartaiRequest("POST", `${BASE_URL}/checkout-estimates`, {
    merchant, destination, items
  });

  if (!result.ok) {
    return errorResult(`get_checkout_estimates failed — HTTP ${result.status}`, result.data);
  }

  const d = result.data?.data ?? {};
  const cur = d.currency ? ` ${d.currency}` : "";
  const unknown = (known) => (known === false ? "  (not determined)" : "");

  return {
    content: [{
      type: "text",
      text: [
        `Checkout Estimate for: ${d.merchant ?? merchant}`,
        ``,
        `Subtotal: ${d.subtotal ?? "—"}${cur}`,
        `Shipping: ${d.shipping ?? "—"}${cur}${unknown(d.shippingKnown)}`,
        `Tax:      ${d.tax ?? "—"}${cur}${unknown(d.taxKnown)}`,
        `Total:    ${d.total ?? "—"}${cur}`,
        ``,
        `Full response:`,
        JSON.stringify(result.data, null, 2)
      ].join("\n")
    }]
  };
}

async function handleCreatePaymentSession(args) {
  const { email, price, purpose, currency, expiry, merchantUrl, merchantName } = args;

  const payload = { email, price, purpose };
  if (currency !== undefined) payload.currency = currency;
  if (expiry !== undefined) payload.expiry = expiry;
  if (merchantUrl !== undefined) payload.merchantUrl = merchantUrl;
  if (merchantName !== undefined) payload.merchantName = merchantName;

  const result = await cartaiRequest("POST", `${BASE_URL}/payment/session`, payload);

  if (!result.ok) {
    return errorResult(`create_payment_session failed — HTTP ${result.status}`, result.data);
  }

  const data = result.data.data ?? {};
  return {
    content: [{
      type: "text",
      text: [
        `✅ Payment session created`,
        ``,
        `sessionId: ${data.sessionId}`,
        `mode:      ${data.mode ?? "—"}`,
        `expiry:    ${data.authorization?.expiry ?? "—"}`,
        ``,
        `[Open payment session](${data.url})`,
        ``,
        `Present the link above as-is so the customer can click it to authorize their card.`,
        `Once authorized, pass this sessionId into create_checkout / create_search_checkout as customer.payment.data.sessionId (no provider needed).`,
        ``,
        `Full response:`,
        JSON.stringify(result.data, null, 2)
      ].join("\n")
    }]
  };
}

async function handleDeletePaymentSession(args) {
  const { sessionId } = args;
  const url = `${BASE_URL}/payment/session/${encodeURIComponent(sessionId)}`;
  const result = await cartaiRequest("DELETE", url);

  if (!result.ok) {
    const hint = result.status === 404 ? " (payment session not found)" : "";
    return errorResult(`delete_payment_session failed — HTTP ${result.status}${hint}`, result.data);
  }

  return {
    content: [{
      type: "text",
      text: [
        `Payment session deleted`,
        `sessionId: ${sessionId}`,
        ``,
        `Full response:`,
        JSON.stringify(result.data, null, 2)
      ].join("\n")
    }]
  };
}

async function handleGetPaymentCredentials(args) {
  const { sessionId, merchantUrl } = args;
  const payload = { sessionId };
  if (merchantUrl !== undefined) payload.merchantUrl = merchantUrl;

  const result = await cartaiRequest("POST", `${BASE_URL}/payment/session/credentials`, payload);

  if (!result.ok) {
    return errorResult(`get_payment_credentials failed — HTTP ${result.status}`, result.data);
  }

  return {
    content: [{
      type: "text",
      text: [
        `✅ Payment credentials retrieved`,
        `sessionId: ${sessionId}`,
        ``,
        `Sensitive card data — use only to complete the purchase; do not display it to the user.`,
        ``,
        `Full response:`,
        JSON.stringify(result.data, null, 2)
      ].join("\n")
    }]
  };
}

async function handleCreateCredentialSession(args) {
  const { merchantDomain, email } = args;

  const result = await cartaiRequest("POST", `${BASE_URL}/credentials/session`, {
    merchantDomain, email
  });

  if (!result.ok) {
    return errorResult(`create_credential_session failed — HTTP ${result.status}`, result.data);
  }

  const data = result.data.data ?? {};
  return {
    content: [{
      type: "text",
      text: [
        `✅ Credential vault session created`,
        ``,
        `merchant:  ${merchantDomain}`,
        `expiresIn: ${data.expiresIn ?? "—"} minutes`,
        ``,
        `[Open credential vault](${data.iframeUrl})`,
        ``,
        `Present the link above as-is so the customer can securely store their login for this merchant.`,
        `Then create the checkout with options.useSavedCredentialToLogin = true.`,
        ``,
        `Full response:`,
        JSON.stringify(result.data, null, 2)
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
  create_checkout:           handleCreateCheckout,
  create_search_checkout:    handleCreateSearchCheckout,
  get_checkout:              handleGetCheckout,
  cancel_checkout:           handleCancelCheckout,
  get_status_history:        handleGetStatusHistory,
  send_interactive_inputs:   handleSendInteractiveInputs,
  search_products:           handleSearchProducts,
  get_product_details:       handleGetProductDetails,
  get_checkout_estimates:    handleGetCheckoutEstimates,
  create_payment_session:    handleCreatePaymentSession,
  delete_payment_session:    handleDeletePaymentSession,
  get_payment_credentials:   handleGetPaymentCredentials,
  create_credential_session: handleCreateCredentialSession,
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
