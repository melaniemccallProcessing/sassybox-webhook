//Shipping Codes
exports.getShippingId = function(shippingTitle) {
    if(shippingTitle.includes('Free Shipping') || shippingTitle.includes('Flat Rate')) {
        return 6;
    }
    if(shippingTitle.includes('UPS 2nd Day')) {
        return 112;
    }
    if(shippingTitle.includes('UPS Ground')) {
        return 114;
    }
    if(shippingTitle.includes('Next Day Air')) {
        return 109;
    }
    if(shippingTitle.includes('DHL')) {
        return 6;
    }
}