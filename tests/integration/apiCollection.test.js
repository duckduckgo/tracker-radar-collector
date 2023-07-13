const {crawler, APICallCollector} = require('../../main.js');
const assert = require('assert');
const breakpoints = require('../../collectors/APICalls/breakpoints.js');

async function main() {

    // we are testing all APIs that we are monitoring against our privacy test page for fingerprinting

    let apiData;
    try {
        apiData = await crawler(new URL('https://privacy-test-pages.glitch.me/privacy-protections/fingerprinting/?run'), {
            collectors: [new APICallCollector()]
        });
    } catch (e) {
        assert(false, `Page load failed - ${e}`);
    }

    const apiCalls = apiData.data.apis.callStats['https://privacy-test-pages.glitch.me/privacy-protections/fingerprinting/helpers/tests.js'];

    // known fingerprinting breakpoints that are not invoked by our test page
    const knownMissing = [
        "window.name",
        "PerformanceTiming.prototype.navigationStart",
        "Document.cookie getter",
        "Document.cookie setter",
        "CookieStore.prototype.get",
        "CookieStore.prototype.getAll",
        "CookieStore.prototype.set",
        "Navigator.prototype.onLine",
        "Navigator.prototype.keyboard",
        "Navigator.prototype.presentation",
        "Event.prototype.timeStamp",
        "KeyboardEvent.prototype.code",
        "KeyboardEvent.prototype.keyCode",
        "Touch.prototype.force",
        "Touch.prototype.radiusX",
        "Touch.prototype.radiusY",
        "Touch.prototype.rotationAngle",
        "WheelEvent.prototype.deltaX",
        "WheelEvent.prototype.deltaY",
        "WheelEvent.prototype.deltaZ",
        "DeviceOrientationEvent.prototype.alpha",
        "DeviceOrientationEvent.prototype.beta",
        "DeviceOrientationEvent.prototype.gamma",
        "DeviceOrientationEvent.prototype.absolute",
        "DeviceMotionEvent.prototype.acceleration",
        "DeviceMotionEvent.prototype.accelerationIncludingGravity",
        "DeviceMotionEvent.prototype.rotationRate",
        "Animation.prototype.currentTime",
        "Animation.prototype.startTime",
        "Gyroscope.prototype.x",
        "Gyroscope.prototype.y",
        "Gyroscope.prototype.z",
        // method calls
        "Document.prototype.interestCohort",
        'HTMLCanvasElement.prototype.constructor',
        'HTMLCanvasElement.prototype.toBlob',
        'CanvasRenderingContext2D.prototype.isPointInPath',
        'Date.prototype.getTime',
        'WebGLRenderingContext.prototype.getExtension',
        'WebGLRenderingContext.prototype.readPixels',
        'WebGL2RenderingContext.prototype.getContextAttributes',
        'WebGL2RenderingContext.prototype.getExtension',
        'WebGL2RenderingContext.prototype.getParameter',
        'WebGL2RenderingContext.prototype.getShaderPrecisionFormat',
        'WebGL2RenderingContext.prototype.getSupportedExtensions',
        'WebGL2RenderingContext.prototype.readPixels',
        'AudioWorkletNode.prototype.constructor',
        'SharedWorker.prototype.constructor',
        'BroadcastChannel.prototype.constructor',
        'TouchEvent.prototype.constructor',
        'URL.createObjectURL',
        'CSSStyleDeclaration.setProperty("fontFamily",…)',
        'Element.prototype.getClientRects',
        'Sensor.prototype.constructor',
        // bug - we can only test for one matchMedia - all other fail
        'window.matchMedia("prefers-reduced-motion")',
        'window.matchMedia("color-gamut")',
        'window.matchMedia("pointer")',
    ];

    breakpoints.forEach(object => {
        /**
         * @type {string}
         */
        let prefix;

        if (object.proto) {
            prefix = object.proto + '.prototype.';
        } else if (object.global) {
            prefix = object.global + '.';
        }

        object.props.forEach(prop => {
            const propName = prop.description || (prefix + prop.name);

            if (!apiCalls[propName] && !knownMissing.includes(propName)) {
                assert(false, `Missing ${propName} property read.`);
            }
        });
        object.methods.forEach(method => {
            const methodName = method.description || (prefix + method.name);

            if (!apiCalls[methodName] && !knownMissing.includes(methodName)) {
                assert(false, `Missing ${methodName} method call.`);
            }
        });
    });
}

main();
