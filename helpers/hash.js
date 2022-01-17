const crypto = require('crypto');

module.exports = {
    /**
     * @type {function(URL):string}
     */
    createUniqueUrlName: url => {
        let hash = crypto.createHash('sha1').update(url.toString()).digest('hex');
        hash = hash.substring(0, 4); // truncate to length 4
        return `${url.hostname}_${hash}`;
    }
};
