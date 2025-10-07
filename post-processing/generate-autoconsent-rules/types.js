/**
 * @typedef {{
 *  data: {
 *      cookiepopups: import('../../collectors/CookiePopupsCollector').CookiePopupsCollectorResult;
 *      screenshots?: string;
 *  };
 *  initialUrl: string;
 *  finalUrl: string;
 * }} CrawlData
 */

/**
 * @typedef {import('../../collectors/CookiePopupsCollector').PopupData & {
 *  llmMatch: boolean;
 *  regexMatch: boolean;
 *  rejectButtons: import('../../collectors/CookiePopupsCollector').ButtonData[];
 *  otherButtons: import('../../collectors/CookiePopupsCollector').ButtonData[];
 * }} ProcessedCookiePopup
 */

/**
 * @typedef {{
 *  note: string;
 *  needsReview: boolean;
 *  url?: string;
 *  region?: string;
 *  ruleName?: string;
 *  ruleNames?: string[];
 *  existingRules?: string[];
 * }} ReviewNote
 */

/**
 * @typedef {{
 *  ruleName: string;
 *  rulePath: string;
 *  testPath: string;
 * }} AutoconsentManifestFileData
 */

/**
 * @typedef {{
 *  siteUrl: string;
 *  matchedRules: string[];
 *  _llmConfirmedPopups?: PopupData[];
 *  regexConfirmedPopups: PopupData[];
 *  screenshot: string;
 *  newlyCreatedRules: AutoconsentManifestFileData[];
 *  updatedRules: AutoconsentManifestFileData[];
 *  reviewNotes: ReviewNote[];
 * }} AutoconsentSiteManifest
 */

/**
 * @typedef {{
 *  crawlDir: string,
 *  rulesDir: string,
 *  testDir: string,
 *  autoconsentDir: string,
 *  region: string,
 *  autoconsentManifestFile: string,
 * }} GlobalParams
 */

/**
 * @typedef {import('../../node_modules/@duckduckgo/autoconsent/lib/rules').AutoConsentCMPRule} AutoConsentCMPRule
 */

/**
 * @typedef {import('../../collectors/CookiePopupsCollector').ButtonData} ButtonData
 */

/**
 * @typedef {import('../../collectors/CookiePopupsCollector').ScrapeScriptResult} ScrapeScriptResult
 */

/**
 * @typedef {import('../../collectors/CookiePopupsCollector').PopupData} PopupData
 */

/**
 * @typedef {import('../../collectors/CookiePopupsCollector').CookiePopupsCollectorResult} CookiePopupsCollectorResult
 */

/**
 * @typedef {import('../../collectors/CookiePopupsCollector').AutoconsentResult} AutoconsentResult
 */

module.exports = {};
