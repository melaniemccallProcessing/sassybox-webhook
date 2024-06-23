//test

const axios = require('axios');

let productsToDelete = [
  'SE-2410-00-3',
'SE-2410-10-1',
'SE-2410-05-1',
'SE-2410-15-1',
'SE-2410-20-1',
'VXM009',
'VXM010',
'VNV055-0',
'VNV056-0',
'VBGC102',
'VBGC104',
'VNV031',
'VNV037',
'VNV039-0',
'VNV034-0',
'VNV035-0',
'VNV046',
'VXM009',
'VXM010',
'VNV055-0',
'VNV056-0',
'VNV034-0',
'XGZO6047',
'XGZO6045'
]
    deleteProducts(productsToDelete);

async function deleteProducts(productsToDelete) {
    for (let i = 0; i < productsToDelete.length; i++) {
        await getProductId(productsToDelete[i]).then(function(result) {
            if (result.data.data.productVariants.edges.length) {
                console.log('found product id')
                let product_id = result.data.data.productVariants.edges[0].node.product.id.replace("gid://shopify/Product/", "");
                let deleteURL = `https://febe69a891c04a2e134443805cdcd304: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@try-sassy-box.myshopify.com/admin/api/2021-01/products/${product_id}.json`;
                    deleteProduct(deleteURL).then(function(result) {
                        console.log('product deleted')
                    }).catch(function(result) {
                        console.log('error deleting product ' + productsToDelete[i] + result );
                    });
            }
        })
    }
}
async function deleteProduct(deleteUrl) {
  return axios({
    url: deleteUrl,
    method: 'delete'
  })
}
async function getProductId(itemSKU) {
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
              productVariants(first: 1, query: "sku:${itemSKU}") {
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
