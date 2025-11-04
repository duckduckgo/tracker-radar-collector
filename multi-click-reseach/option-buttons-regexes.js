const settingsButtonsNeverMatchPatterns = [
    // Use Recommended Settings
    // OK to use our recommended settings
    /recommended/i,
    // Save preferences and the like
    /save|submit|close|accept|agree/i,
];

const settingsButtonsPatterns = [
    // Adjust cookie settings
    // Adjust settings
    // Advanced Settings
    // Change cookie settings
    // Change my preferences
    // Change Preferences
    // Change Settings
    // Change your cookie settings
    // Choose Cookies
    // Customise Cookies
    // Customise my choices
    // Customise settings
    // Customize Choices
    // Customize cookie settings
    // Customize Cookies
    // Customize Cookies Settings
    // Customize Preferences
    // Customize settings
    // Customize your choice
    // Manage Choices
    // Manage Consent Preferences
    // Manage Cookie & Tracking Settings
    // Manage Cookie Preferences
    // Manage Cookie Settings
    // Manage Cookies
    // Manage Cookies
    // Manage Cookies Settings
    // Manage Individual preferences
    // Manage My Cookies
    // Manage my preferences
    // Manage My Preferences
    // MANAGE MY SETTINGS
    // Manage opt out preferences
    // Manage options
    // Manage or reject Cookies
    // Manage Preferences
    // Manage privacy settings
    // Manage Settings
    // manage specific collection and sharing preferences
    // Manage Your Cookies
    // Manage your preferences
    // Manage Your Privacy Choices
    // Manage your privacy settings
    // Set Choices
    // Set preferences
    // Set your choices
    // View Cookies Settings
    // View options
    // View preferences
    /^(?:ad|choose|adjust|customize|customise|change|set|manage|configure|view).{0,100}(?:your)?.{0,100}(?:cookie)?.{0,100}(?:cookie|cookies|settings|preferences|choices?|options)$/i,

    // CONFIGURE
    // Customise
    // Customize
    // Manage
    /^(?:adjust|customize|customise|manage|configure)$/i,

    // Consent Preferences
    // Consent Settings
    // Cookie Choices
    // Cookie Consent Options
    // cookie preferences
    // Cookie Preferences
    // Cookie Setting
    // Cookie Settings
    // Cookie/Consent Preferences
    // Cookies Preferences
    // Cookies Settings
    // CUSTOM SETTINGS
    // Customise my choices
    // Customise settings
    // Customize Choices
    // Customize cookie settings
    // Customize Cookies Settings
    // Customize Preferences
    // Customize settings
    // MORE OPTIONS
    /^(?:(?:cookie\s+)?consent|cookie|custom|more).{0,100}(?:preferences|settings?|choices|options)$/i,

    // My settings
    // Options
    // Preferences
    // Settings
    // Your Privacy Choices
    /^((?:my|your).{0,100})?(?:settings|preferences|choices|options)$/i,
    /^let me choose$/i,
    /^show purposes$/i,
];

/**
 * FIXME: this is a duplicate from the post-processing/generate-autoconsent-rules/detection.js file. Remove it when merging.
 * @param {string} buttonText
 * @returns {string}
 */
function cleanButtonText(buttonText) {
    // lowercase
    let result = buttonText.toLowerCase();
    // remove special characters
    result = result.replace(/[“”"'/#&[\]→✕×⟩❯><✗×‘’›«»]+/g, '');
    // remove emojis
    result = result.replace(
        /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u2600-\u26FF\u2700-\u27BF\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu,
        '',
    );
    // remove newlines
    result = result.replace(/\n+/g, ' ');
    // remove multiple spaces
    result = result.replace(/\s+/g, ' ');
    // strip whitespace around the text
    result = result.trim();
    return result;
}

/**
 * @param {string} buttonText
 * @returns {boolean}
 */
function isSettingsButton(buttonText) {
    if (!buttonText) {
        return false;
    }
    const cleanedButtonText = cleanButtonText(buttonText);
    return (
        !settingsButtonsNeverMatchPatterns.some((p) => p.test(cleanedButtonText)) &&
        settingsButtonsPatterns.some((p) => (p instanceof RegExp && p.test(cleanedButtonText)) || p === cleanedButtonText)
    );
}


module.exports = {
    settingsButtonsPatterns,
    settingsButtonsNeverMatchPatterns,
    isSettingsButton,
    cleanButtonText,
};

