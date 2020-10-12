
const express = require('express')
const app = express()
const getRawBody = require('raw-body')
const crypto = require('crypto')
const secretKey = '173db07ef1c2e6c11ad41d4ad0a427035ae1b39a301056a75897232da5e839c0'
const axios = require('axios');
var xmlParser = require('xml2js');
// var FormData = require('form-data');
var request = require('request');
var nodemailer = require('nodemailer');
var shipping = require('./shipping.js');

var transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'bluescript17@gmail.com',
      pass: 'Mary_jewel23'
    }
  });
  
var errorMailOptions = {
    from: 'bluescript17@gmail.com',
    to: 'bluescript17@gmail.com',
    subject: 'Error with Processing Order #',
    text: ''
};

 let xmlTest = '<?xmlversion="1.0"encoding="ISO-8859-1"?> <content> <orders> <order> <orderid></orderid> <refordernumber></refordernumber> <clientid></clientid> <clientstoreid></clientstoreid> <status></status> <genericshippingmethodid></genericshippingmethodid> <lineitems> <item> <str_sku></str_sku> <itemid></itemid> <price></price> <quantity></quantity> </item> </lineitems> </order> </orders> <rejectedorders> <ro_order> <ro_refordernumber>000</ro_refordernumber> <ro_clientid>6678</ro_clientid> <ro_clientstoreid>791</ro_clientstoreid> <ro_rejectedreason>CustomerCountryisnotapproved</ro_rejectedreason> </ro_order><ro_order> <ro_refordernumber>000</ro_refordernumber> <ro_clientid>6678</ro_clientid> <ro_clientstoreid>791</ro_clientstoreid> <ro_rejectedreason>CustomerCountryisnotapproved</ro_rejectedreason> </ro_order> </rejectedorders> <itemsnotfound> <inf_item> <inf_refordernumber></inf_refordernumber> <inf_itemsku></inf_itemsku> <inf_itemid></inf_itemid> <inf_rejectedreason></inf_rejectedreason> </inf_item> <inf_item> <inf_refordernumber></inf_refordernumber> <inf_itemsku></inf_itemsku> <inf_itemid></inf_itemid> <inf_rejectedreason></inf_rejectedreason> </inf_item> </itemsnotfound> </content>';
//  xmlParser.parseString(xmlTest, function(err,result) {
    //  console.log(result['content']['orders'][0]['order'][0]['orderid'][0]);
//  })
 let attemptedXML = '';
app.post('/order', async (req, res) => {
  console.log('🎉 We got an order!')

  // We'll compare the hmac to our own hash
  const hmac = req.get('X-Shopify-Hmac-Sha256')

  // Use raw-body to get the body (buffer)
  const body = await getRawBody(req)

  // Create a hash using the body and our key
  const hash = crypto
    .createHmac('sha256', secretKey)
    .update(body, 'utf8', 'hex')
    .digest('base64')

  // Compare our hash to Shopify's hash
  if (hash === hmac) {
    // It's a match! All good
    console.log('Phew, it came from Shopify!')
    res.sendStatus(200)
    const order = JSON.parse(body.toString())
    // console.log(order);
    placeOrderToECN(order);
    

  } else {
    // No match! This request didn't originate from Shopify
    console.log('Danger! Not from Shopify!')
    res.sendStatus(403)
  }
})

app.listen(8000, () => console.log('Example app listening on port 8000!'))

function sendErrEmail(mailOptions){
    transporter.sendMail(mailOptions, function(err, info){
        if (err) {
          console.log('error sending error email' + err);
        } else {
          console.log('Error email sent: ' + info.response);
        }
    });
}
function sendErrEmailToCustomer(rejectedItems, order) {
    var options = {
        from: 'bluescript17@gmail.com',
        to: 'bluescript17@gmail.com',
        replyTo: 'contact@sassyboxshop.com',
        subject: 'Items cancelled from your order',
        html: ''
    };
    let lineItemsStr =  '';
    rejectedItems.forEach(item => {
        let line_item = order.line_items.find(item=> item.sku == rejectedItems.sku);
        lineItemsStr += line_item.title + '   ' + 'QTY ' + line_item.quantity + ' $' + line_item.price + '\n';
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

async function placeOrderToECN(order) {
    errorMailOptions.subject += order.order_number;
    let orderShippingId;

    if(order.shipping_lines.length) {
        orderShippingId = shipping.getShippingId(order.shipping_lines[0]['title']) ? shipping.getShippingId(order.shipping_lines[0]['title']) : 6;
    } else {
        orderShippingId = 6;
    }

    let xmlStr = `<?xml version="1.0" encoding="ISO-8859-1"?>
    <orders>
        <order>
            <orderheader>
                <refordernumber>${order.order_number}</refordernumber>
                <ordertotal>${order.total_price}</ordertotal>
                <clientid>6678</clientid>
                <clientstoreid>791</clientstoreid>
                <firstname>${order.customer.first_name}</firstname>
                <lastname>${order.customer.last_name}</lastname>
                <email>${order.customer.email}</email>
                <phone1>${order.customer.phone}</phone1>
                <phone2></phone2>
                <phone3></phone3>
                <shiptoaddress1>${order.shipping_address.address1}</shiptoaddress1>
                <shiptoaddress2>${order.shipping_address.address2}</shiptoaddress2>
                <shiptocity>${order.shipping_address.city}</shiptocity>
                <shiptostate>${order.shipping_address.province_code}</shiptostate>
                <shiptozip>${order.shipping_address.zip}</shiptozip>
                <shiptocountry>${order.shipping_address.country_code}</shiptocountry>
                <genericshippingmethodid>${orderShippingId}</genericshippingmethodid>
                <invoiceheaderbase64></invoiceheaderbase64>
                <fillstatusid>4</fillstatusid>
                <packingincludesid></packingincludesid>
                <orderpauselevelid></orderpauselevelid>			
                <invoicefootertext></invoicefootertext>
                <signatureconfirmationid>0</signatureconfirmationid>
                <insuranceid></insuranceid>
                <saturdaydeliveryid></saturdaydeliveryid>
            </orderheader>
            <lineitems>`
            ;
    // let itemsPromise = new Promise((resolve, reject) => {
        //products that aren't from route app
    let itemsToOrder = order.line_items.filter((item)=> {return item.title != 'Route Package Protection'});            
    console.log(itemsToOrder);    
    for(let index = 0; index < itemsToOrder.length; index++) {
                console.log(index);

                let product_type;
                let url = 'https://febe69a891c04a2e134443805cdcd304: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@try-sassy-box.myshopify.com/admin/api/2020-10/products/' + itemsToOrder[index].product_id + '.json?fields=product_type';

                await axios.get(url)
                .then(response => {
                    console.log(response.data.product.product_type);
                    product_type = response.data.product.product_type;
                xmlStr +=`<item>
                        <itemSKU>${itemsToOrder[index].sku}</itemSKU>
                        <itemid>${product_type}</itemid>
                        <quantity>${itemsToOrder[index].quantity}</quantity>
                        <price>${itemsToOrder[index].price}</price>
                    </item>`;
                })
                .catch(error => {
                    console.log(error);
                });
        };
        // console.log(xmlStr);
    // .then(()=> {
        xmlStr += `</lineitems>
        </order>
        </orders>`;
        attemptedXML += xmlStr;
        let order_url = 'http://adultshipper.com/back/processxmlorder2.cfm?passkey=7951D77D8D073EFC27A6138CCBC9FC4C&clientID=6678&storeid=791';
        console.log(xmlStr); 
        var options = {
            'method': 'POST',
            'url': order_url,
            'headers': {
            },
            formData: {
                'processxmlorder': xmlStr
            }
        };
        request(options, function (error, response) {
            if (error) {
                errorMailOptions.text = `Error sending order to ECN \n\n${error}`;
                errorMailOptions.text += `\n\nAttempted XML: \n\n ${attemptedXML}`;
                sendErrEmail(errorMailOptions);
                throw new Error(error);
            }
            xmlParser.parseString(response.body, function(err,result) {
                if(err){console.log(err)}
                let ecnOrderId = result['content']['orders'][0]['order'][0]['orderid'][0];
                let rejectedOrderReason = result.content.rejectedorders[0]['ro_order'][0].ro_rejectedreason[0];
                let rejectedItems = []; 
                let itemsNotFound = result.content.itemsnotfound[0]['inf_item'];
                itemsNotFound.forEach(item => {
                    let rejectedItem = {};
                    if(item['inf_itemsku'][0] != ' ') {
                        // console.l
                        rejectedItem.sku = item['inf_itemsku'][0];
                    }
                    if(item['inf_rejectedreason'][0] != ' ') {
                        rejectedItem.reason = item['inf_rejectedreason'][0];
                    }
                    if(Object.keys(rejectedItem).length) {
                        rejectedItems.push(rejectedItem);
                    }
                })
               if(rejectedOrderReason != ' ') {
                   console.log('Rejected items:' + rejectedItems);
                   console.log('Rejected Order Reason:' + rejectedOrderReason);
                   let mailText = '';
                   if(rejectedOrderReason) {
                      mailText += 'Rejected Order Reason:\n';
                      mailText += rejectedOrderReason + '\n\n';
                    }
                   if(rejectedItems.length > 0) {
                        mailText += 'Rejected Items In Order;\n';
                        rejectedItems.forEach(item => {
                            mailText += 'Item SKU: ' + item.sku + '\n';
                            mailText += 'Reason: ' + item.reason + '\n\n';
                        });
                          
                   }
                   errorMailOptions.text = mailText;
                   errorMailOptions.text += '\n\nAttempted XML: \n\n' + attemptedXML;
                    sendErrEmail(errorMailOptions);
            //    } else if (rejectedItems.length > 0 && !rejectedOrderReason) {
            //        sendErrEmailToCustomer(rejectedItems, order);
               } else {

                    let url = 'https://febe69a891c04a2e134443805cdcd304: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@try-sassy-box.myshopify.com/admin/api/2020-10/orders/' + order.id + '.json';

                    axios.put(url, {
                        "order": {
                        "id": order.id,
                        "tags": "ECN-Order-Placed, ECNORDERID-" + ecnOrderId
                        }
                    })
                    .then(response => {
                        console.log(response.data);
                        // let transactionAPIURL = 'https://febe69a891c04a2e134443805cdcd304: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@try-sassy-box.myshopify.com/admin/api/2020-10/orders/' + order.id + '/transactions.json';
                        // axios.get(transactionAPIURL).then( response => {
                        //     console.log(response.data);
                        //     let authorizationKey = response.data['transactions'][0].authorization;
                        //     let transactionAPIURL = 'https://febe69a891c04a2e134443805cdcd304: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@try-sassy-box.myshopify.com/admin/api/2020-10/orders/' + order.id + '/transactions.json';
                        //     axios.post(transactionAPIURL, {
                        //         "transaction": {
                        //             "kind": "capture",
                        //             "authorization": authorizationKey
                        //         }
                        //     }).then(response => {
                        //         console.log(response.data);
                        //     }).catch(error => {
                        //         console.log(error);
                        //     })
                        // })
                    })
                    .catch(error => {
                        console.log(error);
                    });
               }
                
            })
        });

    }

