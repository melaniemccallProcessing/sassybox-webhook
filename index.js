
const express = require('express')
const app = express()
const getRawBody = require('raw-body')
const crypto = require('crypto')
const secretKey = '173db07ef1c2e6c11ad41d4ad0a427035ae1b39a301056a75897232da5e839c0'
const axios = require('axios');
var parseString = require('xml2js');
var FormData = require('form-data');
var request = require('request');


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
    let xmlStr = `<?xml version="1.0" encoding="ISO-8859-1"?>
    <orders>
        <order>
            <orderheader>
                <refordernumber>${order.id}</refordernumber>
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
                <shiptostate>${order.shipping_address.province}</shiptostate>
                <shiptozip>${order.shipping_address.zip}</shiptozip>
                <shiptocountry>${order.shipping_address.country}</shiptocountry>
                <genericshippingmethodid>6</genericshippingmethodid>
                <invoiceheaderbase64></invoiceheaderbase64>
                <fillstatusid></fillstatusid>
                <packingincludesid></packingincludesid>
                <orderpauselevelid></orderpauselevelid>			
                <invoicefootertext></invoicefootertext>
                <signatureconfirmationid>0</signatureconfirmationid>
                <insuranceid></insuranceid>
                <saturdaydeliveryid></saturdaydeliveryid>
            </orderheader>
            <lineitems>`
            ;
    let itemsPromise = new Promise((resolve, reject) => {
        let itemsToOrder = order.line_items.filter((item)=> {return item.title != 'Route Package Protection'});            
        itemsToOrder.forEach((item,index) => {

            //products that aren't from route app
                let product_type;
                console.log(item.product_id);
                let url = 'https://febe69a891c04a2e134443805cdcd304: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@try-sassy-box.myshopify.com/admin/api/2020-10/products/' + item.product_id + '.json?fields=product_type';

                axios.get(url)
                .then(response => {
                    console.log(response.data.product.product_type);
                    product_type = response.data.product.product_type;
                xmlStr +=`<item>
                        <itemSKU>${item.sku}</itemSKU>
                        <itemid>${product_type}</itemid>
                        <quantity>${item.quantity}</quantity>
                        <price>${item.price}</price>
                    </item>`;
                    console.log(index);
                    if(index == itemsToOrder.length - 1) {
                        resolve();
                    }
                })
                .catch(error => {
                    console.log(error);
                });
        });})
    .then(()=> {
        xmlStr += `</lineitems>
        </order>
        </orders>`;
       
        let order_url = 'http://adultshipper.com/back/processxmlorder2.cfm?passkey=7951D77D8D073EFC27A6138CCBC9FC4C&clientID=6678&storeid=791';
        // var form = new FormData();
        // form.append('processxmlorder', xmlStr);
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
            if (error) throw new Error(error);
            console.log(response.body);
        });

        //  console.log(xmlStr);
        //  console.log(form);
        //  var config = {
        //     method: 'post',
        //     url: order_url,
        //     headers: { 
        //       ...form.getHeaders()
        //     },
        //     data : form
        //   };
        //   console.log(form.getBuffer());
        //   axios(config)
        //   .then(function (response) {
        //     console.log(JSON.stringify(response.data));
        //   })
        //   .catch(function (error) {
        //     console.log(error);
        //   });
          
        
    })

  } else {
    // No match! This request didn't originate from Shopify
    console.log('Danger! Not from Shopify!')
    res.sendStatus(403)
  }
})

app.listen(8000, () => console.log('Example app listening on port 8000!'))

