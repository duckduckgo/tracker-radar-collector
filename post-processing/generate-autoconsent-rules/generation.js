
/**
 * Compare if the same reject button is used in an existing rule.
 * @param {import('./main').ButtonData} newButton - The new button.
 * @param {import('./main').AutoConsentCMPRule} existingRule - The existing rule.
 * @returns {boolean} True if buttons are the same.
 */
function isSameRejectButton(newButton, existingRule) {
    if (!existingRule.optOut) {
        return false;
    }

    const existingOptOut = existingRule.optOut.find(optOut => optOut.waitForThenClick);
    if (!existingOptOut) {
        return false;
    }

    // Compare selector
    return existingOptOut.waitForThenClick === newButton.selector;
}

/**
 * Parse rule name components.
 * @param {string} ruleName - The rule name (e.g., "auto_GB_example_com_abc").
 * @returns {{region: string|null, domain: string|null, ruleSuffix: string|null}} The parsed components.
 */
function parseRuleName(ruleName) {
    const match = ruleName.match(/^auto_([A-Z]{2})_(.+?)_(.+)$/);
    if (match) {
        return {
            region: match[1],
            domain: match[2],
            ruleSuffix: match[3],
        };
    }
    return {
        region: null,
        domain: null,
        ruleSuffix: null,
    };
}

/**
 * @param {string} domain
 * @returns {string}
 */
function generalizeDomain(domain) {
    return domain.replace(/^www\./, '');
}

/**
 * Generate an autoconsent rule from a reject button.
 * @param {import('./main').GlobalParams} globalParams
 * @param {string} url - The URL of the site.
 * @param {import('./main').PopupData} popup - The popup object.
 * @param {import('./main').ButtonData} button - The reject button object.
 * @returns {import('./main').AutoConsentCMPRule} The autoconsent rule.
 */
function generateAutoconsentRule({ region }, url, popup, button) {
    const frameDomain = generalizeDomain(new URL(popup.origin).hostname);
    const topDomain = generalizeDomain(new URL(url).hostname);
    const urlPattern = `^https?://(www\\.)?${frameDomain.replace(/\./g, '\\.')}/`;
    const ruleName = `auto_${region}_${topDomain}_${Math.random().toString(36).substring(2, 5)}`;
    return {
        name: ruleName,
        vendorUrl: url,
        cosmetic: false,
        runContext: {
            main: popup.isTop,
            frame: !popup.isTop,
            urlPattern,
        },
        prehideSelectors: [],
        detectCmp: [{ exists: button.selector }],
        detectPopup: [{ visible: button.selector }],
        optIn: [],
        optOut: [
            { wait: 500 },
            { waitForThenClick: button.selector, comment: button.text },
        ],
        test: [
            {
                waitForVisible: button.selector,
                timeout: 1000,
                check: 'none',
            },
        ],
    };
}


/**
 * Analyze existing rules and generate new rules when necessary.
 * @param {import('./main').GlobalParams} globalParams
 * @param {string} url - The URL being processed.
 * @param {import('./main').ProcessedCookiePopup[]} cookiePopups - The detected cookie popups.
 * @param {import('./main').AutoConsentCMPRule[]} matchingRules - Array of existing rules.
 * @returns {{newRules: import('./main').AutoConsentCMPRule[], rulesToOverride: import('./main').AutoConsentCMPRule[], reviewNotes: import('./main').ReviewNote[], keptCount: number}}
 */
function generateRulesForSite(globalParams, url, cookiePopups, matchingRules) {
    const { region } = globalParams;
    /** @type {import('./main').AutoConsentCMPRule[]} */
    const newRules = [];
    /** @type {import('./main').AutoConsentCMPRule[]} */
    const rulesToOverride = [];
    /** @type {import('./main').ReviewNote[]} */
    const reviewNotes = [];
    let keptCount = 0;

    if (cookiePopups.length > 1 || cookiePopups[0].rejectButtons.length > 1) {
        console.warn('Multiple cookie popups or reject buttons found in', url);
        reviewNotes.push({
            note: 'Multiple popups or reject buttons found',
            url,
            region,
        });
    }

    for (const popup of cookiePopups) {
        for (const button of popup.rejectButtons) {
            // most of the time, we'll have a single popup with a single reject button

            if (matchingRules.some(rule => isSameRejectButton(button, rule)) ||
                    newRules.some(rule => isSameRejectButton(button, rule)) ||
                    rulesToOverride.some(rule => isSameRejectButton(button, rule))) {
                // if there is an existing rule with the same reject button, do nothing
                keptCount++;
            } else {
                let newRule;
                try {
                    newRule = generateAutoconsentRule(globalParams, url, popup, button);
                } catch (err) {
                    console.error(`Error generating rule for ${url} (${popup.origin})`, err);
                    continue;
                }
                if (matchingRules.length === 0) {
                    // add the first rule for this site
                    newRules.push(newRule);
                    reviewNotes.push({
                        note: 'New rule added',
                        ruleName: newRule.name,
                    });
                } else {
                    // there were some existing rules for this site, but all of them use different selectors
                    // this can happen for several reasons: site uses different popups in different regions, or the popup has changed since last crawl
                    const existingRulesWithSameRegion = matchingRules.filter(rule => parseRuleName(rule.name).region === region);
                    if (existingRulesWithSameRegion.length > 0) {
                        // if there is an existing rule with the same region, override it

                        if (existingRulesWithSameRegion.length > 1) {
                            console.warn('Multiple existing rules with the same region found for', url, region);
                            reviewNotes.push({
                                note: 'Multiple existing rules with the same region found, consider removing all but one',
                                ruleNames: existingRulesWithSameRegion.map(rule => rule.name),
                                existingRules: matchingRules.map(rule => rule.name),
                                region,
                            });
                        }

                        // find an existing rule that we haven't overridden yet
                        const ruleToOverride = existingRulesWithSameRegion.find(rule => !rulesToOverride.some(r => r.name === rule.name));
                        if (!ruleToOverride) {
                            console.warn('Already overridden all existing rules for', url, region, 'creating a new one');
                            reviewNotes.push({
                                note: 'Already overridden all existing rules, creating a new one',
                                ruleName: newRule.name,
                                existingRules: existingRulesWithSameRegion.map(rule => rule.name),
                                region,
                            });
                            newRules.push(newRule);
                        } else {
                            rulesToOverride.push({
                                ...newRule,
                                name: ruleToOverride.name, // keep the existing rule name
                            });
                            reviewNotes.push({
                                note: 'Overriding existing rule',
                                ruleName: ruleToOverride.name,
                                existingRules: matchingRules.map(rule => rule.name),
                                region,
                            });
                        }
                    } else {
                        // assume it's a new region-specific popup, but flag it for review
                        newRules.push(newRule);
                        reviewNotes.push({
                            note: 'New region-specific popup',
                            ruleName: newRule.name,
                            existingRules: matchingRules.map(rule => rule.name),
                            region,
                        });
                    }
                }
            }
        }
    }

    if (newRules.length > 1) {
        reviewNotes.push({
            note: 'Multiple new rules generated',
            ruleNames: newRules.map(rule => rule.name),
        });
    }
    return { newRules, rulesToOverride, reviewNotes, keptCount };
}

module.exports = {
    generateRulesForSite,
};
