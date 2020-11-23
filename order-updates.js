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
  
let grabAuthorizedOrdersUrl = 'https://febe69a891c04a2e134443805cdcd304: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@try-sassy-box.myshopify.com/admin/api/2020-10/orders.json?financial_status=authorized&status=open';
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
                        } else {  //packaged items yay!
                            packagedItems.push(lineItems[i]);
                            console.log(lineItems[i])
                        }
                    }
                    console.log('Total items ordered: ' + totalItemsOrdered);
                    console.log('packaged Items: ' + packagedItems);
                    console.log('cancelled Items: ' + cancelledItems);
                    if(totalItemsOrdered == packagedItems.length) { //everything seems fine...
                        processFullOrder(ordersToCheck[i],trackingInfo)
                    } else {
                        // processPartialOrder(cancelledItems,ordersToCheck[i],trackingInfo);
                    }   
                } else if (order_status == 'Canceled') {
                    let lineItems = result.content.orders[0].order[0].lineitems[0].item;
                    processCancelledOrder(ordersToCheck[i],lineItems);
                    //nothing shipped
                    //send email to customer
                }
                  
            });
        });
    }
}
function processCancelledOrder(orderObj, cancelledItems) {
    sendCustomerEmailAboutPartialOrder(orderObj,cancelledItems);
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
    // console.log();
    // console.log('shopify order id: ' + shopifyOrderId);
    fulfillOrder(shopifyOrderId,trackingInfo.shipmentCarrier,trackingInfo.trackingNumber);
    capturePayment(shopifyOrderId, orderObj.total_price);
}

function processPartialOrder(cancelledItems,orderObj,trackingInfo) {
    let partialAmountToSubtract = 0;
    let shopifyOrderId = orderObj.id;
    let shopifyOrderLineItems = orderObj.line_items;
    let cancelledItemsInShopify = [];
    for(let i = 0 ; i < cancelledItems.length; i++) {
        //account for quantity and discount
        //orderObj.line_items[0].discount_allocations[0].amount
        let ecnCancelledItemSKU = cancelledItems[i].sku[0];
        let ecnCancelledItemQuantity = Number(cancelledItems[i].cancelled[0]);
        let shopifyItem = shopifyOrderLineItems.find(item => ecnCancelledItemSKU == item.sku);

        let cancelledItemDiscount = shopifyItem.discount_allocations[0] ? shopifyItem.discount_allocations[0].amount : 0;
        
        cancelledItemsInShopify.push(shopifyItem);
        partialAmountToSubtract += ((shopifyItem.price * ecnCancelledItemQuantity) - cancelledItemDiscount);
    }
    let amountToCapture = orderObj.total_price - partialAmountToSubtract;
    fulfillOrder(shopifyOrderId,trackingInfo.shipmentCarrier,trackingInfo.trackingNumber);
    capturePayment(shopifyOrderId, amountToCapture);
    // sendCustomerEmailAboutPartialOrder(orderObj,cancelledItems);
}
async function fulfillOrder(order_id, shippingCompany, trackingNum) {
    let shippingCompanyForShopify = determineShippingCompany(shippingCompany);
    console.log('shipping Company: ' + shippingCompanyForShopify); 
    
    let fulfillmentURL = 'https://febe69a891c04a2e134443805cdcd304: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@try-sassy-box.myshopify.com/admin/api/2020-10/orders/' + order_id + '/fulfillments.json';
    let fulfillment = {
        "fulfillment": {
          "location_id": "15445622851",
          "tracking_number": trackingNum,
          "tracking_company": shippingCompany,
          "notify_customer": true
        }
    };
    axios.post(fulfillmentURL, fulfillment).then(function(){
        console.log('order has been fulfilled.. customer has been notified');
    }).catch(function(err){
        console.log('error sending order fulfillment!' + err)
        //error email here
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
    var options = {
        from: 'sassybox-dev@outlook.com',
        to: 'bluescript17@gmail.com',
        replyTo: 'contact@sassyboxshop.com',
        subject: 'Items cancelled from your order',
        html: ''
    };
    let lineItemsStr =  '';
    rejectedItems.forEach(item => {
        let ecn_item = order.line_items.find(shopify_item => shopify_item.sku == rejectedItems.sku[0]);
        let cancelledItemQty = ecn_item.cancelled[0];
        let cancelledItemDiscount = shopifyItem.discount_allocations[0] ? shopifyItem.discount_allocations[0].amount : 0;

        lineItemsStr += item.title + '   ' + 'QTY ' + cancelledItemQty + ' $' + (item.price - cancelledItemDiscount) + '\n';
    })
    let emailText = `Order Number: ${order.order_number}\n
    Order Date: ${order.created_at}\n\n

    Hi ${order.customer.first_name},\n
    Unfortunately, the items listed below are no longer available. We're sorry for any inconvenience! We'll send you an email when the rest of your order ships. (You won't be charged for these canceled items, of course.) \n\n
    Thank you for your patience, and please contact us by replying to this email if you have any questions or concerns.\n\n\n\n
    <u>Good To Know</u>\n
    Occasionally, we restock in-demand items. Keep an eye on <a href="sassyboxshop.com">SassyBoxShop.com</a> just in case.\n\n
    If you paid by credit or debit card, your statement may reflect an authorization. This is not a charge. In most cases, it will fall off your account within 3 - 5 business days. Contact your financial institution if you have any issues.\n\n\n
    <u>Your Cancelled Items</u>\n`;
    emailText += lineItemsStr + '\n\n';
    emailText += `<u>Shipping</u>\n
    <b>Ship To</b>\n
    ${order.shipping_address.first_name} ${order.shipping_address.last_name}\n
    ${order.shipping_address.address1}\n
    ${order.shipping_address.address2}\n
    ${order.shipping_address.city}, ${order.shipping_address.province}\n
    ${order.shipping_address.country} \n\n
    <b>Shipping Method</b>\n
    ${order.shipping_lines[0].title}\n\n
    <u>Billing</u>\n
    <b>Bill To</b>\n
    ${order.billing_address.first_name} ${order.billing_address.last_name}\n
    ${order.billing_address.address1}\n
    ${order.billing_address.address2}\n
    ${order.billing_address.city}, ${order.billing_address.province}\n
    ${order.billing_address.country} \n\n
    
    <b>Payment Method</b>\n
    ${order.payment_details.credit_card_company}\n
    ${order.payment_details.credit_card_number}\n\n\n`;
    options.html = emailText;

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
        return 'DHL eCommerce';
    }
    if(shippingCompany.includes('USPS')) {
        return 'USPS';
    }
    if(shippingCompany.includes('UPS')) {
        return 'UPS';
    }
    if(shippingCompany.includes('FedEx')) {
        return 'FedEx';
    }
}