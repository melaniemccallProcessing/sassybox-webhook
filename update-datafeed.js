const axios = require('axios');
var xmlParser = require('xml2js');
var fs = require('fs');
var nodemailer = require('nodemailer');
var exclusion_list = require('./products-to-exclude');

const {
  triggerAsyncId
} = require('async_hooks');
const {
  create
} = require('domain');
// import { GraphQLClient, gql } from 'graphql-request'

var transporter = nodemailer.createTransport({
  service: 'outlook',
  auth: {
    user: 'sassybox-dev@outlook.com',
    pass: 'ReadyToLaunch2020'
  }
});

let todaysDate = new Date(Date.now());
var mailOptions = {
  from: {
      name: 'SassyBox Shop',
      address: 'sassybox-dev@outlook.com'
  },
  to: 'sassybox-dev@outlook.com',
  replyTo: 'contact@sassyboxshop.com',
  subject: 'DataFeed Update',
  html: ''
};
var xmlMailOptions = {
  from: {
      name: 'SassyBox Shop',
      address: 'sassybox-dev@outlook.com'
  },
  to: 'sassybox-dev@outlook.com',
  replyTo: 'contact@sassyboxshop.com',
  subject: 'DataFeed XML',
  text: ''
};
let updatedItems = [];
let newItems = [];
let deletedItems = [];

updateShopifyWithECNDataFeed();


async function updateShopifyWithECNDataFeed() {
  let grabDataFeedUrl = 'http://feed.adultdropshipper.com/ecnFeed.cfm?act=read&siteID=508&passKey=2A62698BC5DC612F3A8E1AEC93C718BD'


  axios.get(grabDataFeedUrl)
    .then(response => {
      // await parseXML
      var parser = new xmlParser.Parser();
      // let result;
      // fs.readFile(__dirname + '/test-small-batch.xml', function(err, data) {
      // sendXMLEmail(response.data);  
      parser.parseString(response.data, function (err, result) {
          initUpdate(result);
        });
      // });
    })
    .catch(response => {
      console.log('Error grabbing the latest' + response);
      sendErrEmail(response);
    })

}

async function initUpdate(result) {
  let modifyItems = result.content.modify[0].item ? result.content.modify[0].item : [];
  let addItems = result.content.add[0].item ? result.content.add[0].item : [];
  let deleteItems = result.content.delete[0].item ? result.content.delete[0].item : [];
  if (!modifyItems.length && !addItems.length && !deleteItems.length) {
    console.log("No new updates here");
    timeCommit();

    return;
  }
  //
  modifyItems = modifyItems.concat(addItems);
  // console.log(modifyItems.findIndex(item => item.alternatetitle == 'Prowler Red Military Cap 61cm - Black/Gray'));
  let itemsToUpdate = await parseXML(modifyItems, 'update');
  let itemsToDelete;
  if (deleteItems) {
    itemsToDelete = await parseXML(deleteItems, 'delete');
  } else {
    itemsToDelete = [];
  }

  let allItemsToParse = itemsToUpdate.concat(itemsToDelete);
  console.log('Total items to parse: ' + allItemsToParse.length);

  let chunkedArraysToParse = chunk(allItemsToParse, 200);
  console.log('Total chunks: ' + chunkedArraysToParse.length);
  // console.log('waiting for items to parse...');

  for (let i = 0; i < chunkedArraysToParse.length; i++) {
    console.log('Chunk#' + (i + 1) + ' of' + chunkedArraysToParse.length + '------->');
    await updateProductsAvailability(chunkedArraysToParse[i]);
  }
  timeCommit();
  sendEmail(updatedItems,newItems,deletedItems);

}

function chunk(array, size) {
  const chunked_arr = [];
  for (let i = 0; i < array.length; i++) {
    const last = chunked_arr[chunked_arr.length - 1];
    if (!last || last.length === size) {
      chunked_arr.push([array[i]]);
    } else {
      last.push(array[i]);
    }
  }
  return chunked_arr;
}

function timeCommit() {
  axios({
    url: 'http://feed.adultdropshipper.com/ecnFeed.cfm?act=update&siteID=508&passkey=2A62698BC5DC612F3A8E1AEC93C718BD',
    method: 'get'
  }).then(() => {
    console.log("time commit successful");
  }).catch(err => {
    console.log("Error updating time commit"+ err)
  });
}

function parseXML(itemsToLoop, action) {
  let arrToReturn = [];
  for (let i = 0; i < itemsToLoop.length; i++) {
    let item = {};
    if (action == 'update') {
      if(Number(itemsToLoop[i]['multiplesOF'][0]) == 1) {
        item.title = itemsToLoop[i]['title'][0];
        item.sku = itemsToLoop[i]['itemSKU'][0];
        item.alternateTitle = itemsToLoop[i]['alternatetitle'][0];
        item.id = itemsToLoop[i]['itemID'][0];
        item.price = itemsToLoop[i]['standardPrice'][0];
        item.multiplesOf = itemsToLoop[i]['multiplesOF'][0];
        item.vendor = itemsToLoop[i]['manufacturer'][0];
        item.description = itemsToLoop[i]['itemDescription'][0];
        item.barcode = itemsToLoop[i]['upc'][0];
        item.image1 = 'https://s3.amazonaws.com/ecn-watermarks/effex/' + itemsToLoop[i]['itemID'][0] + '_2.jpg';
        item.image2 = 'https://s3.amazonaws.com/ecn-watermarks/effex/' + itemsToLoop[i]['itemID'][0] + '_1.jpg';
        let mastercategories = itemsToLoop[i].categoriesV2[0].categoritem[0].mastercategories[0].split("|");
        let subcategories = itemsToLoop[i].categoriesV2[0].categoritem[0].subcategories[0].split("|");
        let combined_categories = mastercategories.concat(subcategories);
        item.categories = combined_categories.filter(item => item != '');

        item.stock = itemsToLoop[i]['stock'][0];
        item.modifyAction = 'update';
        arrToReturn.push(item);

      }
    }
    if (action == 'delete') {
      item.sku = itemsToLoop[i]['itemSKU'][0];
      item.modifyAction = 'delete';
      arrToReturn.push(item);

    }
  }
  return arrToReturn;
}

async function updateProductsAvailability(itemsToUpdate) {
  // let productIds = [];
  let itemsWithProductIds = [];
  for (let i = 0; i < itemsToUpdate.length; i++) {
    // console.log(itemsToUpdate[i]);
    await getProductId(itemsToUpdate[i]).then(result => {
      if (result.data.data.productVariants.edges.length) {
        itemsToUpdate[i].product_id = result.data.data.productVariants.edges[0].node.product.id;
        itemsWithProductIds.push(itemsToUpdate[i]);
      } else {
        itemsToUpdate[i].product_id = '';
        itemsWithProductIds.push(itemsToUpdate[i]);
      }
      //   console.log();
    }).catch(err => {
      console.log('Error getting product id');
    })
  }
  // console.log(itemsWithProductIds);
  for (let i = 0; i < itemsWithProductIds.length; i++) {
    if (itemsWithProductIds[i].modifyAction == 'update') {
      if (itemsWithProductIds[i].product_id) {
        await getProductInfo(itemsWithProductIds[i].product_id).then(result => {
          // console.log(result.data);
          let productinShopify = result.data.data.product;

          if (productinShopify.tags.includes(itemsWithProductIds[i].stock)) {
            console.log(`no changes here for ${itemsWithProductIds[i].title}, product status is the same`);
            // let tags = productinShopify.tags.filter(tag => tag !== 'Available Now' && tag !== 'Short Wait' && tag !== 'Call your Rep for Availability' && tag !== 'Not Available' && tag !== 'Long Wait');
            // tags.push(itemsWithProductIds[i].stock);
            // let publishedStatus = itemsWithProductIds[i].stock == 'Available Now' ? true : false;
            // let product_id_withoutprefix = itemsWithProductIds[i].product_id.replace("gid://shopify/Product/", "")
            // let productUpdate = {
            //     "product": {
            //       "id": product_id_withoutprefix,
            //       "tags": tags,
            //       "published": publishedStatus
            //     }
            //   }
            //   makeProductUpdate(productUpdate).then(response => {
            //     // console.log(response);
            //     console.log(`product updated with new categories successfully-->${response.data.product.title}`);
            //     // console.log(response.data);
            //   }).catch(err=> {
            //       // console.log(err);
            //       console.log('ERROR UPDATING NEW CATEGORIES for product-->'+ productinShopify.title + ' ' + err)
            //   });  
          } else { //stock statuses are not the same
            // console.log(`Retrieved status from ECN for ${itemsWithProductIds[i].title} : ${itemsWithProductIds[i].stock} --> Shopifys status ${productinShopify.publishedAt},Shopifys tags ${productinShopify.tags}`)
              let tags = productinShopify.tags.filter(tag => tag !== 'Available Now' && tag !== 'Short Wait' && tag !== 'Call your Rep for Availability' && tag !== 'Not Available' && tag !== 'Long Wait');
              tags.push(itemsWithProductIds[i].stock);
              tags = tags.concat(itemsWithProductIds[i].categories);
              tags = filterUnwantedProductsFromCategories(tags, itemsWithProductIds[i].sku);

              let product_id_withoutprefix = itemsWithProductIds[i].product_id.replace("gid://shopify/Product/", "")
              let productUpdate = {
                "product": {
                  "id": product_id_withoutprefix,
                  "tags": tags,
                  "published": itemsWithProductIds[i].stock == 'Available Now' ? true : false
                }
              }
              // console.log(`this product${itemsWithProductIds[i].title} is active, but its stock status is ${itemsWithProductIds[i].stock}`);
              makeProductUpdate(productUpdate).then(response => {
                // console.log(response);
                console.log(`product updated successfully-->${response.data.product.title}`);
                updatedItems.push({name:response.data.product.title, status:itemsWithProductIds[i].stock});
                // console.log(response.data);
              }).catch(err => {
                // console.log(err);
                console.log('ERROR UPDATING PRODUCT-->' + productinShopify.title + ' ' + err);
              });
            
          }

        }).catch(err => {
          console.log('ERROR GETTING PRODUCT INFO' + err.data);
        })

      } else { //Create product that doesn't exist
        let productTitle = itemsWithProductIds[i].alternateTitle == ' ' || itemsWithProductIds[i].alternateTitle == '' ? itemsWithProductIds[i].title : itemsWithProductIds[i].alternateTitle;
        if (!itemsWithProductIds[i].categories.includes('Displays') && !itemsWithProductIds[i].categories.includes('Condom Bowls') && !itemsWithProductIds[i].categories.includes('Tester') && !itemsWithProductIds[i].categories.includes('Fishbowl') && !itemsWithProductIds[i].categories.includes('Cbd') && !productTitle.includes('Hemp') && !isBadVendor(itemsWithProductIds[i].vendor) && !isBadProduct(itemsWithProductIds[i].sku) && !productTitle.includes('bowl') && !productTitle.includes('Bowl') && !productTitle.includes('Display') && !productTitle.includes('Case') && !productTitle.includes('CD') && !productTitle.includes('disc')) {
          await createProduct(itemsWithProductIds[i]).then(response => {
            console.log(`Product created successfully--> ${response.data.product.title}`);
            newItems.push(response.data.product.title);
          }).catch(err => {
            console.log(`ERROR creating product ${err}`);
          })
        } else {
          console.log('Not creating item because its a display, bowl, CBD product, OR it is an unwanted vendor-->' + itemsWithProductIds[i].title)
        }
      }
    } else { //"Delete" products by unpublishing them
      if (itemsWithProductIds[i].product_id) {
        let product_id_withoutprefix = itemsWithProductIds[i].product_id.replace("gid://shopify/Product/", "")
        let productUpdate = {
          "product": {
            "id": product_id_withoutprefix,
            "tags": ['DELETED'],
            "published": false
          }
        }
        await makeProductUpdateASYNC(productUpdate).then(response => {
          console.log(`product "deleted" successfully${response.data.product.title}`);
          deletedItems.push(response.data.product.title);
        }).catch(err => {
          console.log('ERROR deleting product' + err.data);
          //send err email for error deleting product
        });

      } else {
        console.log("tried to delete an item but it doesn't exist, oh well!")
      }
    }
  }

  console.log('Datafeed parsing done!')


}

async function makeProductUpdateASYNC(obj) {
  return axios({
    url: 'https://febe69a891c04a2e134443805cdcd304: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@try-sassy-box.myshopify.com/admin/api/2020-10/products/' + obj.product.id + '.json',
    method: 'put',
    data: obj
  })
}

function makeProductUpdate(obj) {
  return axios({
    url: 'https://febe69a891c04a2e134443805cdcd304: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@try-sassy-box.myshopify.com/admin/api/2020-10/products/' + obj.product.id + '.json',
    method: 'put',
    data: obj
  })
}
async function getProductId(item) {
  const endpoint = 'https://try-sassy-box.myshopify.com/admin/api/2020-10/graphql.json'
  return axios({
    url: endpoint,
    method: 'post',
    headers: {
      'X-Shopify-Access-Token': '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',
    },
    data: {
      query: `
          {
            productVariants(first: 1, query: "sku:${item.sku}") {
              edges {
                node {
                  id
                  product {
                    id
                  }
                }
              }
            }
          }
          `
    }
  });
}
async function getProductInfo(product_id) {
  const endpoint = 'https://try-sassy-box.myshopify.com/admin/api/2020-10/graphql.json'
  return axios({
    url: endpoint,
    method: 'post',
    headers: {
      'X-Shopify-Access-Token': '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',
    },
    data: {
      query: `
            {
                product(id: "${product_id}") {
                  title
                  tags
                  publishedAt
                }
              }
            `
    }
  });
}

function isBadVendor(vendor) {
  let mapArray = ["Shane's World","Hott Products",'Screaming O','Golden Triangle','Adventure Industries, Llc','Bellesa Enterprises Inc','Betru Wellness','Channel 1 Releasing','Cyrex Ltd','East Coast New Nj','Even Technology Co Limited','Flawless 5 Health','Global Protection Corp','Hemp Bomb','Issawrap Inc/p.s. Condoms','Lix Tongue Vibes','Nori Fields Llc','Ohmibod','Old Man China Brush','Phe','Random House, Inc','Rapture Novelties','Rejuviel','Rock Candy Toys','Signs of Life Inc.','Solevy Co','Streem Master','Stud 100', 'Ticklekitty Press', 'Tongue Joy', 'Zero Tolerance', 'Gnarly Ride Inc', 'Little Genie', 'Little Genie Productions Llc.', 'Bijoux Indiscrets', 'Wallace - O Farrell,inc.', 'Icon Brands Inc', 'Abs Holdings', 'Agb Dba Spartacus Enterprises', 'Ball & Chain', 'Ball and Chain', 'Body Action', 'Creative Conceptionsl Llc', 'Dona', 'Emotion Lotion', 'Hustler', 'Id Lubes', 'Joydivision Llc', 'Kingman Industries, Inc', 'Ky','Me','New Concepts - Deeva','Ozze Creations', 'Private Label Productions Llc', 'TP3 LLC', 'Thredly.com', 'Wet Lubes', 'Cousins Group Inc', 'Paradise Marketing Services Pm', 'Carrashield Labs dba Devine 9', 'Novelties By Nass-walk Inc','Tantus, Inc','Topco Sales','Lovehoney, Llc','Adam & Eve','Adam and Eve','Bedroom Products Llc','Evolved Novelties','Fredericks Of Hollywood','Savvy Co Llc','Baci Lingerie','Barely Bare','Leg Avenue Inc.','Prowler','Secrets', 'CB-6000', 'Pink/gun Oil', 'Fuck Sauce','Rocks Off Ltd Usa','Arcwave','', ' ', 'Big Teaze Toys','Kangaroo','South Gator Oils','B.m.s. Enterprises','Fleshlight','Hitachi Majic','Jimmy Jane - Jj Acquisition Llc','Lelo','Novel Creations Usa Inc','Pjur','Rabbit Co.','Emojibator','Perfect Fit Brand Inc.','Pixelrise Llc','Shots America Llc','Ananda Health','East Coast News Nj','Bijoux Indiscets, Sl','Celebrity Knights Llp','Concepts Of Love Rianne S','Hunkyjunk','Ovo','Signs Of Life Inc.','Vedo Toys','Aneros','Bodywand','Rascal Toys','Kiiroo Bv','B. Cumming Company, Inc.','Hitachi Majic Wand','Mimic','New Earth Trading','Novel Creations Usa Inc','Shots America LLC','West Market','Zumio Inc','Lux Fetish','Kama Sutra Company','B.m.s Enterprises', 'Whip Smart', 'Medina Inc'];
  return mapArray.includes(vendor);
}

function isBadProduct(product_sku) {
  let unwantedProducts = exclusion_list.productsToExclude;
  return unwantedProducts.includes(product_sku);
}

async function createProduct(item) {
  let productImages = [];
  let isAnyImageAvailable = item.image1 || item.image2;
  let isThereADescription = item.description;
  let unpublishable = !isAnyImageAvailable || !isThereADescription;
  if (item.image1) {
    productImages.push({
      "src": item.image1
    })
  }
  if (item.image2) {
    productImages.push({
      "src": item.image2
    })
  }
  // if (item.description) {
    let product_tags = item.categories.concat(item.stock);
    if(!isAnyImageAvailable) {
      product_tags.push('No Image')
    }
    if(!isThereADescription) {
      product_tags.push('No Description')
    }
    product_tags.push('New');
    if((product_tags.includes('Vibrators') && product_tags.includes('Remote Control')) || (product_tags.includes('Vibrators') && product_tags.includes('App Compatible')) ) {
      product_tags.push('remote-vibrator');
    }
    let newProductObj = {
      "product": {
        "title": item.alternateTitle == ' ' || item.alternateTitle == '' ? item.title : item.alternateTitle,
        "body_html": item.description,
        "vendor": item.vendor,
        "product_type": item.id,
        "tags": product_tags,
        "variants": [{
          "title": "Default Title",
          "price": item.price * 2,
          "sku": item.sku,
          "inventory_policy": "continue",
          "fulfillment_service": "manual",
          "inventory_management": "shopify",
          "taxable": true,
          "barcode": item.barcode,
          "grams": 0,
          "weight": 0,
          "weight_unit": "lb",
          "inventory_quantity": 0,
          "requires_shipping": true,

        }],
        "images": productImages,
        "published": item.stock == 'Available Now' && !unpublishable ? true : false
      }
    }
    // console.log(newProductObj);
    return axios({
      url: 'https://febe69a891c04a2e134443805cdcd304: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@try-sassy-box.myshopify.com/admin/api/2020-10/products.json',
      method: 'post',
      data: newProductObj
    }); 
    //tag with- grammarCheck
  // } else {
    // console.log("no item description for-- " + item.title + " not making this");
  // }
}

function sendEmail(updatedItems,newItems,deletedItems) {
  let strToSend = '<b>Datafeed Updates: </b><br><br>';

  if (newItems) {
    let newItemsFiltered =  newItems.filter(product => !deletedItems.includes(product));
    let newItemsStr = '';
    newItemsFiltered.forEach(product => {
      newItemsStr += product + '<br>'
    });
    strToSend += '<b>New Items:</b><br>' + newItemsStr + '<br>';
  }
  if(updatedItems) {
    let updatedItemsFiltered =  updatedItems.filter(product => !deletedItems.includes(product.name));
    let updatedItemsStr = '';
    updatedItemsFiltered.forEach(product => {
      updatedItemsStr += product.name + '--------- New Status: ' + product.status + '<br>'
    });
    strToSend += '<b>Updated Items:</b><br>' + updatedItemsStr + '<br>';
  }
  if(deletedItems) {
    let deletedItemsStr = '';
    deletedItems.forEach(product => {
      deletedItemsStr += product + '<br>'
    });
    strToSend += '<b>Deleted Items:</b><br>' + deletedItemsStr + '<br>';
  }
  mailOptions.html = strToSend;
  transporter.sendMail(mailOptions, function(err, info){
    if (err) {
      console.log('error sending update email' + err);
    } else {
      console.log('Update email sent: ' + info.response);
    }
  });
  
}
function sendErrEmail(error) {
  mailOptions.html = 'Error Getting Datafeed <br>' + error;
  transporter.sendMail(mailOptions, function(err, info){
    if (err) {
      console.log('error sending error email' + err);
    } else {
      console.log('Update email sent: ' + info.response);
    }
  });
  
}
function sendXMLEmail(xml) {
  xmlMailOptions.text = xml;
  transporter.sendMail(xmlMailOptions, function(err, info){
    if (err) {
      console.log('error sending XML email' + err);
    } else {
      console.log('XML email sent: ' + info.response);
    }
  });
}
function filterUnwantedProductsFromCategories(tags, sku) {
  let categoriesToReturn = tags;
  if (categoriesToReturn.includes('Bondage & Fetish') && isBadBondageAndFetish(sku)){
    console.log('Removing tag--Bondage & Fetish from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Bondage & Fetish');
  }
  if (categoriesToReturn.includes('Masturbators & Strokers') && isBadMasturbator(sku)){
    console.log('Removing tag--Masturbators & Strokers from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Masturbators & Strokers');
  }
  if ((categoriesToReturn.includes('Anal Beads') || categoriesToReturn.includes('Anal Masturbator') || categoriesToReturn.includes('Anal Plug') || categoriesToReturn.includes('Anal Stimulation'))  && isBadAnalToy(sku)){
    console.log('Removing tag-- Anal Toys from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Anal Beads' && cat !== 'Anal Masturbator' && cat !== 'Anal Plug' && cat !== 'Anal Stimulation');
  }
  if (categoriesToReturn.includes('Cockrings') && isBadCockring(sku)){
    console.log('Removing tag--Cockrings from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Cockrings');
  }
  if (categoriesToReturn.includes('Lingerie') && isBadLingerie(sku)){
    console.log('Removing tag--Lingerie from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Lingerie');
  }
  if (categoriesToReturn.includes('Bath & Body') && isBadBathAndBody(sku)){
    console.log('Removing tag--Bath & Body from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Bath & Body');
  }
  if (categoriesToReturn.includes('Vibrators') && isBadVibrator(sku)){
    console.log('Removing tag--Vibrators from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Vibrators');
  }
  if (categoriesToReturn.includes('Realistic Dongs') && isBadRealDildo(sku)){
    console.log('Removing tag--Realistic Dongs from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Realistic Dongs');
  }
  if ((categoriesToReturn.includes('Silicone') && categoriesToReturn.includes('Dildos & Dongs')) && isBadSiliconeDildo(sku)){
    console.log('Removing tag--Silicone Dildo from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Silicone');
  }
  if ((categoriesToReturn.includes('Kit') && categoriesToReturn.includes('Couples')) && isBadCouplesKit(sku)){
    console.log('Removing tag--Couples Kit from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Couples');
  }
  if (categoriesToReturn.includes('Remote Control') && isBadRemoteControl(sku)){
    console.log('Removing tag--Remote Control from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Remote Control');
  }
  if (categoriesToReturn.includes('Lotion') && isBadLotion(sku)){
    console.log('Removing tag--Lotion from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Lotion');
  }
  if (categoriesToReturn.includes('Kit') && isBadKit(sku)){
    console.log('Removing tag--Kit from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Kit');
  }
  if (categoriesToReturn.includes('Gels & Creams') && isBadGel(sku)){
    console.log('Removing tag--Gels & Creams from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Gels & Creams');
  }
  if (categoriesToReturn.includes('Water Based') && isBadWaterBased(sku)){
    console.log('Removing tag--Water Based from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Water Based');
  }
  if (categoriesToReturn.includes('Massage Oils') && isBadMassageOil(sku)){
    console.log('Removing tag--Massage Oils from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Massage Oils');
  }
  
  if (categoriesToReturn.includes('Lubricants') && isBadLubricant(sku)){
    console.log('Removing tag--Lubricants from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Lubricants');
  }
  if (categoriesToReturn.includes('Dildos & Dongs') && isBadDildo(sku)){
    console.log('Removing tag--Dildos & Dongs from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Dildos & Dongs');
  }
  if (categoriesToReturn.includes('Bendable') && isBadBendable(sku)){
    console.log('Removing tag--Bendable from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Bendable');
  }
  if (categoriesToReturn.includes('Mouth Masturbator') && isBadMouthMasturbator(sku)){
    console.log('Removing tag--Mouth Masturbator from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Mouth Masturbator');
  }
  if (categoriesToReturn.includes('Double Dongs') && isBadDoubleDildo(sku)){
    console.log('Removing tag--Double Dongs from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Double Dongs');
  }
  if (categoriesToReturn.includes('Anal Plug') && isBadAnalPlug(sku)){
    console.log('Removing tag--Anal Plug from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Anal Plug');
  }
  if (categoriesToReturn.includes('Games') && isBadGame(sku)){
    console.log('Removing tag--Game from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Games');
  }
  if (categoriesToReturn.includes('Novelty Items') && isBadNoveltyItem(sku)){
    console.log('Removing tag--Novelty Items from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Novelty Items');
  }
  if (categoriesToReturn.includes('Harness Accessories') && isBadHarnessAccessory(sku)){
    console.log('Removing tag--Harness Accessories from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Harness Accessories');
  }
  if (categoriesToReturn.includes('strap-on') && isBadStrapOn(sku)){
    console.log('Removing tag-- strap-on from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'strap-on');
  }
  if (categoriesToReturn.includes('Accessories') && isBadAccessory(sku)){
    console.log('Removing tag-- Accessories from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Accessories');
  }
  if (categoriesToReturn.includes('Kit') && isBadKit(sku)){
    console.log('Removing tag-- Kit from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Kit');
  }
  if (categoriesToReturn.includes('Bath Time Play') && isBadBathTimePlay(sku)){
    console.log('Removing tag-- Bath Time Play from product: ' + sku)
    categoriesToReturn = categoriesToReturn.filter(cat => cat !== 'Bath Time Play');
  }
  return categoriesToReturn;
}

function isBadBondageAndFetish(sku) {
  let unwantedProducts = exclusion_list.unwantedBondageProducts;
  return unwantedProducts.includes(sku);
}
function isBadBathAndBody(sku) {
  let unwantedProducts = exclusion_list.unwantedBathAndBodyProducts;
  return unwantedProducts.includes(sku);
}

function isBadMasturbator(sku) {
  let unwantedProducts = exclusion_list.unwantedMasturbatorProducts;
  return unwantedProducts.includes(sku);
}

function isBadAnalToy(sku) {
  let unwantedProducts = exclusion_list.unwantedAnalToyProducts;
  return unwantedProducts.includes(sku);
}

function isBadCockring(sku) {
  let unwantedProducts = exclusion_list.unwantedCockringProducts;
  return unwantedProducts.includes(sku);
}

function isBadLingerie(sku) {
  let unwantedProducts = exclusion_list.unwantedLingerieProducts;
  return unwantedProducts.includes(sku);
}

function isBadVibrator(sku) {
  let unwantedProducts = exclusion_list.unwantedVibratorProducts;
  return unwantedProducts.includes(sku);
}
function isBadRealDildo(sku) {
  let unwantedProducts = exclusion_list.unwantedRealisticDildo;
  return unwantedProducts.includes(sku);
}
function isBadSiliconeDildo(sku) {
  let unwantedProducts = exclusion_list.unwantedSiliconeDildo;
  return unwantedProducts.includes(sku);
}
function isBadCouplesKit(sku) {
  let unwantedProducts = exclusion_list.unwantedCoupleKits;
  return unwantedProducts.includes(sku);
}
function isBadRemoteControl(sku) {
  let unwantedProducts = exclusion_list.unwantedRemoteControlProducts;
  return unwantedProducts.includes(sku);
}
function isBadLotion(sku) {
  let unwantedProducts = exclusion_list.unwantedLotionProducts;
  return unwantedProducts.includes(sku);
}
function isBadKit(sku) {
  let unwantedProducts = exclusion_list.unwantedKitProducts;
  return unwantedProducts.includes(sku);
}
function isBadGel(sku) {
  let unwantedProducts = exclusion_list.unwantedGelsAndCreams;
  return unwantedProducts.includes(sku);
}
function isBadWaterBased(sku) {
  let unwantedProducts = exclusion_list.unwantedWaterBased;
  return unwantedProducts.includes(sku);
}
function isBadLubricant(sku) {
  let unwantedProducts = exclusion_list.unwantedLubricants;
  return unwantedProducts.includes(sku);
}
function isBadMassageOil(sku) {
  let unwantedProducts = exclusion_list.unwantedMassageOil;
  return unwantedProducts.includes(sku);
}
function isBadDildo(sku) {
  let unwantedProducts = exclusion_list.unwantedDildos;
  return unwantedProducts.includes(sku);
}
function isBadBendable(sku) {
  let unwantedProducts = exclusion_list.unwantedBendable;
  return unwantedProducts.includes(sku);
}
function isBadMouthMasturbator(sku) {
  let unwantedProducts = exclusion_list.unwantedMouthMasturbator;
  return unwantedProducts.includes(sku);
}
function isBadDoubleDildo(sku) {
  let unwantedProducts = exclusion_list.unwantedDoubleDildo;
  return unwantedProducts.includes(sku);
}
function isBadAnalPlug(sku) {
  let unwantedProducts = exclusion_list.unwantedAnalPlug;
  return unwantedProducts.includes(sku);
}
function isBadBathTimePlay(sku) {
  let unwantedProducts = exclusion_list.unwantedBathTimePlay;
  return unwantedProducts.includes(sku);
}
function isBadKit(sku) {
  let unwantedProducts = exclusion_list.unwantedKits;
  return unwantedProducts.includes(sku);
}
function isBadStrapOn(sku) {
  let unwantedProducts = exclusion_list.unwantedStrapOn;
  return unwantedProducts.includes(sku);
}
function isBadAccessory(sku) {
  let unwantedProducts = exclusion_list.unwantedAccessories;
  return unwantedProducts.includes(sku);
}
function isBadHarnessAccessory(sku) {
  let unwantedProducts = exclusion_list.unwantedHarnessAccessories;
  return unwantedProducts.includes(sku);
}
function isBadNoveltyItem(sku) {
  let unwantedProducts = exclusion_list.unwantedNoveltyItems;
  return unwantedProducts.includes(sku);
}
function isBadGame(sku) {
  let unwantedProducts = exclusion_list.unwantedGames;
  return unwantedProducts.includes(sku);
}