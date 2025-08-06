const path = require('path');

const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';
const MOBILE_USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36';

/** @type {import('devtools-protocol/types/protocol').Protocol.Emulation.SetDeviceMetricsOverrideRequest} */
const DEFAULT_VIEWPORT = {
    width: 1440, // px
    height: 812, // px
    deviceScaleFactor: 0,
    mobile: false,
};
/** @type {import('devtools-protocol/types/protocol').Protocol.Emulation.SetDeviceMetricsOverrideRequest} */
const MOBILE_VIEWPORT = {
    width: 412,
    height: 691,
    deviceScaleFactor: 2,
    mobile: true,
    // hasTouch: true
};

// for debugging: will launch in window mode instead of headless, open devtools and don't close windows after process finishes
const VISUAL_DEBUG = false;

const CHROMIUM_DOWNLOAD_DIR = path.join(__dirname, 'chromium');

module.exports = {
    DEFAULT_USER_AGENT,
    MOBILE_USER_AGENT,
    DEFAULT_VIEWPORT,
    MOBILE_VIEWPORT,
    VISUAL_DEBUG,
    CHROMIUM_DOWNLOAD_DIR,
};
