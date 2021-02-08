exports.getShippingId = function(shippingTitle) {
    if(shippingTitle.includes('Free Shipping') || shippingTitle.includes('Flat Rate')) {
        return 6;
    }
    if(shippingTitle.includes('Priority Express')) {
        return 102;
    }
    if(shippingTitle.includes('Overnight')) {
        return 109;
    }
    if(shippingTitle.includes('2-3 days')) {
        return 113;
    }
    if(shippingTitle.includes('DHL')) {
        return 6;
    }
}