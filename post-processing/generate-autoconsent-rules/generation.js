/**
 * Compare if the same reject button is used in an existing rule.
 * @param {import('./types').ButtonData} newButton - The new button.
 * @param {import('./types').AutoConsentCMPRule} existingRule - The existing rule.
 * @returns {boolean} True if buttons are the same.
 */
function isSameRejectButton(newButton, existingRule) {
    if (!existingRule.optOut) {
        return false;
    }

    const existingOptOut = existingRule.optOut.find((optOut) => optOut.waitForThenClick);
    if (!existingOptOut) {
        return false;
    }

    // Compare selector
    return existingOptOut.waitForThenClick === newButton.selector;
}

/**
 * Check if a rule for a given button already exists.
 * @param {import('./types').ButtonData} button - The button to check.
 * @param {import('./types').AutoConsentCMPRule[][]} ruleLists - An array of rule lists to search.
 * @returns {boolean} True if a rule exists.
 */
function ruleForButtonExists(button, ...ruleLists) {
    return ruleLists.some((list) => list.some((rule) => isSameRejectButton(button, rule)));
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
 * @param {string} region
 * @param {string} url - The URL of the site.
 * @param {import('./types').ScrapeScriptResult} frame - The frame object.
 * @param {import('./types').ButtonData} button - The reject button object.
 * @returns {import('./types').AutoConsentCMPRule} The autoconsent rule.
 */
function generateAutoconsentRule(region, url, frame, button) {
    const frameDomain = generalizeDomain(new URL(frame.origin).hostname);
    const topDomain = generalizeDomain(new URL(url).hostname);
    const urlPattern = `^https?://(www\\.)?${frameDomain.replace(/\./g, '\\.')}/`;
    const ruleName = `auto_${region}_${topDomain}_${Math.random().toString(36).substring(2, 5)}`;
    return {
        name: ruleName,
        cosmetic: false,
        _metadata: {
            vendorUrl: url,
        },
        runContext: {
            main: frame.isTop,
            frame: !frame.isTop,
            urlPattern,
        },
        prehideSelectors: [],
        detectCmp: [{ exists: button.selector }],
        detectPopup: [{ visible: button.selector }],
        optIn: [],
        optOut: [{ wait: 500 }, { waitForThenClick: button.selector, comment: button.text }],
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
 * Handle cases where there are existing rules for the same region.
 * @param {object} context - The context.
 * @param {import('./types').AutoConsentCMPRule} context.newRule
 * @param {import('./types').AutoConsentCMPRule[]} context.existingRulesWithSameRegion
 * @param {string} context.initialUrl
 * @param {string} context.region
 * @param {import('./types').AutoConsentCMPRule[]} context.matchingRules
 * @param {import('./types').AutoConsentCMPRule[]} context.rulesToOverride
 * @param {import('./types').AutoConsentCMPRule[]} context.newRules
 * @param {import('./types').ReviewNote[]} context.reviewNotes
 */
function overrideExistingRegionRules({
    newRule,
    existingRulesWithSameRegion,
    initialUrl,
    region,
    matchingRules,
    rulesToOverride,
    newRules,
    reviewNotes,
}) {
    if (existingRulesWithSameRegion.length > 1) {
        console.warn('Multiple existing rules with the same region found for', initialUrl, region);
        reviewNotes.push({
            needsReview: true,
            note: 'Multiple existing rules with the same region found, consider removing all but one',
            ruleNames: existingRulesWithSameRegion.map((rule) => rule.name),
            existingRules: matchingRules.map((rule) => rule.name),
            region,
        });
    }

    // find an existing rule that we haven't overridden yet
    const ruleToOverride = existingRulesWithSameRegion.find((rule) => !rulesToOverride.some((r) => r.name === rule.name));
    if (!ruleToOverride) {
        console.warn('Already overridden all existing rules for', initialUrl, region, 'creating a new one');
        reviewNotes.push({
            needsReview: true,
            note: 'Already overridden all existing rules, creating a new one',
            ruleName: newRule.name,
            existingRules: existingRulesWithSameRegion.map((rule) => rule.name),
            region,
        });
        newRules.push(newRule);
    } else {
        rulesToOverride.push({
            ...newRule,
            name: ruleToOverride.name, // keep the existing rule name
            _metadata: ruleToOverride._metadata, // keep the existing metadata
        });
        if (ruleToOverride._metadata?.manuallyReviewUpdates) {
            reviewNotes.push({
                needsReview: true,
                note: 'Updated rule that has been manually edited before',
                ruleName: ruleToOverride.name,
                existingRules: matchingRules.map((rule) => rule.name),
                region,
            });
        } else {
            reviewNotes.push({
                needsReview: false,
                note: 'Overriding existing rule',
                ruleName: ruleToOverride.name,
                existingRules: matchingRules.map((rule) => rule.name),
                region,
            });
        }
    }
}

/**
 * Processes a single reject button, deciding whether to create a new rule,
 * override an existing one, or do nothing.
 * @param {object} context - The context for processing the button.
 * @param {string} context.region
 * @param {string} context.initialUrl
 * @param {string} context.finalUrl
 * @param {import('./types').ScrapeScriptResult} context.frame
 * @param {import('./types').ButtonData} context.button
 * @param {import('./types').AutoConsentCMPRule[]} context.matchingRules
 * @param {import('./types').AutoConsentCMPRule[]} context.newRules
 * @param {import('./types').AutoConsentCMPRule[]} context.rulesToOverride
 * @param {import('./types').ReviewNote[]} context.reviewNotes
 */
function processRejectButton({ region, initialUrl, frame, button, matchingRules, newRules, rulesToOverride, reviewNotes }) {
    let newRule;
    try {
        newRule = generateAutoconsentRule(region, initialUrl, frame, button);
    } catch (err) {
        console.error(`Error generating rule for ${initialUrl} (${frame.origin})`, err);
        return;
    }

    if (matchingRules.length === 0) {
        // add the first rule for this site
        newRules.push(newRule);
        reviewNotes.push({
            needsReview: false,
            note: 'New rule added',
            ruleName: newRule.name,
        });
        return;
    }

    // there were some existing rules for this site, but all of them use different selectors
    // this can happen for several reasons: site uses different popups in different regions, or the popup has changed since last crawl
    const existingRulesWithSameRegion = matchingRules.filter((rule) => parseRuleName(rule.name).region === region);

    if (existingRulesWithSameRegion.length > 0) {
        // if there is an existing rule with the same region, override it
        overrideExistingRegionRules({
            newRule,
            existingRulesWithSameRegion,
            initialUrl,
            region,
            matchingRules,
            rulesToOverride,
            newRules,
            reviewNotes,
        });
    } else {
        // assume it's a new region-specific popup, but flag it for review
        newRules.push(newRule);
        reviewNotes.push({
            needsReview: false,
            note: 'New region-specific popup',
            ruleName: newRule.name,
            existingRules: matchingRules.map((rule) => rule.name),
            region,
        });
    }
}

/**
 * Analyze existing rules and generate new rules when necessary.
 * @param {string} region
 * @param {string} initialUrl - The URL of the initial page.
 * @param {string} finalUrl - The URL of the final page (after load redirects).
 * @param {import('./types').CookiePopupsCollectorResult} collectorResult - The collector result.
 * @param {import('./types').AutoConsentCMPRule[]} matchingRules - Array of existing rules.
 * @returns {{newRules: import('./types').AutoConsentCMPRule[], rulesToOverride: import('./types').AutoConsentCMPRule[], reviewNotes: import('./types').ReviewNote[], keptCount: number}}
 */
function generateRulesForSite(region, initialUrl, finalUrl, collectorResult, matchingRules) {
    /** @type {import('./types').AutoConsentCMPRule[]} */
    const newRules = [];
    /** @type {import('./types').AutoConsentCMPRule[]} */
    const rulesToOverride = [];
    /** @type {import('./types').ReviewNote[]} */
    const reviewNotes = [];
    let keptCount = 0;

    // const llmConfirmedPopups = collectorResult.scrapedFrames.flatMap((frame) => frame.potentialPopups).filter((popup) => popup.llmMatch);
    const regexConfirmedPopups = collectorResult.scrapedFrames.flatMap((frame) => frame.potentialPopups).filter((popup) => popup.regexMatch);
    // if (llmConfirmedPopups.length > 1 || llmConfirmedPopups[0].rejectButtons.length > 1) {
    if (regexConfirmedPopups.length > 1 || regexConfirmedPopups[0].rejectButtons.length > 1) {
        console.warn('Multiple cookie popups or reject buttons found in', initialUrl);
        reviewNotes.push({
            needsReview: false, // it's not a problem by itself, unless this leads to multiple _rules_ generated, but we check that separately.
            note: 'Multiple popups or reject buttons found',
            url: initialUrl,
            region,
        });
    }

    // go over all frames, all confirmed popups within them, and all reject buttons inside
    for (const frame of collectorResult.scrapedFrames) {
        // for (const popup of frame.potentialPopups.filter((p) => p.llmMatch)) {
        for (const popup of frame.potentialPopups.filter((p) => p.regexMatch)) {
            for (const button of popup.rejectButtons) {
                if (ruleForButtonExists(button, matchingRules, newRules, rulesToOverride)) {
                    // if there is an existing rule with the same reject button, do nothing
                    keptCount++;
                    continue;
                }
                processRejectButton({ region, initialUrl, finalUrl, frame, button, matchingRules, newRules, rulesToOverride, reviewNotes });
            }
        }
    }

    if (newRules.length > 1) {
        reviewNotes.push({
            needsReview: true,
            note: 'Multiple new rules generated',
            ruleNames: newRules.map((rule) => rule.name),
        });
    }
    return { newRules, rulesToOverride, reviewNotes, keptCount };
}

module.exports = {
    generateRulesForSite,
};
