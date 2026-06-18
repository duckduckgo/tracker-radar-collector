const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

/** @typedef {{ buttonText: string, occurences: number, label: string }} ButtonTextRow */

const CSV_COLUMNS = ['button_text', 'occurences', 'label'];

/**
 * @param {string} content
 * @returns {ButtonTextRow[]}
 */
function parseButtonTextCsv(content) {
    if (!content.trim()) {
        return [];
    }

    const records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true,
    });

    /** @type {ButtonTextRow[]} */
    const rows = [];
    for (const record of records) {
        const buttonText = record.button_text;
        const occurences = Number.parseInt(record.occurences, 10);
        if (!buttonText || Number.isNaN(occurences)) {
            continue;
        }
        const label = record.label ?? '';
        rows.push({ buttonText, occurences, label });
    }
    return rows;
}

/**
 * @param {string} filePath
 * @returns {ButtonTextRow[]}
 */
function readButtonTextCsv(filePath) {
    return parseButtonTextCsv(fs.readFileSync(filePath, 'utf8'));
}

/**
 * @param {ButtonTextRow[]} rows
 * @returns {string}
 */
function buttonTextRowsToCsv(rows) {
    return stringify(
        rows.map((row) => ({
            button_text: row.buttonText,
            occurences: row.occurences,
            label: row.label,
        })),
        {
            header: true,
            columns: CSV_COLUMNS,
        },
    );
}

module.exports = {
    readButtonTextCsv,
    buttonTextRowsToCsv,
};
