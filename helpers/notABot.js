/* eslint-env browser */

// simple anti-bot-detection countermeasures running in the browser context

module.exports = () => {
    if (window.Notification && Notification.permission === 'denied') {
        Reflect.defineProperty(window.Notification, 'permission', {get: () => 'default'});
    }

    if (window.Navigator) {
        Reflect.defineProperty(window.Navigator.prototype, 'webdriver', {get: () => undefined});
    }

    // @ts-ignore 'chrome' is a non-standard prop
    if (!window.chrome || !window.chrome.runtime) {
        // @ts-ignore
        window.chrome = {
            /* dump of a real thing */
            "app": {
                "isInstalled": false, "InstallState": {"DISABLED": "disabled", "INSTALLED": "installed", "NOT_INSTALLED": "not_installed"}, "RunningState": {"CANNOT_RUN": "cannot_run", "READY_TO_RUN": "ready_to_run", "RUNNING": "running"}
            }, "runtime": {
                "OnInstalledReason": {"CHROME_UPDATE": "chrome_update", "INSTALL": "install", "SHARED_MODULE_UPDATE": "shared_module_update", "UPDATE": "update"}, "OnRestartRequiredReason": {"APP_UPDATE": "app_update", "OS_UPDATE": "os_update", "PERIODIC": "periodic"}, "PlatformArch": {"ARM": "arm", "ARM64": "arm64", "MIPS": "mips", "MIPS64": "mips64", "X86_32": "x86-32", "X86_64": "x86-64"}, "PlatformNaclArch": {"ARM": "arm", "MIPS": "mips", "MIPS64": "mips64", "X86_32": "x86-32", "X86_64": "x86-64"}, "PlatformOs": {"ANDROID": "android", "CROS": "cros", "LINUX": "linux", "MAC": "mac", "OPENBSD": "openbsd", "WIN": "win"}, "RequestUpdateCheckStatus": {
                    "NO_UPDATE": "no_update", "THROTTLED": "throttled", "UPDATE_AVAILABLE": "update_available"
                }
            }
        };
    }

    if (window.Navigator && window.navigator.plugins.length === 0) {
        Reflect.defineProperty(window.Navigator.prototype, 'plugins', {
            get: () => ([
                {
                    description: "Portable Document Format",
                    filename: "internal-pdf-viewer",
                    name: "Chrome PDF Plugin"
                }
            ])
        });
    }
};