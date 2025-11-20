// order-updates.js
// Run every hour via scheduler:
// - Fetch unfulfilled Shopify orders
// - For orders tagged with ECNORDERID, query ECN for status
// - If "Shipped": capture payment (if authorized) and fulfill in Shopify
// - If partial/cancelled: send status email (manual handling), optionally email customer

const axios = require('axios');
const rp = require('request-promise');
const xmlParser = require('xml2js');
const nodemailer = require('nodemailer');

// ---------------------------------------------------------
// Configuration (from environment variables)
// ---------------------------------------------------------

// Shopify Admin API
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_PASSWORD = process.env.SHOPIFY_API_PASSWORD;
const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN; // e.g. "your-store.myshopify.com"
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2020-10';

// ECN / dropshipper configuration
const ECN_CLIENT_ID = process.env.ECN_CLIENT_ID || '6678';
const ECN_STORE_ID = process.env.ECN_STORE_ID || '791';
const ECN_PASSKEY = process.env.ECN_PASSKEY;
const ECN_BASE_URL = process.env.ECN_BASE_URL || 'http://adultshipper.com/back';

// Helper to build a Shopify REST Admin URL with basic auth
function shopifyRestUrl(pathWithQuery) {
    return (
        'https://' +
        SHOPIFY_API_KEY + ':' +
        SHOPIFY_API_PASSWORD + '@' +
        SHOPIFY_SHOP_DOMAIN +
        '/admin/api/' + SHOPIFY_API_VERSION +
        pathWithQuery
    );
}

// Email / SMTP
const EMAIL_SERVICE = process.env.MAIL_SMTP_SERVICE || 'outlook';
const EMAIL_USER = process.env.MAIL_SMTP_USER;
const EMAIL_PASS = process.env.MAIL_SMTP_PASS;
const MAIL_FROM_ADDRESS = process.env.MAIL_FROM_ADDRESS;        // sender address
const MAIL_TO_ERRORS = process.env.MAIL_TO_ERRORS;              // internal errors / logs
const MAIL_BCC_ERRORS = process.env.MAIL_BCC_ERRORS || '';      // optional

if (!EMAIL_USER || !EMAIL_PASS) {
    console.warn('⚠️ Email credentials are not fully configured (MAIL_SMTP_USER / MAIL_SMTP_PASS).');
}

const transporter = nodemailer.createTransport({
    service: EMAIL_SERVICE,
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
    }
});

// Base URL for unfulfilled, open orders
const grabAuthorizedOrdersUrl = shopifyRestUrl(
    '/orders.json?fulfillment_status=unfulfilled&status=open'
);

// Accumulates status info that we email to Sassy Box
let updateEmail = '';

// Reusable helper to create email options for error / customer messages
function createErrorMailOptions(subject, html) {
    return {
        from: {
            name: 'Sassy Box',
            address: MAIL_FROM_ADDRESS
        },
        to: MAIL_TO_ERRORS,
        bcc: MAIL_BCC_ERRORS,
        subject,
        html
    };
}

// ---------------------------------------------------------
// Main flow
// ---------------------------------------------------------

async function main() {
    try {
        const response = await axios.get(grabAuthorizedOrdersUrl);
        const ordersFromShopify = response.data.orders || [];

        if (!ordersFromShopify.length) {
            console.log('No new orders to parse');
            return;
        }

        // Only keep orders that have an ECNORDERID tag
        const ordersToCheck = [];

        for (const shopifyOrder of ordersFromShopify) {
            const orderWithId = shopifyOrder;
            const orderTags = (shopifyOrder.tags || '').split(', ').filter(Boolean);

            const orderIdTag = orderTags.find(tag => tag.includes('ECNORDERID'));
            const ecnOrderId = orderIdTag ? orderIdTag.replace('ECNORDERID-', '') : '';

            if (ecnOrderId) {
                orderWithId.ecnOrderId = ecnOrderId;
                ordersToCheck.push(orderWithId);
            }
        }

        if (!ordersToCheck.length) {
            console.log('No orders tagged with ECNORDERID.');
            return;
        }

        await processOrders(ordersToCheck);
    } catch (err) {
        console.log('ERROR GRABBING ORDERS!', err.message);
        const mailOptions = createErrorMailOptions(
            'Error Grabbing Shopify Orders',
            `Error grabbing unfulfilled orders:\n\n${err.stack || err}`
        );
        transporter.sendMail(mailOptions, () => { });
    }
}

// Run immediately when this script is executed
main().catch(err => {
    console.error('Unexpected error in order-updates main():', err);
});

// ---------------------------------------------------------
// Process each order against ECN status
// ---------------------------------------------------------

async function processOrders(ordersToCheck) {
    for (const order of ordersToCheck) {
        const orderId = order.ecnOrderId;
        const financial_status = order.financial_status;

        try {
            const responseXml = await grabOrderStatus(orderId);

            xmlParser.parseString(responseXml, function (err, result) {
                if (err) {
                    console.log('Error parsing ECN XML for order', orderId, err);
                    const mailOptions = createErrorMailOptions(
                        `Error Parsing ECN Order XML - ${orderId}`,
                        `Error parsing ECN XML for order ${orderId}:\n\n${err.stack || err}\n\nRaw:\n${responseXml}`
                    );
                    transporter.sendMail(mailOptions, () => { });
                    return;
                }

                const content = result.content;
                const orderNode = content.orders?.[0]?.order?.[0];

                if (!orderNode) {
                    console.log('No ECN order node found for', orderId);
                    return;
                }

                const order_status = orderNode.orderstatus?.[0];
                console.log(`ECN order status for ${orderId}: ${order_status}`);

                if (order_status === 'Shipped') {
                    console.log('Order Id:', orderId, 'Shipped!');

                    const shipment = orderNode.shipments?.[0]?.shipment?.[0];
                    if (!shipment) {
                        console.log('No shipment node found for ECN order', orderId);
                        return;
                    }

                    const shipmentDetails = shipment;
                    const trackingInfo = {
                        trackingNumber: shipmentDetails.shipmentpackages?.[0]?.shipmentpackagesitems?.[0]?.shipmentpackagetrackingnumber?.[0]?.trim() || '',
                        shipmentCarrier: shipmentDetails.shipmentcarrier?.[0] || ''
                    };

                    console.log('Tracking info:', trackingInfo);

                    const lineItems = orderNode.lineitems?.[0]?.item || [];
                    const cancelledItems = [];
                    const packagedItems = [];

                    for (const line of lineItems) {
                        if (line.cancelled?.[0] !== '0') {
                            cancelledItems.push(line);
                        } else {
                            packagedItems.push(line);
                        }
                    }

                    const totalItemsOrdered = lineItems.length;

                    console.log('Total items ordered:', totalItemsOrdered);
                    console.log('Packaged items:', packagedItems.length);
                    console.log('Cancelled items:', cancelledItems.length);

                    if (totalItemsOrdered === packagedItems.length) {
                        console.log('Full order shipped; processing full order in Shopify.');
                        processFullOrder(order, trackingInfo);
                    } else {
                        console.log('Partial order detected.');
                        console.log('financial_status:', financial_status);

                        updateEmail +=
                            `Order # ${order.order_number} is a partial order\n` +
                            `ECN ID: ${orderId}\n` +
                            `Order was not auto-fulfilled. Please run the order manually and monitor. Contact Melanie.\n\n`;

                        // Existing behavior: only email SassyBox, no auto-partial processing
                        sendStatusEmailToSassyBox();
                        // If you want to re-enable automation later, call:
                        // processPartialOrder(cancelledItems, order, trackingInfo, financial_status);
                    }
                } else if (order_status === 'Canceled') {
                    const lineItems = orderNode.lineitems?.[0]?.item || [];
                    console.log('ECN shows order as fully cancelled.');

                    updateEmail +=
                        `Order # ${order.order_number} is a fully cancelled order\n` +
                        `ECN ID: ${orderId}\n` +
                        `Order was not auto-fulfilled. Please handle manually and monitor. Contact Melanie.\n\n`;

                    // Existing behavior: just notify; you can hook processCancelledOrder here later.
                    // processCancelledOrder(order, lineItems);
                    sendStatusEmailToSassyBox();
                }
            });
        } catch (err) {
            console.log(`Error grabbing ECN status for order ${orderId}:`, err.message);
            const mailOptions = createErrorMailOptions(
                `Error Grabbing ECN Status - ${orderId}`,
                `Error grabbing ECN status for order ${orderId}:\n\n${err.stack || err}`
            );
            transporter.sendMail(mailOptions, () => { });
        }
    }
}

// Stub kept for future use; behavior currently handled manually
function processCancelledOrder(orderObj, cancelledItems) {
    // Potential future:
    // - sendCustomerEmailAboutPartialOrder(orderObj, cancelledItems);
    // - refundPartialAmount(orderObj, cancelledItems);
    // - cancel order in Shopify (cancel API)
}

// ---------------------------------------------------------
// Full Order (everything shipped)
// ---------------------------------------------------------

function processFullOrder(orderObj, trackingInfo) {
    const shopifyOrderId = orderObj.id;
    const total_price = orderObj.current_total_price || orderObj.total_price;
    const financial_status = orderObj.financial_status;

    updateEmail += `Order # ${orderObj.order_number}\n`;
    console.log('Order total price:', total_price);

    if (financial_status === 'authorized') {
        capturePayment(shopifyOrderId, total_price);
    }

    fulfillOrder(shopifyOrderId, trackingInfo.shipmentCarrier, trackingInfo.trackingNumber);
}

// ---------------------------------------------------------
// Partial Order (some cancelled, some shipped)
// ---------------------------------------------------------

function processPartialOrder(cancelledItems, orderObj, trackingInfo, financial_status) {
    let partialAmountToSubtract = 0;
    const shopifyOrderId = orderObj.id;
    const shopifyOrderLineItems = orderObj.line_items;
    const cancelledItemsInShopify = [];

    for (const cancelled of cancelledItems) {
        const ecnCancelledItemSKU = cancelled.sku[0];
        const ecnCancelledItemQuantity = Number(cancelled.cancelled[0]);

        console.log('ecnCancelledItemSKU', ecnCancelledItemSKU);
        console.log('ecnCancelledItemQuantity', ecnCancelledItemQuantity);

        const shopifyItem = shopifyOrderLineItems.find(item => ecnCancelledItemSKU === item.sku);
        console.log('Shopify price:', shopifyItem.price);

        const cancelledItemDiscount = shopifyItem.discount_allocations[0]
            ? shopifyItem.discount_allocations[0].amount
            : 0;

        console.log('cancelledItemDiscount:', cancelledItemDiscount);

        shopifyItem.quantityToCancel = ecnCancelledItemQuantity;
        cancelledItemsInShopify.push(shopifyItem);

        partialAmountToSubtract += (shopifyItem.price * ecnCancelledItemQuantity) - cancelledItemDiscount;
    }

    const total_price = orderObj.current_total_price || orderObj.total_price;

    console.log('total price', total_price);
    console.log('partialAmountToSubtract', partialAmountToSubtract);

    const amountToCapture = (total_price - partialAmountToSubtract).toFixed(2);
    console.log('Amount to Capture:', amountToCapture);

    if (financial_status === 'paid') {
        if (total_price !== '0.00') {
            console.log('amount refunding:', partialAmountToSubtract);
            refundPartialAmount(orderObj, cancelledItemsInShopify);
        }

        sendCustomerEmailAboutPartialOrder(orderObj, cancelledItems);
        fulfillOrder(shopifyOrderId, trackingInfo.shipmentCarrier, trackingInfo.trackingNumber);

    } else if (financial_status === 'authorized') {
        capturePayment(shopifyOrderId, amountToCapture);
        sendCustomerEmailAboutPartialOrder(orderObj, cancelledItems);
        fulfillOrder(shopifyOrderId, trackingInfo.shipmentCarrier, trackingInfo.trackingNumber);
    }
}

// ---------------------------------------------------------
// Refund / Capture / Fulfill
// ---------------------------------------------------------

function refundPartialAmount(orderObj, cancelledItems) {
    const order_id = orderObj.id;
    const calculateRefundUrl = shopifyRestUrl(`/orders/${order_id}/refunds/calculate.json`);

    const lineItems = cancelledItems.map(item => ({
        line_item_id: item.id,
        quantity: item.quantityToCancel,
        restock_type: 'no_restock'
    }));

    const objToCalculateRefund = {
        refund: {
            refund_line_items: lineItems
        }
    };

    axios.post(calculateRefundUrl, objToCalculateRefund)
        .then(response => {
            console.log('Refund calculation:', response.data);
            const transactionsToRefund = response.data.refund.transactions;
            refundItemsInOrder(order_id, transactionsToRefund, lineItems);
        })
        .catch(err => {
            console.log('Error calculating refund:', err.message);
        });
}

function refundItemsInOrder(order_id, transactions, line_items) {
    console.log('Refunding for order:', order_id);

    // Mutate the original transactions to kind "refund"
    const transactionsToRefund = transactions.map(transaction => {
        transaction.kind = 'refund';
        return transaction;
    });

    console.log('Refund transactions:', transactionsToRefund);
    console.log('Refund line items:', line_items);

    const refundUrl = shopifyRestUrl(`/orders/${order_id}/refunds.json`);
    const refundObj = {
        refund: {
            currency: 'USD',
            notify: true,
            note: 'Out of Stock Items',
            shipping: { full_refund: false },
            refund_line_items: line_items,
            transactions // already mutated to "refund"
        }
    };

    axios.post(refundUrl, refundObj)
        .then(response => {
            console.log('Customer refunded');
            console.log(response.data);
        })
        .catch(err => {
            console.log('Error refunding customer:', err.message);
        });
}

function fulfillOrder(order_id, shippingCompany, trackingNum) {
    const shippingCompanyForShopify = determineShippingCompany(shippingCompany);
    console.log('shipping Company:', shippingCompanyForShopify);

    const fulfillmentUrl = shopifyRestUrl(`/orders/${order_id}/fulfillments.json`);

    const fulfillmentObj = {
        fulfillment: {
            location_id: 31145721923,
            tracking_number: trackingNum,
            tracking_company: shippingCompanyForShopify,
            notify_customer: true
        }
    };

    console.log('Fulfillment payload:', fulfillmentObj);

    axios.post(fulfillmentUrl, fulfillmentObj)
        .then(() => {
            console.log('Order has been fulfilled; customer notified.');
            updateEmail += 'Order has been fulfilled\n';
            sendStatusEmailToSassyBox();
        })
        .catch(err => {
            console.log('Error sending order fulfillment!', err.message);
            updateEmail += 'There was an error fulfilling this order. Please reach out to Melanie.\n';
            sendStatusEmailToSassyBox();
        });
}

function capturePayment(order_id, amount) {
    const transactionUrl = shopifyRestUrl(`/orders/${order_id}/transactions.json`);

    axios.get(transactionUrl)
        .then(response => {
            const transactions = response.data.transactions;
            const authorizedTransaction = transactions.find(
                t => t.kind === 'authorization' && t.status === 'success'
            );

            if (!authorizedTransaction) {
                console.log('No successful authorization transaction found for order', order_id);
                return;
            }

            const authKey = authorizedTransaction.authorization;

            console.log('Capturing amount:', amount);
            console.log('Authorization key:', authKey);

            const capturePaymentObj = {
                transaction: {
                    amount: amount,
                    kind: 'capture',
                    authorization: authKey
                }
            };

            axios.post(transactionUrl, capturePaymentObj)
                .then(() => {
                    console.log('Transaction captured for order', order_id);
                })
                .catch(err => {
                    console.log('Error capturing transaction:', err.message);
                });
        })
        .catch(err => {
            console.log('Error fetching transactions for capture:', err.message);
        });
}

// ---------------------------------------------------------
// ECN Status Fetch
// ---------------------------------------------------------

async function grabOrderStatus(orderId) {
    const xmlBody = `<?xml version="1.0" encoding="ISO-8859-1"?>
<checkorders>
  <order>
    <clientid>${ECN_CLIENT_ID}</clientid>
    <clientstoreid>${ECN_STORE_ID}</clientstoreid>
    <orderid>${orderId}</orderid>
    <refordernumber></refordernumber>
    <orderstartdate></orderstartdate>
    <orderenddate></orderenddate>
  </order>
</checkorders>`;

    const ecnOrderStatusUrl =
        `${ECN_BASE_URL}/getxmlorderstatus.cfm?passkey=${ECN_PASSKEY}` +
        `&clientID=${ECN_CLIENT_ID}&storeid=${ECN_STORE_ID}`;

    const options = {
        method: 'POST',
        url: ecnOrderStatusUrl,
        formData: {
            getxmlorderstatus: xmlBody
        }
    };

    return rp(options); // returns a Promise of the XML string
}

// ---------------------------------------------------------
// Emails / helpers
// ---------------------------------------------------------

function sendCustomerEmailAboutPartialOrder(order, rejectedItems) {
    const mailOptions = createErrorMailOptions('Items cancelled from your order', '');
    let lineItemsStr = '';

    rejectedItems.forEach(item => {
        const shopify_item = order.line_items.find(si => si.sku === item.sku[0]);
        const cancelledItemQty = item.cancelled[0];
        const cancelledItemDiscount = shopify_item.discount_allocations[0]
            ? shopify_item.discount_allocations[0].amount
            : 0;

        lineItemsStr +=
            `${shopify_item.title}&nbsp;&nbsp;&nbsp;&nbsp;` +
            `QTY ${cancelledItemQty}&nbsp;&nbsp;&nbsp;&nbsp;` +
            `$${(shopify_item.price - cancelledItemDiscount)}<br>`;
    });

    const payment_method = order.payment_details
        ? `${order.payment_details.credit_card_company}<br>${order.payment_details.credit_card_number}<br><br><br>`
        : `${order.gateway}<br><br><br>`;

    let emailText = `<b>Order #: ${order.order_number}</b><br><br>

Hi ${order.customer.first_name},<br><br>
Unfortunately, the items listed below are no longer available. We're sorry for any inconvenience! We'll send you an email when the rest of your order ships. (You won't be charged for these canceled items, of course.) <br><br>
Thank you for your patience, and please contact us by replying to this email if you have any questions or concerns.<br><br>
<u><b>Good To Know</b></u><br>
Occasionally, we restock in-demand items. Keep an eye on <a href="https://sassyboxshop.com">SassyBoxShop.com</a> just in case.<br><br>
If you paid by credit or debit card, your statement may reflect an authorization. This is not a charge. In most cases, it will fall off your account within 3 - 5 business days. Contact your financial institution if you have any issues.<br><br>
<b><u>Your Cancelled Items</u></b><br>
${lineItemsStr}<br><br>

<u><b>Shipping</b></u><br>
<u>Ship To</u><br>
${order.shipping_address.first_name} ${order.shipping_address.last_name}<br>
${order.shipping_address.address1}<br>`;

    if (order.shipping_address.address2) {
        emailText += `${order.shipping_address.address2}<br>`;
    }

    emailText +=
        `${order.shipping_address.city}, ${order.shipping_address.province}<br>
${order.shipping_address.country}<br><br>
<u>Shipping Method</u><br>
${order.shipping_lines[0].title}<br><br>
<u><b>Billing</b></u><br>
<u>Bill To</u><br>
${order.billing_address.first_name} ${order.billing_address.last_name}<br>
${order.billing_address.address1}<br>`;

    if (order.billing_address.address2) {
        emailText += `${order.billing_address.address2}<br>`;
    }

    emailText +=
        `${order.billing_address.city}, ${order.billing_address.province}<br>
${order.billing_address.country}<br><br>
<b><u>Payment Method</u></b><br>${payment_method}`;

    mailOptions.html = emailText;

    transporter.sendMail(mailOptions, function (err, info) {
        if (err) {
            console.log('Error sending partial order email to customer:', err.message);
        } else {
            console.log('Items cancelled email sent:', info.response);
        }
    });
}

function determineShippingCompany(shippingCompany) {
    if (!shippingCompany) return '';

    if (shippingCompany.includes('DHL')) return 'DHL eCommerce';
    if (shippingCompany.includes('USPS')) return 'USPS';
    if (shippingCompany.includes('UPS')) return 'UPS';
    if (shippingCompany.includes('FedEx')) return 'FedEx';

    return shippingCompany;
}

function sendStatusEmailToSassyBox() {
    const html = updateEmail || 'no updates have been detected';

    const mailOptions = {
        from: {
            name: 'Sassy Box',
            address: MAIL_FROM_ADDRESS
        },
        to: MAIL_TO_ERRORS || MAIL_FROM_ADDRESS,
        bcc: MAIL_BCC_ERRORS || '',
        subject: 'Order Update Status',
        html
    };

    transporter.sendMail(mailOptions, function (err, info) {
        if (err) {
            console.log('Error sending status email:', err.message);
        } else {
            console.log('Update email sent.');
        }
    });
}
