exports.getShippingId = function(shippingTitle) {
    if(shippingTitle.includes('Free Shipping') || shippingTitle.includes('Flat Rate')) {
        return 6;
    }
    if(shippingTitle.includes('Priority Mail')) {
        return 101;
    }
    if(shippingTitle.includes('First Class')) {
        return 100;
    }
    if(shippingTitle.includes('UPS 2nd Day Air')) {
        return 112;
    }
    if(shippingTitle.includes('UPS Next Day Air Saver')) {
        return 110;
    }
    if(shippingTitle.includes('UPS Next Day Air')) {
        return 109;
    }
    if(shippingTitle.includes('DHL')) {
        return 138;
    }
    if(shippingTitle.includes('UPS Worldwide Expedited')) {
        return 118;
    }
    if(shippingTitle.includes('UPS Worldwide Express Plus')) {
        return 117;
    }
    if(shippingTitle.includes('UPS Worldwide Express')) {
        return 116;
    }
    
}