/* eslint-disable max-lines */
/**
 * @type {{global?: string, proto?: string, props: PropertyBreakpoint[], methods: MethodBreakpoint[]}[]}
 */
const breakpoints = [
    {
        global: 'window',
        props: [
            {name: 'devicePixelRatio'}, // screen
            {name: 'localStorage'},
            {name: 'sessionStorage'},
            {name: 'indexedDB'},
            {name: 'name'}, // can pottentially be used to link two tabs
            // {name: 'ActiveXObject'}// not available in Chrome
        ],
        methods: [
            {
                name: 'openDatabase',
                test: 'openDatabase("test", "1.0", "test", 1024)'
            },
            {
                name: 'matchMedia',
                description: 'window.matchMedia("prefers-reduced-motion")',
                condition: 'arguments.length > 0 && arguments[0].includes("prefers-reduced-motion")',
                test: 'window.matchMedia("(prefers-reduced-motion: reduce)")'
            },
            {
                name: 'matchMedia',
                description: 'window.matchMedia("prefers-color-scheme")',
                condition: 'arguments.length > 0 && arguments[0].includes("prefers-color-scheme")',
                test: 'window.matchMedia("(prefers-color-scheme: dark)")'
            }
        ]
    },
    // {
    //     global: 'chrome',
    //     props: [
    //     ],
    //     methods: [
    //         // {name: 'csi'}, // doesn't work
    //         // {name: 'loadTimes'}, // doesn't work
    //     ]
    // },
    {
        global: 'console',
        props: [
            {name: 'memory'}
        ],
        methods: []
    },
    // {// not in Chromium
    //     global: 'chrome.app',
    //     props: [],
    //     methods: [
    //         {name: 'getDetails'}
    //     ]
    // },
    {
        global: 'Reflect.getPrototypeOf(document.fonts)',// .prototype .__proto__ and getting method from global object dont' work here 
        props: [
        ],
        methods: [
            {
                name: 'check',
                description: 'document.fonts.check',
                test: 'document.fonts.check("normal 10px Arial")'
            }
        ]
    },
    {
        proto: 'Performance',
        props: [
            {name: 'memory'} // memory available to js (not the same as navigator.deviceMemory)
        ],
        methods: []
    },
    {
        proto: 'PerformanceTiming',
        props: [
            // can be used to get current time
            {
                name: 'navigationStart',
                test: 'performance.timing.navigationStart'
            }
        ],
        methods: []
    },
    {
        proto: 'Document',
        props: [
            {name: 'cookie', description: 'Document.cookie getter'},
            {name: 'cookie', description: 'Document.cookie setter', setter: true, saveArguments: true},
            // {name: 'timeline'}, - not in Chromium
        ],
        methods: [
            {name: 'interestCohort'} // FLoC
        ]
    },
    {
        proto: 'Navigator',
        props: [
            {name: 'appName'}, // user agent & friends
            {name: 'appCodeName'}, // user agent & friends
            {name: 'appVersion'}, // user agent & friends
            {name: 'mimeTypes'},
            {name: 'cookieEnabled'},
            {name: 'language'},
            {name: 'languages'},
            // {name: 'systemLanguage'}, // not available on Chrome
            // {name: 'userLanguage'}, // not available on Chrome
            {name: 'userAgent'},
            {name: 'plugins'},
            {name: 'platform'},// user agent & friends
            {name: 'doNotTrack'},
            {name: 'hardwareConcurrency'},// number of cpu cores
            {name: 'maxTouchPoints'},// capability of the trackpad/touchscreen
            //{name: 'msMaxTouchPoints'}, Microsoft only
            {name: 'mediaCapabilities'}, // codecs, mime types, display
            {name: 'mediaDevices'}, // screens, cameras, microphones
            {name: 'deviceMemory'}, // memory in Gb
            {name: 'connection'}, // changes over time
            {name: 'onLine'},
            {name: 'keyboard'},
            {name: 'permissions'},
            {name: 'presentation'}, //TODO nees double checking
            {name: 'product'},
            {name: 'productSub'},
            {name: 'storage'},
            {name: 'vendor'},
            {name: 'vendorSub'},
            {name: 'webdriver'},
            {name: 'webkitPersistentStorage'},
            {name: 'webkitTemporaryStorage'},
            // {name: 'xr'},   //VR access - not in Chromium
        ],
        methods: [
            {name: 'getBattery'},
            {name: 'getGamepads'},
            // {name: 'getUserMedia'},
            {name: 'javaEnabled'},
        ]
    },
    {
        proto: 'Screen',
        props: [
            {name: 'width'},
            {name: 'height'},
            {name: 'availWidth'},
            {name: 'availHeight'},
            {name: 'colorDepth'},
            {name: 'pixelDepth'},
            {name: 'availLeft'},
            {name: 'availTop'},
            {name: 'orientation'}
            // {name: 'deviceXDPI'},// not available on Chrome
            // {name: 'deviceYDPI'},// not available on Chrome
        ],
        methods: [
        ]
    },
    // {
    //     global: 'screen.__proto__',
    //     props: [
    //         // {name: 'keepAwake'},// not in Chromium
    //     ],
    //     methods: []
    // },
    {
        proto: 'HTMLCanvasElement',
        props: [
        ],
        methods: [
            // toDataURL is an obvious way of getting the fingerprint, but there are other ways (e.g. reading pixel data or creating a blob), that's why we track all canvas usage
            {
                name: 'constructor',
                test: 'document.createElement("canvas")'
            },
            {
                name: 'toDataURL',
                test: 'var c = document.createElement("canvas"); c.toDataURL()'
            }
        ]
    },
    {
        proto: 'CanvasRenderingContext2D',
        props: [
        ],
        methods: [
            // used to detect fonts
            {
                name: 'measureText',
                test: 'var c = document.createElement("canvas"); var ctx = c.getContext("2d"); ctx.measureText("txt");'
            },
            {
                name: 'getImageData',
                test: 'var c = document.createElement("canvas"); var ctx = c.getContext("2d"); ctx.getImageData();'
            },
            //used to detect canvas winding
            {
                name: 'isPointInPath',
                test: 'var c = document.createElement("canvas"); var ctx = c.getContext("2d"); ctx.rect(10, 10, 100, 100); ctx.fill(); ctx.isPointInPath(30, 70);'
            }
        ]
    },
    {
        proto: 'HTMLMediaElement',
        props: [],
        methods: [
            {
                name: 'canPlayType',
                test: 'var v = document.createElement("video"); v.canPlayType("nope");'
            }
        ]
    },
    {
        proto: 'Date',
        props: [
        ],
        methods: [
            // getting timezone is obvious when done via getTimezoneOffset, but it can be parsed out from `getTime`, so we track it
            {name: 'getTime'},
            {name: 'getTimezoneOffset'}
        ]
    },
    {
        proto: 'WebGLRenderingContext',
        props: [
            // {name: 'ALIASED_LINE_WIDTH_RANGE'}// we can't track static values
            // 'WebGLRenderingContext.ALIASED_LINE_WIDTH_RANGE',
            // 'WebGLRenderingContext.ALPHA_BITS',
            // 'WebGLRenderingContext.BLUE_BITS',
            // 'WebGLRenderingContext.DEPTH_BITS',
            // 'WebGLRenderingContext.GREEN_BITS',
            // 'WebGLRenderingContext.RED_BITS',
            // 'WebGLRenderingContext.MAX_COMBINED_TEXTURE_IMAGE_UNITS',
            // 'WebGLRenderingContext.MAX_CUBE_MAP_TEXTURE_SIZE',
            // 'WebGLRenderingContext.MAX_FRAGMENT_UNIFORM_VECTORS',
            // 'WebGLRenderingContext.MAX_RENDERBUFFER_SIZE',
            // 'WebGLRenderingContext.MAX_TEXTURE_IMAGE_UNITS',
            // 'WebGLRenderingContext.MAX_TEXTURE_SIZE',
            // 'WebGLRenderingContext.MAX_VARYING_VECTORS',
            // 'WebGLRenderingContext.MAX_VERTEX_ATTRIBS',
            // 'WebGLRenderingContext.MAX_VERTEX_TEXTURE_IMAGE_UNITS',
            // 'WebGLRenderingContext.MAX_VERTEX_UNIFORM_VECTORS',
            // 'WebGLRenderingContext.MAX_VIEWPORT_DIMS',
            // 'WebGLRenderingContext.RENDERER',
            // 'WebGLRenderingContext.SHADING_LANGUAGE_VERSION',
            // 'WebGLRenderingContext.VENDOR',
            // 'WebGLRenderingContext.VERSION',
            // 'WebGLRenderingContext.VERTEX_SHADER',
            // 'WebGLRenderingContext.FRAGMENT_SHADER',
            // 'WebGLRenderingContext.COLOR_BUFFER_BIT',
            // 'WebGLRenderingContext.DEPTH_BUFFER_BIT'
        ],
        methods: [
            {
                name: 'getSupportedExtensions',
                test: 'var c = document.createElement("canvas"); c.getContext("webgl").getSupportedExtensions()'
            },
            {
                name: 'getExtension',
                test: 'var c = document.createElement("canvas"); c.getContext("webgl").getExtension("")'
            },
            {
                name: 'getParameter',
                test: 'var c = document.createElement("canvas"); c.getContext("webgl").getParameter("")'
            },
            {
                name: 'getShaderPrecisionFormat',
                test: 'var c = document.createElement("canvas"); c.getContext("webgl").getShaderPrecisionFormat(WebGLRenderingContext.FRAGMENT_SHADER, WebGLRenderingContext.LOW_FLOAT)'
            },
            {
                name: 'getContextAttributes',
                test: 'var c = document.createElement("canvas"); c.getContext("webgl").getContextAttributes()'
            },
        ]
    },
    {
        proto: 'OfflineAudioContext',
        props: [],
        methods: [
            {
                name: 'constructor',
                test: 'new OfflineAudioContext(2, 512, 96000)'
            },// web audio
        ]
    },
    {
        proto: 'AudioBuffer',
        props: [],
        methods: [
            {
                name: 'getChannelData',
                test: 'var a = new AudioBuffer({length: 512, sampleRate: 8000}); a.getChannelData(0)'
            }// web audio
        ]
    },
    {
        proto: 'AudioWorkletNode',
        props: [],
        methods: [
            // possibly there is some other method better suited here - needs more research
            {name: 'constructor'}// web audio
        ]
    },
    {
        proto: 'RTCPeerConnection',
        props: [],
        methods: [
            // possibly there is some other method better suited here - needs more research
            {
                name: 'constructor'
            }// leaking ip
        ]
    },
    {
        proto: 'RTCPeerConnectionIceEvent',
        props: [
            {
                name: 'candidate',// leaking ip
                test: 'var c = new RTCPeerConnection({iceServers: [{urls: "stun:stun.l.google.com:19302?transport=udp"}]}, {optional: [{RtpDataChannels: !0}]}); c.onicecandidate = e => console.log(e.candidate); c.createDataChannel(""); c.createOffer(a => {c.setLocalDescription(a, () => {}, () => {})}, () => {});'
            }
        ],
        methods: []
    },
    {
        proto: 'SharedWorker', // can be used to talk between tabs - not sure how unsafe that is
        props: [],
        methods: [
            // possibly there is some other method better suited here - needs more research
            {
                name: 'constructor',
                test: 'new SharedWorker("script.js")'
            }// talking contexts
        ]
    },
    {
        proto: 'BroadcastChannel', // can be used to talk between tabs - not sure how unsafe that is
        props: [],
        methods: [
            // possibly there is some other method better suited here - needs more research
            {
                name: 'constructor',
                test: 'new BroadcastChannel("test")'
            }// talking contexts
        ]
    },
    {
        proto: 'Intl.DateTimeFormat',
        props: [],
        methods: [
            {name: 'resolvedOptions'}// timezone
        ]
    },
    {// works only on mobile
        proto: 'TouchEvent',
        props: [],
        methods: [
            {
                name: 'constructor',
                test: 'document.createEvent("TouchEvent")'
            }// testing touch capabilities
        ]
    },
    {
        proto: 'Event',
        props: [
            {name: 'timeStamp'}// behavioral fingerprinting
        ],
        methods: []
    },
    {
        proto: 'KeyboardEvent',
        props: [
            {name: 'code'},// behavioral fingerprinting, keyboard layout
            {name: 'keyCode'},// behavioral fingerprinting, keyboard layout
        ],
        methods: []
    },
    {
        global: 'MediaSource',//it's a global because it's a static method
        props: [],
        methods: [
            {
                name: 'isTypeSupported',
                test: 'MediaSource.isTypeSupported("test")'
            } // codecs
        ]
    },
    // { not in chromium
    //     global: 'Bluetooth',
    //     props: [],
    //     methods: [
    //         {
    //             name: 'getAvailability',
    //             test: 'navigator.bluetooth.getAvailability()'
    //         }
    //     ]
    // },
    {
        global: 'speechSynthesis.__proto__',// both .prototype and getting method from global object don't work here 
        props: [],
        methods: [
            {
                name: 'getVoices',
                test: 'speechSynthesis.getVoices()'
            }
        ]
    },
    {
        proto: 'Touch',// behavioral fingerprinting,
        props: [
            {name: 'force'},
            {name: 'radiusX'},
            {name: 'radiusY'},
            {name: 'rotationAngle'}
        ],
        methods: []
    },
    {
        global: 'URL',//it's a global because it's a static method
        props: [],
        methods: [
            {
                name: 'createObjectURL',
                test: 'URL.createObjectURL(new Blob())'
            }// it can pottentially allow tabs to talk with each other
        ]
    },
    {
        proto: 'CSSStyleDeclaration',
        props: [
            // {name: 'fontFamily'}
        ],
        methods: [
            {
                name: 'setProperty',
                condition: 'arguments.length > 0 && arguments[0].toLowerCase() === "fontfamily"',
                description: 'CSSStyleDeclaration.setProperty("fontFamily",…)',
                test: 'document.body.style.setProperty("fontFamily", "Arial")'
            }
        ]
    },
    {
        proto: 'Element',
        props: [],
        methods: [
            {
                name: 'getClientRects',
                test: 'document.body.getClientRects()'
            }
        ]
    },
    {
        proto: 'WheelEvent',
        props: [
            {name: 'deltaX'},
            {name: 'deltaY'},
            {name: 'deltaZ'}
        ],
        methods: []
    },
    {
        proto: 'Sensor',
        props: [
        ],
        methods: [
            {name: 'constructor'},
            {name: 'start'}
        ]
    },
    {
        proto: 'DeviceOrientationEvent',
        props: [
            {name: 'alpha'},
            {name: 'beta'},
            {name: 'gamma'},
            {name: 'absolute'},
        ],
        methods: []
    },
    {
        proto: 'DeviceMotionEvent',
        props: [
            {name: 'acceleration'},
            {name: 'accelerationIncludingGravity'},
            {name: 'rotationRate'}
        ],
        methods: []
    },
    {
        proto: 'Animation',
        props: [
            {name: 'currentTime'},
            {name: 'startTime'},
            // {name: 'timeline'}, //not in Chromium
        ],
        methods: []
    },
    // { - eval is a function, we need an object here
    //     global: 'eval',
    //     props: [
    //     ],
    //     methods: [
    //         {
    //             name: 'toString',
    //             test: 'eval.toString()'
    //         },  //Can be used to determine browser vendor/version in some cases.
    //     ]
    // },
    {
        global: 'Notification',//it's a global because it's a static method
        props: [
            {name: 'permission'},
        ],
        methods: []
    },
    // {// not in Chromium
    //     proto: 'AmbientLightSensor',
    //     props: [
    //         {name: 'illuminance'}
    //     ],
    //     methods: [
    //         {name: 'start'}
    //     ]
    // },
    {
        proto: 'Gyroscope',
        props: [
            {name: 'x'},
            {name: 'y'},
            {name: 'z'}
        ],
        methods: [
            {name: 'constructor'}
        ]
    },
    // {// not in Chromium
    //     proto: 'Magnetometer',
    //     props: [
    //         {name: 'x'},
    //         {name: 'y'},
    //         {name: 'z'}
    //     ],
    //     methods: [
    //         {name: 'start'}
    //     ]
    // }
];

module.exports = breakpoints;

/**
 * @typedef MethodBreakpoint
 * @property {string} name - name of the method
 * @property {string=} test - test expression that should trigger given breakpoint
 * @property {string=} description - human redable description of a breakpoint
 * @property {string=} condition - additional condition that has to be truthy for the breakpoint to fire
 * @property {boolean=} saveArguments - save arguments of each call (defaults to false)
 */

 /**
 * @typedef PropertyBreakpoint
 * @property {string} name - name of the property
 * @property {string=} test - test expression that should trigger given breakpoint
 * @property {string=} description - human redable description of a breakpoint
 * @property {string=} condition - additional condition that has to be truthy for the breakpoint to fire
 * @property {boolean=} saveArguments - save arguments of each call (defaults to false)
 * @property {boolean=} setter - hook up to a property setter instead of getter (which is a default)
 */
