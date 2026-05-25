const assert = require('assert');
const WxrParser = require('../wxr-parser.js');

describe('WXR parser', function() {
    describe('#findAuthorForMapping', function() {
        it('should map duplicate WordPress authors to an existing Publii author by username', function() {
            let parser = new WxrParser({}, 'test-site');
            let author = parser.findAuthorForMapping([
                {
                    id: 1,
                    name: 'Main Author',
                    username: 'admin'
                }
            ], 'admin', 'Admin');

            assert.strictEqual(author.id, 1);
        });

        it('should map duplicate WordPress authors to an existing Publii author by display name', function() {
            let parser = new WxrParser({}, 'test-site');
            let author = parser.findAuthorForMapping([
                {
                    id: 2,
                    name: 'Line Editor',
                    username: 'editor'
                }
            ], 'line-admin', 'Line Editor');

            assert.strictEqual(author.id, 2);
        });
    });

    describe('#getImageURLs', function() {
        it('should store attachment URLs by WordPress attachment ID', function() {
            let parser = new WxrParser({}, 'test-site');

            parser.parsedContent = {
                rss: {
                    channel: {
                        item: {
                            'wp:post_type': 'attachment',
                            'wp:post_id': 1710,
                            'wp:attachment_url': 'https://example.com/uploads/image.jpg'
                        }
                    }
                }
            };

            parser.getImageURLs();

            assert.strictEqual(parser.temp.images[1710], 'https://example.com/uploads/image.jpg');
        });

        it('should use attachment guid when attachment_url is missing', function() {
            let parser = new WxrParser({}, 'test-site');

            parser.parsedContent = {
                rss: {
                    channel: {
                        item: {
                            'wp:post_type': 'attachment',
                            'wp:post_id': 1711,
                            guid: {
                                '#text': 'https://example.com/uploads/fallback.jpg',
                                '@_isPermaLink': 'false'
                            }
                        }
                    }
                }
            };

            parser.getImageURLs();

            assert.strictEqual(parser.temp.images[1711], 'https://example.com/uploads/fallback.jpg');
        });
    });

    describe('#getFeaturedPostImage', function() {
        it('should find featured image from a single postmeta object', function() {
            let parser = new WxrParser({}, 'test-site');
            parser.temp.images[1710] = 'https://example.com/uploads/featured.jpg';

            let featuredImage = parser.getFeaturedPostImage({
                'wp:postmeta': {
                    'wp:meta_key': '_thumbnail_id',
                    'wp:meta_value': '1710'
                }
            });

            assert.strictEqual(featuredImage, 'https://example.com/uploads/featured.jpg');
        });

        it('should find featured image from multiple postmeta objects', function() {
            let parser = new WxrParser({}, 'test-site');
            parser.temp.images[1710] = 'https://example.com/uploads/featured.jpg';

            let featuredImage = parser.getFeaturedPostImage({
                'wp:postmeta': [
                    {
                        'wp:meta_key': '_edit_last',
                        'wp:meta_value': '1'
                    },
                    {
                        'wp:meta_key': '_thumbnail_id',
                        'wp:meta_value': '1710'
                    }
                ]
            });

            assert.strictEqual(featuredImage, 'https://example.com/uploads/featured.jpg');
        });
    });

    describe('#getPostImages', function() {
        it('should extract double-quoted and single-quoted image sources', function() {
            let parser = new WxrParser({}, 'test-site');
            let postImages = parser.getPostImages(
                '<img src="https://example.com/uploads/one.jpg">' +
                "<img class='alignleft' src='https://example.com/uploads/two.jpg'>"
            );

            assert.deepStrictEqual(postImages, [
                'https://example.com/uploads/one.jpg',
                'https://example.com/uploads/two.jpg'
            ]);
        });
    });

    describe('#importTagsData', function() {
        it('should import a single WordPress category object', function() {
            let parser = new WxrParser({}, 'test-site');
            let imported = [];

            parser.usedTaxonomy = 'categories';
            parser.parsedContent = {
                rss: {
                    channel: {
                        'wp:category': {
                            'wp:term_id': 1,
                            'wp:category_nicename': 'actualite',
                            'wp:cat_name': 'Actualité'
                        }
                    }
                }
            };
            parser.createTag = item => imported.push(item);

            parser.importTagsData();

            assert.strictEqual(imported.length, 1);
            assert.strictEqual(imported[0]['wp:category_nicename'], 'actualite');
        });
    });

    describe('#getPostTagsFromCategories', function() {
        it('should attach posts to selected WordPress categories by nicename mapping', function() {
            let parser = new WxrParser({}, 'test-site');
            parser.usedTaxonomy = 'categories';
            parser.temp.tagReferences['emploi-aux-etats-unis'] = 'Emploi aux Etats-Unis';

            let tags = parser.getPostTagsFromCategories([
                {
                    '#text': 'emploi aux Etats-Unis',
                    '@_domain': 'post_tag',
                    '@_nicename': 'emploi-aux-etats-unis'
                },
                {
                    '#text': 'Emploi aux Etats-Unis',
                    '@_domain': 'category',
                    '@_nicename': 'emploi-aux-etats-unis'
                }
            ]);

            assert.deepStrictEqual(tags, ['Emploi aux Etats-Unis']);
        });

        it('should attach posts to selected WordPress tags by nicename mapping', function() {
            let parser = new WxrParser({}, 'test-site');
            parser.usedTaxonomy = 'tags';
            parser.temp.tagReferences['emploi-aux-etats-unis'] = 'emploi aux Etats-Unis';

            let tags = parser.getPostTagsFromCategories([
                {
                    '#text': 'Emploi aux Etats-Unis',
                    '@_domain': 'category',
                    '@_nicename': 'emploi-aux-etats-unis'
                },
                {
                    '#text': 'emploi aux Etats-Unis',
                    '@_domain': 'post_tag',
                    '@_nicename': 'emploi-aux-etats-unis'
                }
            ]);

            assert.deepStrictEqual(tags, ['emploi aux Etats-Unis']);
        });
    });
});
