const assert = require('assert');
const Utils = require('../utils.js');

describe('Utils helper', function() {
    it('should ignore prototype pollution keys during deep merge', function() {
        const pollutionKey = 'pollutedByPubliiMergeTest';
        const source = JSON.parse(`{
            "__proto__": {
                "${pollutionKey}": true
            },
            "constructor": {
                "prototype": {
                    "${pollutionKey}": true
                }
            },
            "safe": {
                "value": 1
            }
        }`);

        delete Object.prototype[pollutionKey];

        let merged = Utils.mergeObjects({}, source);

        assert.strictEqual(Object.prototype[pollutionKey], undefined);
        assert.deepStrictEqual(merged, {
            safe: {
                value: 1
            }
        });

        delete Object.prototype[pollutionKey];
    });

    it('should return unique responsive image groups', function() {
        let themeConfig = {
            files: {
                responsiveImages: {
                    contentImages: {
                        dimensions: {
                            first: {
                                group: 'hero,card'
                            },
                            second: {
                                group: 'card'
                            },
                            third: {
                                group: 'hero'
                            }
                        }
                    }
                }
            }
        };

        assert.deepStrictEqual(Utils.responsiveImagesGroups(themeConfig, 'contentImages'), ['hero', 'card']);
    });
});
