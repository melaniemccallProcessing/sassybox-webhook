//test

const axios = require('axios');

let productsToDelete = [
  'BL-93013',
'SE-0077-77-3',
'BL-74803',
'BL-58323',
'BL-57323',
'XR-ST005-10',
'XR-ST005-50',
'XR-AC774',
'XR-AC305-BLK',
'XR-AC118',
'XR-AD966',
'XR-AG147',
'XR-AA602',
'XR-AD727',
'XR-SP510-A',
'XR-SP510-W',
'XR-ST560',
'XR-VF532',
'SR1041',
'SR1042',
'DJ-8160-22-3',
'PD1765-11',
'SE-6915-20-3',
'SE-6915-25-3',
'SE-6915-05-3',
'SE-6915-45-3',
'SE-6915-40-3',
'SE-6850-03-3',
'DJ-0801-07-3',
'DJ-0801-05-3',
'DJ-0801-06-3',
'DJ-0800-08-3',
'DJ-0800-06-3',
'DJ-0916-02-3',
'NS0529-85',
'NS1111-37',
'NS1107-37',
'NS1107-36',
'CN-12-0522-20',
'SE-0737-20-2',
'SE-1328-13-2',
'SE-1328-12-2',
'SE-0737-25-2',
'DJ-4550-03-2',
'DJ-4550-02-2',
'DJ-1314-03-1',
'DJ-1314-02-1',
'DJ-1314-01-1',
'DJ-1313-95-3',
'DJ-1313-95-1',
'DJ-1313-90-3',
'DJ-1313-90-1',
'SE-0883-75-3',
'SE-0883-70-3',
'SE-0883-65-3',
'SE-0883-60-3',
'BL-30812',
'BL-30622',
'BL-30610',
'BL-30811',
'BL-BC-009',
'SE-1919-05-3',
'SE-1841-75-3',
'DJ-1361-75-1',
'DJ-1361-74-1',
'DJ-1361-73-1',
'DJ-1361-72-1',
'DJ-1361-71-1',
'DJ-1361-70-3',
'DJ-1361-15-3',
'DJ-1361-15-1',
'DJ-1361-14-3',
'DJ-1361-13-3',
'DJ-1361-14-1',
'DJ-1361-13-1',
'DJ-1361-12-3',
'DJ-1361-12-1',
'DJ-1361-10-3',
'DJ-1361-10-1',
'DJ-1361-09-3',
'DJ-1361-09-1',
'DJ-1361-08-1',
'DJ-1361-08-3',
'DJ-1361-07-1',
'DJ-1361-06-3',
'DJ-1361-06-1',
'DJ-1361-05-3',
'DJ-1361-05-1',
'DJ-1361-04-3',
'DJ-1361-04-1',
'DJ-1361-03-3',
'DJ-1361-03-1',
'DJ-1361-07-3',
'SE-8000-95-1',
'SE-8000-75-1',
'SE-8000-90-1',
'SE-8000-80-1',
'SE-8000-85-1',
'SE-8000-70-1',
'SE-2651-30-3',
'SE-2651-25-3',
'SE-2651-20-3',
'SE-2651-15-3',
'BL-31912',
'BL-31911',
'DJ-5206-02-3',
'DJ-5206-01-3',
'XR-AG703',
'XR-AG702',
'NS1126-21',
'NS1126-31'
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
