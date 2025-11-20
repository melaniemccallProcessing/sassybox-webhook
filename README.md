# Shopify ↔ ADS/ECN Fulfillment (Dropshipper) & Inventory Automation
Automated Shopify integration built with Node.js that synchronizes orders, shipments, cancellations, and inventory updates with a third-party dropshipper (ECN / AdultShipper).

This system was originally built in 2019 to automate an entire e-commerce pipeline:
- Receive Shopify order webhooks
- Forward orders to ECN via XML API
- Poll ECN for shipment updates
- Auto-fulfill orders in Shopify when shipped
- Process partial shipments (refunds + customer email)
- Fully synchronize inventory from ECN → Shopify every hour
- Send administrative email summaries for monitoring

Despite being written pre-TypeScript/modern tooling, the refactored version maintains the original architecture while improving clarity, safety, and maintainability.

---

## 🔧 **Tech Stack**
- **Node.js** (CommonJS, async/await)
- **Express** – Shopify webhook endpoint
- **Axios / request-promise** – Shopify REST + ECN XML requests
- **xml2js** – XML parsing and transformation
- **Nodemailer** – Automated customer + admin emails
- **Heroku Scheduler** – Cron-style hourly scripts
- **Shopify Admin REST API**
- **ECN XML API** (legacy system)

---

## 📦 **Project Overview**

This project is made up of **three main components**, each responsible for a critical part of the Shopify → ECN/ADS → Shopify loop.

### 1. **Order Webhook Handler** (`server/index.js`)
Receives incoming Shopify orders via webhook:

1. Verifies Shopify HMAC signature
2. Extracts order + shipping data
3. Builds an ECN XML order
4. Sends it to ECN using their legacy XML API
5. Parses XML response
6. Tags the Shopify order with an **ECNORDERID-XXXX** tag for later tracking

This creates the tracing link between Shopify’s order lifecycle and ECN’s fulfillment lifecycle.

---

### 2. **Order Status Worker** (`workers/order-updates.js`)
Runs hourly via Heroku Scheduler.

For each order tagged with `ECNORDERID`:

1. Queries ECN for shipment status
2. Parses XML response
3. Branches into:
   - **Fully shipped → Capture payment + fulfill in Shopify**
   - **Partially shipped → Refund difference + email customer**
   - **Cancelled → Notify admin; avoid fulfillment**
4. Sends a daily digest email summarizing all updates

This replicates a full warehouse workflow *without ever touching the warehouse*.

---

### 3. **Inventory Sync Worker** (`workers/update-datafeed.js`)
Also runs hourly through Heroku Scheduler.

Workflow:

1. Downloads ECN’s master inventory XML feed
2. Parses thousands of product records
3. Compares ECN inventory vs Shopify inventory
4. Branches into:
   - **Update tags + restock existing products**
   - **Create new products if appropriate**
   - **Unpublish/discontinue products ECN removed**
5. Updates Shopify variants’ inventory levels
6. Emails a summary report after each cycle

This turns ECN into a *single source of truth* for product availability across the Shopify storefront.

---

## 🧠 **Architecture Diagram**

                   ┌────────────────────────┐
                   │      Shopify Store      │
                   │ (Customers place orders)│
                   └─────────────┬───────────┘
                                 │ Webhook
                                 ▼
               ┌─────────────────────────────────┐
               │     Order Webhook Handler       │
               │        (server/index.js)        │
               └─────────────┬───────────────────┘
                             │ XML order
                             ▼
                 ┌───────────────────────┐
                 │       ECN API         │
                 │ (Legacy dropshipper)  │
                 └─────────────┬─────────┘
                               │ Hourly status check
                               ▼
                 ┌─────────────────────────────────┐
                 │        Order Status Worker       │
                 │      (workers/order-updates.js)  │
                 └─────────────┬───────────────────┘
                               │ Fulfill / Refund / Email
                               ▼
                   ┌────────────────────────┐
                   │     Shopify Admin      │
                   │ Fulfillment + Refunds  │
                   └────────────────────────┘


         ┌────────────────────────────────────────┐
         │       Inventory Sync Worker             │
         │    (workers/update-datafeed.js)         │
         ├────────────────────────────────────────┤
         │ Hourly: ECN XML feed → Shopify updates │
         └────────────────────────────────────────┘

# Deployment (Heroku Scheduler)
This project used Heroku Scheduler to run the following:
```
worker: node workers/order-updates.js
worker: node workers/update-datafeed.js
```

# Local Development
This project was created for a client with their store credentials, so unfortunately I haven't tried to simulate the webhooks or ECN updates because I don't have access to them anymore. This project will be a base of operations for creating future fulfillment services that communicate with Shopify PLUS stores.