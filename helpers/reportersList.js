// eslint-disable-next-line no-unused-vars
const BaseReporter = require('../reporters/BaseReporter');
const CLIReporter = require('./../reporters/CLIReporter');
const FileReporter = require('./../reporters/FileReporter');
const HTMLReporter = require('./../reporters/HTMLReporter');
const ClickhouseReporter = require('./../reporters/ClickhouseReporter');
const reporterClasses = [CLIReporter, FileReporter, HTMLReporter, ClickhouseReporter];
const reporters = reporterClasses.map(ReporterClass => ({
    // @ts-ignore
    id: (new ReporterClass()).id(),
    Klass: ReporterClass
}));

/**
 * @returns {string[]}
 */
function getReporterIds() {
    return reporters.map(({id}) => id);
}

/**
 * @param {string} id 
 * @returns {BaseReporter}
 */
function createReporter(id) {
    const reporter = reporters.find(c => c.id === id);

    if (!reporter) {
        throw new Error(`Unknown reporter id "${id}".`);
    }

    // @ts-ignore
    return (new reporter.Klass());
}

module.exports = {
    getReporterIds,
    createReporter
};
