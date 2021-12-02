const fs = require('fs');
const ALL_SCREENSHOTS = false;
/**
 * @type {string[]}
 */
let screenshotList = [];

/**
 * @param {string} filePath
 */
function loadScreenshotList (filePath) {
    screenshotList = fs.readFileSync(filePath, 'utf8').split('\n').reduce((list, site) => {
        if (site) {
            list.push(site);
        }
        return list;
    }, []);
}

/**
 * @param {URL} url
 * @returns {boolean}
 */
function shouldTakeScreenshot (url) {
    if (ALL_SCREENSHOTS) {
        return true;
    }
    return screenshotList.includes(url.hostname.replace(/^www\./, ''));
}

/**
 * @param {string} outputPath
 */
function rebuildIndex (outputPath) {
    const screenshotFiles = fs.readdirSync(`${outputPath}/screenshots`);
    let nScreenshots = 0;

    const bodyContent =screenshotFiles.reduce((str, name) => {
        if (name.match('jpg')) {
            nScreenshots++;
            // eslint-disable-next-line no-param-reassign
            str += `<p>${name.replace(/_.*\.jpg/,'')}</p><a href=${name}> <img src=${name} width="800" height="400" alt=${name}></a>`;
        }
        return str;
    }, '');

    const html = `<html>
        <head><title>Crawler screenshots</title></head>
            <body>
                <p>Number of screenshots: ${nScreenshots}</p>
                ${bodyContent}
            </body>
        </html>`;

    fs.writeFileSync(`${outputPath}/screenshots/index.html`, html);
}

module.exports = {
    loadScreenshotList,
    shouldTakeScreenshot,
    rebuildIndex
};
