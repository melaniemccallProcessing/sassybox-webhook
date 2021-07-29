const axios = require('axios');
var request = require('request');
var rp = require('request-promise');
var xmlParser = require('xml2js');
var fs = require('fs');
var nodemailer = require('nodemailer');
var transporter = nodemailer.createTransport({
    service: 'outlook',
    auth: {
      user: 'sassybox-dev@outlook.com',
      pass: 'ReadyToLaunch2020'
    }
  });

let grabAuthorizedOrdersUrl = 'https://febe69a891c04a2e134443805cdcd304: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@try-sassy-box.myshopify.com/admin/api/2020-10/orders.json?fulfillment_status=unfulfilled';
// let grabAuthorizedOrdersUrl = 'https://febe69a891c04a2e134443805cdcd304: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@try-sassy-box.myshopify.com/admin/api/2020-10/orders.json?ids=3829141241909';

var parser = new xmlParser.Parser();

// fs.readFile(__dirname + '/example-shipped.xml', function(err, data) {
    // console.log(data);
    // xmlParser.parseString(data, function (err, result) {
        // initUpdate(result);
        // console.log(result.content.orders[0].order[0].shipments[0].shipment);
        // let shipmentDetails = result.content.orders[0].order[0].shipments[0].shipment[0];
        // let trackingInfo =
        //     {
        //         trackingNumber: shipmentDetails.shipmentpackages[0].shipmentpackagesitems[0].shipmentpackagetrackingnumber[0].trim(),
        //         shipmentCarrier: shipmentDetails.shipmentcarrier[0]
        //     };
        // console.log(trackingInfo);// console.log(err);
        // let lineItems = result.content.orders[0].order[0].lineitems[0].item;
        // // console.log(lineItems);
        // let cancelledItems = [];
        // let packagedItems = [];
        // let totalItemsOrdered = lineItems.length;
        // for(let i = 0; i < lineItems.length; i++) {
        //     if (lineItems[i].itemstatus[0] == 'Cancelled' || lineItems[i].cancelled[0] != '0') {
        //         cancelledItems.push(lineItems[i]);
        //     } else {
        //         packagedItems.push(lineItems[i]);
        //     }
        // }
        // console.log(packagedItems);
        // // if(totalItemsOrdered == packagedItems) { //everything seems fine...
        //     processFullOrder(orderToProcess,trackingInfo)
        // } else {
        //     processPartialOrder(cancelledItems,orderToProcess,trackingInfo);
        // }
    // });
// });
 axios.get(grabAuthorizedOrdersUrl).then(response => {
     let ordersToCheck = [];
     let ordersFromShopify = response.data.orders;
     if(!ordersFromShopify.length) {
         console.log("No new orders to parse");
         return;
     }
     for(let i = 0; i < ordersFromShopify.length; i++) {
         let orderWithId = ordersFromShopify[i];
         let orderTags = ordersFromShopify[i].tags.split(', ');
         let orderIdTag = orderTags.find(tag => {
             return tag.includes('ECNORDERID');
         })
         let orderId = orderIdTag ? orderIdTag.replace('ECNORDERID-', '') : '';
         if(orderId) {
            orderWithId.ecnOrderId = orderId;
            ordersToCheck.push(orderWithId);
         }
     }


     processOrders(ordersToCheck);

 }).catch(err => {
     console.log('ERROR GRABBING ORDERS!' + err);
     //error email here
 })

async function processOrders(ordersToCheck) {

    for(let i = 0; i < ordersToCheck.length; i++) {
        let orderId = ordersToCheck[i].ecnOrderId;
        let financial_status = ordersToCheck[i].financial_status;
        await grabOrderStatus(orderId).then(response => {
            // console.log(response)
            xmlParser.parseString(response, function(err,result) {
                let order_status = result.content.orders[0].order[0].orderstatus[0];
                // console.log(order_status)
                if(order_status == 'Shipped'){
                    console.log('Order Id: ' + orderId + ' Shipped!');
                    let shipmentDetails = result.content.orders[0].order[0].shipments[0].shipment[0];
                    let trackingInfo =
                        {
                            trackingNumber: shipmentDetails.shipmentpackages[0].shipmentpackagesitems[0].shipmentpackagetrackingnumber[0].trim(),
                            shipmentCarrier: shipmentDetails.shipmentcarrier[0]
                        };
                    console.log(trackingInfo);// console.log(err);
                    let lineItems = result.content.orders[0].order[0].lineitems[0].item;
                    // console.log(lineItems);
                    let cancelledItems = [];
                    let packagedItems = [];
                    let totalItemsOrdered = lineItems.length;
                    for(let i = 0; i < lineItems.length; i++) {
                        if (lineItems[i].cancelled[0] != '0') { //some cancelled quantities here
                            cancelledItems.push(lineItems[i]);
                            console.log(lineItems[i]);
                        } else {  //packaged items yay!
                            packagedItems.push(lineItems[i]);
                            console.log(lineItems[i])
                        }
                    }
                    console.log('Total items ordered: ' + totalItemsOrdered);
                    console.log('packaged Items: ' + packagedItems);
                    console.log('cancelled Items: ' + cancelledItems);
                    if(totalItemsOrdered == packagedItems.length) { //everything seems fine...
                        processFullOrder(ordersToCheck[i],trackingInfo);
                        console.log('we can process the whole order');
                    } else {
                        console.log('this is a partial order');
                        console.log(financial_status);
                        // processPartialOrder(cancelledItems,ordersToCheck[i],trackingInfo, financial_status);
                    }
                } else if (order_status == 'Canceled') {
                    let lineItems = result.content.orders[0].order[0].lineitems[0].item;
                    // processCancelledOrder(ordersToCheck[i],lineItems);
                    //nothing shipped
                    //send email to customer
                }

            });
        });
    }
}
function processCancelledOrder(orderObj, cancelledItems) {
    sendCustomerEmailAboutPartialOrder(orderObj,cancelledItems);
    //DONT CANCEL ORDER, JUST ARCHIVE
    let cancelOrderUrl = 'https://febe69a891c04a2e134443805cdcd304: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@try-sassy-box.myshopify.com/admin/api/2020-10/orders/' + orderObj.id + '/cancel.json';
    axios.post(cancelOrderUrl).then(function() {
        console.log('order cancelled successfully');
        //email here
    }).catch((err)=>{
        //error email here
    })
}

function processFullOrder(orderObj,trackingInfo) {
    let shopifyOrderId = orderObj.id;

    let total_price = orderObj.current_total_price ? orderObj.current_total_price : orderObj.total_price;
    console.log(total_price);
    let financial_status = orderObj.financial_status;
    // console.log('shopify order id: ' + shopifyOrderId);
    if(financial_status == 'authorized') {
        capturePayment(shopifyOrderId, total_price);
        // console.log('this is authorized')
    }
    fulfillOrder(shopifyOrderId,trackingInfo.shipmentCarrier,trackingInfo.trackingNumber);
}

function processPartialOrder(cancelledItems,orderObj,trackingInfo,financial_status) {
    let partialAmountToSubtract = 0;
    let shopifyOrderId = orderObj.id;
    let shopifyOrderLineItems = orderObj.line_items;
    let cancelledItemsInShopify = [];
    for(let i = 0 ; i < cancelledItems.length; i++) {
        //account for quantity and discount
        //orderObj.line_items[0].discount_allocations[0].amount
        let ecnCancelledItemSKU = cancelledItems[i].sku[0];

        let ecnCancelledItemQuantity = Number(cancelledItems[i].cancelled[0]);
        console.log('ecnCancelledItemSKU' + ecnCancelledItemSKU);
        console.log('ecnCancelledItemQuantity ' + ecnCancelledItemQuantity);
        let shopifyItem = shopifyOrderLineItems.find(item => ecnCancelledItemSKU == item.sku);
        console.log(shopifyItem.price);
        let cancelledItemDiscount = shopifyItem.discount_allocations[0] ? shopifyItem.discount_allocations[0].amount : 0;
        console.log('cancelledItemDiscount: ' + cancelledItemDiscount);
        shopifyItem.quantityToCancel = ecnCancelledItemQuantity;
        cancelledItemsInShopify.push(shopifyItem);
        partialAmountToSubtract += ((shopifyItem.price * ecnCancelledItemQuantity) - cancelledItemDiscount);
    }
    let total_price = orderObj.current_total_price ? orderObj.current_total_price : orderObj.total_price;

    console.log('total price ' + total_price);
    console.log('partialAmountToSubtract '+ partialAmountToSubtract);
    let amountToCapture = (total_price - partialAmountToSubtract).toFixed(2);
    console.log('Amount to Capture: ' + amountToCapture);
    //amount to refund if paid already
    if(financial_status == 'paid') {
        if(total_price !== '0.00') {
        //if not.. refund partialamount to subtract
            //partialAmountToSubtract
            console.log('amount refunding: ' + partialAmountToSubtract)
            // console.log(orderObj);
            refundPartialAmount(orderObj, cancelledItemsInShopify);
        }
    sendCustomerEmailAboutPartialOrder(orderObj,cancelledItems);
    fulfillOrder(shopifyOrderId,trackingInfo.shipmentCarrier,trackingInfo.trackingNumber);

    } else if (financial_status == 'authorized') {
        //amount to capture if authorized

        capturePayment(shopifyOrderId, amountToCapture);
        // console.log(orderObj.customer.email);
        sendCustomerEmailAboutPartialOrder(orderObj,cancelledItems);
        fulfillOrder(shopifyOrderId,trackingInfo.shipmentCarrier,trackingInfo.trackingNumber);

    }

}

function refundPartialAmount(orderObj, cancelledItems) {
    // console.log(orderObj);
    let order_id = orderObj.id;
    let calculateRefundUrl = 'https://febe69a891c04a2e134443805cdcd304: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@try-sassy-box.myshopify.com/admin/api/2021-04/orders/' + order_id + '/refunds/calculate.json';
    // let transactionUrl = 'https://febe69a891c04a2e134443805cdcd304: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@try-sassy-box.myshopify.com/admin/api/2020-10/orders/' + order_id + '/transactions.json';
    // console.log(cancelledItems)
    let lineItems = cancelledItems.map(function(item){
        let line_item = {
            "line_item_id": item.id,
            "quantity": item.quantityToCancel,
            "restock_type": "no_restock"
        }
        return line_item;
    });
    // console.log(lineItems);
    let objToCalculateRefund = {
        "refund": {
            "refund_line_items": lineItems
        }
    }
    // console.log(objToCalculateRefund);
    axios.post(calculateRefundUrl, objToCalculateRefund).then(function(response){
        console.log(response.data);
        let transactionsToRefund = response.data.refund.transactions;
        refundItemsInOrder(order_id, transactionsToRefund, lineItems);

    }).catch(function(err) {
        console.log(err.data);
    });
}
function refundItemsInOrder(order_id, transactions, line_items) {
    console.log(order_id);
    console.log(transactions);
    console.log(line_items);
    let transactionsToRefund = transactions.map(function(transaction){
        transaction.kind = "refund";
        return transaction;
    });
    console.log(transactionsToRefund);
    let refundUrl = 'https://febe69a891c04a2e134443805cdcd304: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@try-sassy-box.myshopify.com/admin/api/2021-04/orders/' + order_id + '/refunds.json';
    let refundObj = {
        "refund": {
          "currency": "USD",
          "notify": true,
          "note": "Out of Stock Items",
          "shipping": {
            "full_refund": false
          },
          "refund_line_items": line_items,
          "transactions": transactions
        }
      };
      axios.post(refundUrl, refundObj).then(function(response){
        console.log("customer refunded");
        console.log(response.data);
        console.log(response.errors);
      }).catch(function(err){
        console.log("error with refunding customer: " + err);
      })
}
async function fulfillOrder(order_id, shippingCompany, trackingNum) {
    let shippingCompanyForShopify = determineShippingCompany(shippingCompany);
    // let trackingNumberStr = "" + trackingNum;
    console.log('shipping Company: ' + shippingCompanyForShopify);

    let fulfillmentURL = 'https://febe69a891c04a2e134443805cdcd304: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@try-sassy-box.myshopify.com/admin/api/2020-10/orders/' + order_id + '/fulfillments.json';

    let fulfillmentObj =
    {
        "fulfillment": {
          "location_id": 31145721923,
          "tracking_number": trackingNum,
          "tracking_company": shippingCompanyForShopify,
          "notify_customer": true
        }
      };
    console.log(fulfillmentObj);
    console.log(fulfillmentURL);
    axios.post(fulfillmentURL, fulfillmentObj).then(function(){
        console.log('order has been fulfilled.. customer has been notified');
    }).catch(function(err){
        console.log('error sending order fulfillment!' + err);
        // error email here
    });
}
async function capturePayment(order_id, amount){
    //get authorization key from here
    let transactionUrl = 'https://febe69a891c04a2e134443805cdcd304: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@try-sassy-box.myshopify.com/admin/api/2020-10/orders/' + order_id + '/transactions.json';
    axios.get(transactionUrl).then(function(response){
        let transactions = response.data.transactions;
        let authorizedTransaction = transactions.find(transaction => { return transaction.kind == 'authorization' && transaction.status == 'success'});
        let authKey = authorizedTransaction.authorization;
        console.log(amount);
        console.log(authKey);
        let capturePaymentObj = {
            "transaction": {
              "amount": amount,
              "kind": "capture",
              "authorization": authKey
            }
          };
          console.log(capturePaymentObj);
        axios.post(transactionUrl, capturePaymentObj).then(function(){
            console.log('transaction captured')
        }).catch(function(err) {
            console.log('error capturing transaction');
            //error email here
        })
    });



}
async function grabOrderStatus (orderId) {
    let xmlBody = `<?xml version="1.0" encoding="ISO-8859-1"?>
    <checkorders>
        <order>
            <clientid>6678</clientid>
            <clientstoreid>791</clientstoreid>
            <orderid>${orderId}</orderid>
            <refordernumber></refordernumber>
            <orderstartdate></orderstartdate>
            <orderenddate></orderenddate>
        </order>
    </checkorders>`;

    let ecnOrderStatusUrl = 'http://adultshipper.com/back/getxmlorderstatus2.cfm?passkey=7951D77D8D073EFC27A6138CCBC9FC4C&clientID=6678&storeid=791';
    var options = {
        'method': 'POST',
        'url': ecnOrderStatusUrl,
        formData: {
            'getxmlorderstatus': xmlBody
        }
    };
    return rp(options);
}

function sendCustomerEmailAboutPartialOrder(order, rejectedItems) {
    var mailOptions = {
        from: {
            name: 'Sassy Box',
            address: 'sassybox-dev@outlook.com'
        },
        // to: 'bluescript17@gmail.com',
        to: order.customer.email,
        bcc: 'master@sassyboxshop.com,bluescript17@gmail.com',
        replyTo: 'contact@sassyboxshop.com',
        subject: 'Items cancelled from your order',
        html: ''
    };
    let lineItemsStr =  '';
    // console.log(rejectedItems);
    rejectedItems.forEach(item => {
        let shopify_item = order.line_items.find(shopify_item => shopify_item.sku == item.sku[0]);
        // console.log(shopify_item);
        let cancelledItemQty = item.cancelled[0];
        let cancelledItemDiscount = shopify_item.discount_allocations[0] ? shopify_item.discount_allocations[0].amount : 0;
        // console.log(cancelledItemQty);
        // console.log(cancelledItemDiscount);
        lineItemsStr += shopify_item.title + '&nbsp;&nbsp;&nbsp;&nbsp;' + 'QTY ' + cancelledItemQty + '&nbsp;&nbsp;&nbsp;&nbsp;$' + (shopify_item.price - cancelledItemDiscount) + '<br>';
    })
    let payment_method =   order.payment_details ?  `${order.payment_details.credit_card_company}<br>
    ${order.payment_details.credit_card_number}<br><br><br>` : `${order.gateway}<br><br><br>`;

    let emailText = `<b>Order #: ${order.order_number}</b><br><br>

    Hi ${order.customer.first_name},<br><br>
    Unfortunately, the items listed below are no longer available. We're sorry for any inconvenience! We'll send you an email when the rest of your order ships. (You won't be charged for these canceled items, of course.) <br><br>
    Thank you for your patience, and please contact us by replying to this email if you have any questions or concerns.<br><br>
    <u><b>Good To Know</b></u><br>
    Occasionally, we restock in-demand items. Keep an eye on <a href="sassyboxshop.com">SassyBoxShop.com</a> just in case.<br><br>
    If you paid by credit or debit card, your statement may reflect an authorization. This is not a charge. In most cases, it will fall off your account within 3 - 5 business days. Contact your financial institution if you have any issues.<br><br>
    <b><u>Your Cancelled Items</u></b><br>
     ${lineItemsStr}<br><br>
    <u><b>Shipping</b></u><br>
    <u>Ship To</u><br>
    ${order.shipping_address.first_name} ${order.shipping_address.last_name}<br>
    ${order.shipping_address.address1}<br>`;
    if(order.shipping_address.address2) {
       emailText += `${order.shipping_address.address2} <br>`
    }
    emailText += `${order.shipping_address.city}, ${order.shipping_address.province}<br>
    ${order.shipping_address.country} <br><br>
    <u>Shipping Method</u><br>
    ${order.shipping_lines[0].title}<br><br>
    <u><b>Billing</b></u><br>
    <u>Bill To</u><br>
    ${order.billing_address.first_name} ${order.billing_address.last_name}<br>
    ${order.billing_address.address1}<br>`;
    if(order.billing_address.address2) {
        emailText += `${order.billing_address.address2} <br>`
     };
     emailText +=
    `${order.billing_address.city}, ${order.billing_address.province}<br>
    ${order.billing_address.country} <br><br>

    <b><u>Payment Method</u></b><br>` +
    payment_method;
    mailOptions.html = emailText;

    transporter.sendMail(mailOptions, function(err, info){
        if (err) {
          console.log('error sending error email' + err);
        } else {
          console.log('Items cancelled email sent: ' + info.response);
        }
    });
}

function determineShippingCompany(shippingCompany) {
    if(shippingCompany.includes('DHL')) {
        return "DHL eCommerce";
    }
    if(shippingCompany.includes('USPS')) {
        return "USPS";
    }
    if(shippingCompany.includes('UPS')) {
        return "UPS";
    }
    if(shippingCompany.includes('FedEx')) {
        return "FedEx";
    }
}