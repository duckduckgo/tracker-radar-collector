/**
 * @param {Object<string, string>} headers
 * @param {string[]} safelist
 * 
 * @returns {Object<string, string>|null}
 */
function filterHeaders(headers, safelist) {
    const lowerCaseSafelist = safelist.map(n => n.toLowerCase());
    const matches = Object.keys(headers)
        .filter(name => lowerCaseSafelist.includes(name.toLowerCase()))
        .sort((a, b) => a.localeCompare(b));

    /**
     * @type {Object<string, string>}
     */
    const output = {};
    matches.forEach(name => {
        output[name] = headers[name];
    });

    return output;
}

/**
 * Make sure all header names are trimmed and lowercase
 * 
 * @param {Object<string, string>} headers 
 * 
 * @returns {Object<string, string>}
 */
function normalizeHeaders(headers) {
    /**
     * @type {Object<string, string>}
     */
    const normalized = {};

    Object.keys(headers).forEach(name => {
        normalized[name.toLowerCase().trim()] = headers[name];
    });

    return normalized;
}

module.exports = {
    filterHeaders,
    normalizeHeaders
};