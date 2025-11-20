// index.js
// Shopify → ECN bridge: receives Shopify order webhooks,
// sends XML order to ECN, and tags the Shopify order with the ECN order id.

const express = require('express');
const getRawBody = require('raw-body');
const crypto = require('crypto');
const axios = require('axios');
const xmlParser = require('xml2js');
const request = require('request');
const nodemailer = require('nodemailer');
const shipping = require('./shipping.js');

const app = express();

// ---------- Configuration (from environment) ----------

// Shopify webhook secret (for HMAC verification)
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;

// Shopify Admin credentials (for REST API calls)
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_PASSWORD = process.env.SHOPIFY_API_PASSWORD;
const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN; // e.g. "try-sassy-box.myshopify.com"
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2020-10';

// ECN / dropshipper config
const ECN_CLIENT_ID = process.env.ECN_CLIENT_ID || '6678';
const ECN_STORE_ID = process.env.ECN_STORE_ID || '791';
const ECN_PASSKEY = process.env.ECN_PASSKEY; // passkey used in ECN URLs
const ECN_BASE_URL = process.env.ECN_BASE_URL || 'http://adultshipper.com/back';

// Email config
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || 'SassyBox Shop';
const MAIL_FROM_ADDRESS = process.env.MAIL_FROM_ADDRESS;
const MAIL_TO_ERRORS = process.env.MAIL_TO_ERRORS; // comma-separated list
const MAIL_SMTP_SERVICE = process.env.MAIL_SMTP_SERVICE || 'outlook';
const MAIL_SMTP_USER = process.env.MAIL_SMTP_USER;
const MAIL_SMTP_PASS = process.env.MAIL_SMTP_PASS;

// Basic sanity check in logs (optional, you can remove)
if (!SHOPIFY_WEBHOOK_SECRET) {
  console.warn('⚠️ SHOPIFY_WEBHOOK_SECRET is not set – webhook verification will fail.');
}
if (!SHOPIFY_API_KEY || !SHOPIFY_API_PASSWORD || !SHOPIFY_SHOP_DOMAIN) {
  console.warn('⚠️ Shopify Admin credentials are not fully configured.');
}
if (!ECN_PASSKEY) {
  console.warn('⚠️ ECN_PASSKEY is not set.');
}
if (!MAIL_FROM_ADDRESS || !MAIL_SMTP_USER || !MAIL_SMTP_PASS || !MAIL_TO_ERRORS) {
  console.warn('⚠️ Email transport is not fully configured.');
}

// ---------- Email Transport ----------

const transporter = nodemailer.createTransport({
  service: MAIL_SMTP_SERVICE,
  auth: {
    user: MAIL_SMTP_USER,
    pass: MAIL_SMTP_PASS,
  },
});

/**
 * Create a fresh error email options object.
 * We avoid mutating a single global mailOptions over time.
 */
function createErrorMailOptions(subjectSuffix, text) {
  return {
    from: {
      name: MAIL_FROM_NAME,
      address: MAIL_FROM_ADDRESS,
    },
    to: MAIL_TO_ERRORS,
    replyTo: MAIL_FROM_ADDRESS,
    subject: `Error with Processing Order #${subjectSuffix || ''}`,
    text: text || '',
  };
}

function sendErrEmail(mailOptions) {
  transporter.sendMail(mailOptions, function (err, info) {
    if (err) {
      console.log('Error sending error email:', err);
    } else {
      console.log('Error email sent:', info.response);
    }
  });
}

// ---------- Helpers ----------

/**
 * Build Shopify REST Admin API URL.
 * Example path: `/products/12345.json?fields=product_type`
 */
function shopifyRestUrl(path) {
  return (
    `https://${SHOPIFY_API_KEY}:${SHOPIFY_API_PASSWORD}` +
    `@${SHOPIFY_SHOP_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}${path}`
  );
}

/**
 * Verify Shopify webhook using HMAC header and raw body buffer.
 */
function verifyShopifyWebhook(hmacHeader, bodyBuffer) {
  if (!SHOPIFY_WEBHOOK_SECRET) return false;

  const generatedHash = crypto
    .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
    .update(bodyBuffer, 'utf8', 'hex')
    .digest('base64');

  return crypto.timingSafeEqual(Buffer.from(generatedHash), Buffer.from(hmacHeader || '', 'utf8'));
}

/**
 * Wrap `request` in a Promise so we can use async/await.
 */
function requestAsync(options) {
  return new Promise((resolve, reject) => {
    request(options, (error, response) => {
      if (error) return reject(error);
      return resolve(response);
    });
  });
}

// ---------- Core Route: Shopify Order Webhook ----------

app.post('/order', async (req, res) => {
  console.log('🎉 We got an order webhook!');

  try {
    const hmac = req.get('X-Shopify-Hmac-Sha256');
    const body = await getRawBody(req);

    const isValid = verifyShopifyWebhook(hmac, body);

    if (!isValid) {
      console.log('🚫 HMAC verification failed – request is not from Shopify.');
      return res.sendStatus(403);
    }

    console.log('✅ HMAC verified – request came from Shopify.');
    res.sendStatus(200); // Acknowledge to Shopify quickly

    const order = JSON.parse(body.toString());
    await placeOrderToECN(order);
  } catch (err) {
    console.error('Unexpected error handling webhook:', err);
    const mailOptions = createErrorMailOptions('', `Unexpected error handling webhook:\n\n${err.stack || err}`);
    sendErrEmail(mailOptions);
  }
});

// ---------- ECN Order Placement ----------

async function placeOrderToECN(order) {
  // Use order_number for logging & email subjects
  const orderNumber = order.order_number;
  let attemptedXML = '';

  try {
    // Determine shipping method id from your shipping helper
    const orderShippingId = order.shipping_lines.length
      ? (shipping.getShippingId(order.shipping_lines[0].title) || 6)
      : 6;

    // Build order header XML
    let xmlStr = `<?xml version="1.0" encoding="ISO-8859-1"?>
<orders>
  <order>
    <orderheader>
      <refordernumber>${orderNumber}</refordernumber>
      <ordertotal>${order.total_price}</ordertotal>
      <clientid>${ECN_CLIENT_ID}</clientid>
      <clientstoreid>${ECN_STORE_ID}</clientstoreid>
      <firstname>${order.shipping_address.first_name}</firstname>
      <lastname>${order.shipping_address.last_name}</lastname>
      <email>${order.customer.email}</email>
      <phone1>${order.customer.phone || ''}</phone1>
      <phone2></phone2>
      <phone3></phone3>
      <shiptoaddress1>${order.shipping_address.address1}</shiptoaddress1>
      <shiptoaddress2>${order.shipping_address.address2 || ''}</shiptoaddress2>
      <shiptocity>${order.shipping_address.city}</shiptocity>
      <shiptostate>${order.shipping_address.province_code}</shiptostate>
      <shiptozip>${order.shipping_address.zip}</shiptozip>
      <shiptocountry>${order.shipping_address.country_code}</shiptocountry>
      <genericshippingmethodid>${orderShippingId}</genericshippingmethodid>
      <invoiceheaderbase64></invoiceheaderbase64>
      <fillstatusid>4</fillstatusid>
      <packingincludesid>1</packingincludesid>
      <orderpauselevelid></orderpauselevelid>
      <invoicefootertext></invoicefootertext>
      <signatureconfirmationid>0</signatureconfirmationid>
      <insuranceid></insuranceid>
      <saturdaydeliveryid>1</saturdaydeliveryid>
    </orderheader>
    <lineitems>`;

    // Filter out Route app protection line items
    const itemsToOrder = order.line_items.filter(
      (item) => item.title !== 'Route Package Protection'
    );

    console.log(`Items to send to ECN for order #${orderNumber}:`, itemsToOrder.length);

    // Build <item> blocks
    for (const lineItem of itemsToOrder) {
      try {
        const productUrl = shopifyRestUrl(`/products/${lineItem.product_id}.json?fields=product_type`);

        const response = await axios.get(productUrl);
        const productType = response.data.product.product_type;

        xmlStr += `
      <item>
        <itemSKU>${lineItem.sku}</itemSKU>
        <itemid>${productType}</itemid>
        <quantity>${lineItem.quantity}</quantity>
        <price>${lineItem.price}</price>
      </item>`;
      } catch (err) {
        console.error('Error fetching product_type for line item', lineItem.sku, err.message);
        // You could choose to skip the item or throw; original code just logged the error.
      }
    }

    // Close XML
    xmlStr += `
    </lineitems>
  </order>
</orders>`;

    attemptedXML = xmlStr;

    // Send XML to ECN
    const orderUrl = `${ECN_BASE_URL}/processxmlorder2.cfm?passkey=${ECN_PASSKEY}&clientID=${ECN_CLIENT_ID}&storeid=${ECN_STORE_ID}`;

    console.log(`Sending XML to ECN for order #${orderNumber}...`);

    const requestOptions = {
      method: 'POST',
      url: orderUrl,
      formData: {
        processxmlorder: xmlStr,
      },
    };

    const response = await requestAsync(requestOptions);

    // Parse ECN XML response
    await handleEcnResponse(response.body, order, attemptedXML);
  } catch (err) {
    console.error('Error in placeOrderToECN:', err);
    const mailOptions = createErrorMailOptions(orderNumber, [
      'Error sending order to ECN',
      '',
      `Error: ${err.message}`,
      '',
      'Attempted XML:',
      attemptedXML,
    ].join('\n'));
    sendErrEmail(mailOptions);
  }
}

// ---------- ECN Response Handling ----------

async function handleEcnResponse(xmlBody, order, attemptedXML) {
  const orderNumber = order.order_number;

  xmlParser.parseString(xmlBody, function (err, result) {
    if (err) {
      console.error('Error parsing ECN XML response:', err);
      const mailOptions = createErrorMailOptions(orderNumber, [
        'Error parsing ECN response XML',
        '',
        `Error: ${err.message}`,
        '',
        'Raw response:',
        xmlBody,
        '',
        'Attempted XML:',
        attemptedXML,
      ].join('\n'));
      return sendErrEmail(mailOptions);
    }

    try {
      const content = result.content;

      const ecnOrderId =
        content.orders &&
        content.orders[0] &&
        content.orders[0].order[0].orderid[0];

      const rejectedReason =
        content.rejectedorders &&
        content.rejectedorders[0] &&
        content.rejectedorders[0].ro_order[0].ro_rejectedreason[0];

      const itemsNotFound = (content.itemsnotfound && content.itemsnotfound[0].inf_item) || [];
      const rejectedItems = [];

      itemsNotFound.forEach((item) => {
        const rejectedItem = {};

        if (item.inf_itemsku && item.inf_itemsku[0] && item.inf_itemsku[0].trim() !== '') {
          rejectedItem.sku = item.inf_itemsku[0];
        }
        if (
          item.inf_rejectedreason &&
          item.inf_rejectedreason[0] &&
          item.inf_rejectedreason[0].trim() !== ''
        ) {
          rejectedItem.reason = item.inf_rejectedreason[0];
        }

        if (Object.keys(rejectedItem).length) {
          rejectedItems.push(rejectedItem);
        }
      });

      if (rejectedReason && rejectedReason.trim() !== '') {
        console.log('ECN rejected order. Reason:', rejectedReason);
        console.log('Rejected items:', rejectedItems);

        let mailText = '';

        if (rejectedReason) {
          mailText += 'Rejected Order Reason:\n';
          mailText += `${rejectedReason}\n\n`;
        }

        if (rejectedItems.length > 0) {
          mailText += 'Rejected Items In Order:\n';
          rejectedItems.forEach((item) => {
            mailText += `Item SKU: ${item.sku}\n`;
            mailText += `Reason: ${item.reason}\n\n`;
          });
        }

        mailText += '\nAttempted XML:\n\n';
        mailText += attemptedXML;

        const mailOptions = createErrorMailOptions(order.order_number, mailText);
        sendErrEmail(mailOptions);
      } else {
        console.log(`ECN order accepted for Shopify order #${orderNumber}, ECN ID: ${ecnOrderId}`);
        // Tag Shopify order with ECN info
        return tagShopifyOrderWithEcn(order.id, ecnOrderId);
      }
    } catch (e) {
      console.error('Error processing ECN response structure:', e);
      const mailOptions = createErrorMailOptions(orderNumber, [
        'Error processing ECN response structure',
        '',
        `Error: ${e.message}`,
        '',
        'Raw response:',
        xmlBody,
        '',
        'Attempted XML:',
        attemptedXML,
      ].join('\n'));
      sendErrEmail(mailOptions);
    }
  });
}

// ---------- Shopify Order Tagging ----------

async function tagShopifyOrderWithEcn(shopifyOrderId, ecnOrderId) {
  try {
    const url = shopifyRestUrl(`/orders/${shopifyOrderId}.json`);

    const payload = {
      order: {
        id: shopifyOrderId,
        tags: `ECN-Order-Placed, ECNORDERID-${ecnOrderId}`,
      },
    };

    const response = await axios.put(url, payload);
    console.log('Shopify order tagged with ECN info:', response.data.order && response.data.order.id);
  } catch (err) {
    console.error('Error tagging Shopify order with ECN ID:', err.message);
    const mailOptions = createErrorMailOptions(
      shopifyOrderId,
      `Error tagging Shopify order with ECN ID:\n\n${err.stack || err}`
    );
    sendErrEmail(mailOptions);
  }
}

// ---------- Start Server ----------

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Order webhook app listening on port ${PORT}`);
});
