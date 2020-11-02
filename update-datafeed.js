const axios = require('axios');
var xmlParser = require('xml2js');
var fs = require('fs');
const {
  triggerAsyncId
} = require('async_hooks');
const {
  create
} = require('domain');
// import { GraphQLClient, gql } from 'graphql-request'


updateShopifyWithECNDataFeed();


async function updateShopifyWithECNDataFeed() {
  let grabDataFeedUrl = 'http://feed.adultdropshipper.com/ecnFeed.cfm?act=read&siteID=508&passKey=2A62698BC5DC612F3A8E1AEC93C718BD'

  axios.get(grabDataFeedUrl)
    .then(response => {
      // await parseXML
      var parser = new xmlParser.Parser();
      // let result;
      // fs.readFile(__dirname + '/test-small-batch.xml', function(err, data) {
      parser.parseString(response.data, function (err, result) {
        initUpdate(result);
      });
      // });
    })
    .catch(response => {
      console.log('Error grabbing the latest' + response);
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
      item.weight = itemsToLoop[i]['itemweight'][0];
      let mastercategories = itemsToLoop[i].categoriesV2[0].categoritem[0].mastercategories[0].split("|");
      let subcategories = itemsToLoop[i].categoriesV2[0].categoritem[0].subcategories[0].split("|");
      let combined_categories = mastercategories.concat(subcategories);
      item.categories = combined_categories.filter(item => item != '');

      item.stock = itemsToLoop[i]['stock'][0];
      item.modifyAction = 'update';
    }
    if (action == 'delete') {
      item.sku = itemsToLoop[i]['itemSKU'][0];
      item.modifyAction = 'delete';

    }
    arrToReturn.push(item);

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
            // let tags = productinShopify.tags;
            // tags = tags.concat(itemsWithProductIds[i].categories);  

            // let product_id_withoutprefix = itemsWithProductIds[i].product_id.replace("gid://shopify/Product/", "")
            // let productUpdate = {
            //     "product": {
            //       "id": product_id_withoutprefix,
            //       "tags": tags
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
            if (productinShopify.publishedAt !== null) { //if product is published
              let tags = productinShopify.tags.filter(tag => tag !== 'Available Now');
              tags.push(itemsWithProductIds[i].stock);
              tags = tags.concat(itemsWithProductIds[i].categories);

              let product_id_withoutprefix = itemsWithProductIds[i].product_id.replace("gid://shopify/Product/", "")
              let productUpdate = {
                "product": {
                  "id": product_id_withoutprefix,
                  "tags": tags,
                  "published": false
                }
              }
              // console.log(`this product${itemsWithProductIds[i].title} is active, but its stock status is ${itemsWithProductIds[i].stock}`);
              makeProductUpdate(productUpdate).then(response => {
                // console.log(response);
                console.log(`product updated successfully-->${response.data.product.title}`);
                // console.log(response.data);
              }).catch(err => {
                // console.log(err);
                console.log('ERROR UPDATING PRODUCT-->' + productinShopify.title + ' ' + err);
              });
            } else if (productinShopify.publishedAt == null) { //if product is not published
              // console.log(`this product${itemsWithProductIds[i].title} is not active , but its stock status is ${itemsWithProductIds[i].stock}`);
              let tags = productinShopify.tags.filter(tag => tag !== 'Short Wait' && tag !== 'Call your Rep for Availability' && tag !== 'Not Available');
              tags.push('Available Now');
              tags = tags.concat(itemsWithProductIds[i].categories);
              let product_id_withoutprefix = itemsWithProductIds[i].product_id.replace("gid://shopify/Product/", "")
              let productUpdate = {
                "product": {
                  "id": product_id_withoutprefix,
                  "tags": tags,
                  "published": true
                }
              }
              // console.log(productUpdate);
              makeProductUpdate(productUpdate).then(response => {
                console.log(`product updated successfully-->${response.data.product.title}`);
                // console.log(response.data);
              }).catch(err => {
                console.log('ERROR UPDATING PRODUCT-->' + productinShopify.title + ' ' + err);
              });
            }
          }

        }).catch(err => {
          console.log('ERROR GETTING PRODUCT INFO' + err.data);
        })

      } else { //Create product that doesn't exist
        if (!itemsWithProductIds[i].categories.includes('Displays') && !itemsWithProductIds[i].categories.includes('Fishbowl') && !itemsWithProductIds[i].title.includes('CBD') && !isBadVendor(itemsWithProductIds[i].vendor) && !itemsWithProductIds[i].title.includes('bowl') && !itemsWithProductIds[i].title.includes('Bowl') && !itemsWithProductIds[i].title.includes('Display') && !itemsWithProductIds[i].title.includes('Case')) {
          await createProduct(itemsWithProductIds[i]).then(response => {
            console.log(`Product created successfully--> ${response.data.product.title}`)
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
  let mapArray = ["Shane's World","Hott Products",'Screaming O','Golden Triangle','Adventure Industries, Llc','Bellesa Enterprises Inc','Betru Wellness','Channel 1 Releasing','Cyrex Ltd','East Coast New Nj','Even Technology Co Limited','Flawless 5 Health','Global Protection Corp','Hemp Bomb','Issawrap Inc/p.s. Condoms','Lix Tongue Vibes','Nori Fields Llc','Ohmibod','Old Man China Brush','Phe','Random House, Inc','Rapture Novelties','Rejuviel','Rock Candy Toys','Signs of Life Inc.','Solevy Co','Streem Master','Stud 100', 'Ticklekitty Press', 'Tongue Joy'];
  return mapArray.includes(vendor);
}
async function createProduct(item) {
  let productImages = [];
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
  if (item.description) {
    let product_tags = item.categories.concat(item.stock);
    product_tags.push('New');
    let newProductObj = {
      "product": {
        "title": item.alternateTitle == ' ' ? item.title : item.alternateTitle,
        "body_html": item.description,
        "vendor": item.vendor,
        "product_type": item.id,
        "tags": product_tags,
        "variants": [{
          "title": "Default Title",
          "price": item.price * 2.5,
          "sku": item.sku,
          "inventory_policy": "continue",
          "fulfillment_service": "manual",
          "inventory_management": "shopify",
          "taxable": true,
          "barcode": item.barcode,
          "grams": item.weight * 453.592,
          "weight": Number(item.weight),
          "weight_unit": "lb",
          "inventory_quantity": 0,
          "requires_shipping": true,

        }],
        "images": productImages,
        "published": item.stock == 'Available Now' ? true : false
      }
    }
    return axios({
      url: 'https://febe69a891c04a2e134443805cdcd304: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@try-sassy-box.myshopify.com/admin/api/2020-10/products.json',
      method: 'post',
      data: newProductObj
    }); 
    //tag with- grammarCheck
  } else {
    console.log("no item description for-- " + item.title + " not making this");
  }
}
