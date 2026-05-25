const fs = require('fs');
const url = require('url');
const path = require('path');
const FileHelper = require('./../../helpers/file.js');
const moment = require('moment');
const { XMLParser } = require('fast-xml-parser');
const download = require('image-downloader');
const automaticParagraphs = require('./automatic-paragraphs.js');
const slug = require('./../../helpers/slug');
const Author = require('./../../author.js');
const Tag = require('./../../tag.js');
const Post = require('./../../post.js');
const Page = require('./../../page.js');
const Utils = require('./../../helpers/utils.js');

/**
 * Class used to parse WXR files
 */
class WxrParser {
    /**
     * Create an instance
     *
     * @param appInstance
     * @param siteName
     */
    constructor(appInstance, siteName) {
        this.appInstance = appInstance;
        this.siteName = siteName;
        this.importAuthors = false;
        this.autop = false;
        this.usedTaxonomy = 'tags';
        this.postTypes = [];
        this.temp = {
            authors: [],
            posts: [],
            pages: [],
            tags: [],
            tagReferences: {},
            images: [],
            mapping: {
                authors: [],
                tags: [],
                images: [],
                posts: [],
                pages: []
            },
            imagesQueue: {}
        };
    }

    normalizeToArray(items) {
        if (!items) {
            return [];
        }

        return Array.isArray(items) ? items : [items];
    }

    getXmlTextValue(value) {
        if (!value) {
            return '';
        }

        if (typeof value === 'object' && value['#text']) {
            return value['#text'];
        }

        return value.toString();
    }

    findAuthorForMapping(authors, authorUsername, authorName) {
        authors = this.normalizeToArray(authors);

        return authors.find(author => slug(author.username) === authorUsername) ||
            authors.find(author => author.name === authorName) ||
            authors[0] ||
            false;
    }

    /**
     * Load WXR file and parse it
     *
     * @param filePath
     */
    loadFile(filePath) {
        this.filePath = filePath;
        this.fileContent = FileHelper.readFileSync(this.filePath, 'utf8');
        this.fileContent = this.fileContent.trim();
        this.parseFile();
    }

    /**
     * Check if loaded WXR file is a WXR file
     *
     * @returns {boolean}
     */
    isWXR() {
        if(path.parse(this.filePath).ext !== '.xml') {
            return false;
        }

        if(
            this.fileContent.indexOf('<!-- generator="WordPress') === -1 &&
            this.fileContent.indexOf('<wp:wxr_version>') === -1
        ) {
            return false;
        }

        return true;
    }

    /**
     * Transform XML to JSON
     *
     * @returns {boolean}
     */
    parseFile() {
        let results = false;
        try {
            let xmlParser = new XMLParser({
                ignoreAttributes: false,
                attributeNamePrefix : "@_"
            });
            results = xmlParser.parse(this.fileContent);
        } catch(e) {
            console.log('An error occurred:', e);
            return false;
        }

        this.parsedContent = results;

        return true;
    }

    /**
     * Analyzes WXR content and returns its stats
     *
     * @returns {{authors: number, categories: number, tags: number, images: number, posts: number}}
     */
    getWxrStats() {
        let authors = this.parsedContent.rss.channel['wp:author'];
        let categories = this.parsedContent.rss.channel['wp:category'];
        let tags = this.parsedContent.rss.channel['wp:tag'];
        let items = this.parsedContent.rss.channel['item'];

        if (!Array.isArray(items)) {
            items = [items];
        }

        let postTypes = this.getPostTypes(items);

        let stats = {
            authors: this.getItemsCount(authors),
            categories: this.getItemsCount(categories),
            tags: this.getItemsCount(tags),
            types: {
                image: this.getItemsCount(items, 'attachment'),
                post: this.getItemsCount(items, 'post'),
                page: this.getItemsCount(items, 'page')
            }
        };

        for(let postType of postTypes) {
            stats.types[postType] = this.getItemsCount(items, postType);
        }

        return stats;
    }

    /**
     * Return number of items of given type
     *
     * @param items
     * @param filterType
     * @returns {number}
     */
    getItemsCount(items, filterType = false) {
        if(filterType) {
            items = items.filter(item => item['wp:post_type'] === filterType);
        }

        if(items && (items.length || items.length === 0)) {
            return items.length;
        }

        if(typeof items === 'object') {
            return 1;
        }

        return 0;
    }

    /**
     * Detects post types (without default post types)
     *
     * @param items
     * @returns {Array}
     */
    getPostTypes(items) {
        let skippedTypes = ['post', 'page', 'attachment', 'nav_menu_item'];
        let foundedTypes = [];

        for(let item of items) {
            if(skippedTypes.indexOf(item['wp:post_type']) !== -1) {
                continue;
            }

            if(foundedTypes.indexOf(item['wp:post_type']) !== -1) {
                continue;
            }

            foundedTypes.push(item['wp:post_type']);
        }

        return foundedTypes;
    }

    /**
     * Set configuration of parser and importer
     *
     * @param authors
     * @param taxonomy
     * @param autop
     * @param postTypes
     */
    setConfig(authors, taxonomy, autop, postTypes) {
        this.importAuthors = false;
        this.usedTaxonomy = taxonomy;
        this.autop = autop;
        this.postTypes = postTypes;

        if(authors === 'wp-authors') {
            this.importAuthors = true;
        }

        console.log('(i) CONFIG:');
        console.log('- Import authors: ' + this.importAuthors);
        console.log('- Used taxonomy: ' + this.usedTaxonomy);
        console.log('- Use autop: '+ this.autop + "\n\n");
        console.log('- Post types: '+ this.postTypes.toString() + "\n\n");
    }

    /**
     * Import authors related data
     */
    importAuthorsData() {
        // If authors import is disabled - skip authors import
        if(!this.importAuthors) {
            return;
        }

        // get all authors items
        let authors = this.normalizeToArray(this.parsedContent.rss.channel['wp:author']);

        for(let i = 0; i < authors.length; i++) {
            this.createAuthor(authors[i], i, authors.length);
        }
    }

    /**
     * Creates an author
     *
     * @param authorData
     * @param index
     * @param totalNumber
     */
    createAuthor(authorData, index, totalNumber) {
        let authorLogin = this.getXmlTextValue(authorData['wp:author_login']);
        let authorUsername = slug(authorLogin);
        let authorName = this.getXmlTextValue(authorData['wp:author_display_name']) || authorLogin || 'Imported author';
        let authorEmail = this.getXmlTextValue(authorData['wp:author_email']);
        // For each author item insert author object
        let newAuthor = new Author(this.appInstance, {
            id: 0,
            site: this.siteName,
            name: authorName,
            username: authorUsername,
            config: JSON.stringify({
                email: authorEmail,
                avatar: '',
                useGravatar: false,
                description: '',
                metaTitle: '',
                metaDescription: '',
                template: ''
            }),
            additionalData: {}
        }, false);

        let newAuthorResult = newAuthor.save();
        let importedAuthorID = newAuthorResult.authorID;

        if (!importedAuthorID) {
            let authors = newAuthorResult.authors || newAuthor.authorsData.load();
            let mappedAuthor = this.findAuthorForMapping(authors, authorUsername, authorName);
            importedAuthorID = mappedAuthor ? mappedAuthor.id : 1;
        }

        // Store tag ID in the internal array AS:
        // wp:tag_slug -> tag ID in Publii
        this.temp.authors[authorUsername] = importedAuthorID;
        this.temp.mapping.authors[this.getXmlTextValue(authorData['wp:author_id'])] = importedAuthorID;

        process.send({
            type: 'progress',
            message: {
                translation: 'core.wpImport.authorsProgressInfo',
                translationVars: {
                    progress: (index + 1),
                    total: totalNumber
                }
            }
        });

        console.log('-> Imported author (' + (index + 1) + ' / ' + totalNumber + '): ' + authorUsername);
    }

    /**
     * Import tags related data
     */
    importTagsData() {
        let items = false;

        if(this.usedTaxonomy === 'tags') {
            items = this.parsedContent.rss.channel['wp:tag'];
        } else {
            items = this.parsedContent.rss.channel['wp:category'];
        }

        items = this.normalizeToArray(items);

        if(!items.length) {
            return;
        }

        for (let i = 0; i < items.length; i++) {
            this.createTag(items[i], i, items.length);
        }
    }

    /**
     * Creates tag
     *
     * @param tagData
     * @param index
     * @param totalNumber
     */
    createTag(tagData, index, totalNumber) {
        let itemName = this.getTaxonomyName(tagData);
        let originalItemSlug = this.getTaxonomySlug(tagData);
        let itemSlug = originalItemSlug;
        let importedTag = false;
        let newItemResult = false;

        if (!itemName) {
            return;
        }

        if (!itemSlug) {
            itemSlug = slug(itemName);
            originalItemSlug = itemSlug;
        }

        // For each author item insert author object
        let newItem = new Tag(this.appInstance, {
            id: 0,
            site: this.siteName,
            name: itemName,
            slug: itemSlug,
            description: '',
            additionalData: ''
        }, false);

        newItemResult = newItem.save();

        if(newItemResult.tags) {
            importedTag = this.findTagForMapping(newItemResult.tags, itemSlug, itemName);
        } else {
            let existingTags = newItem.tagsData.load();
            let tagWithSameName = existingTags.find(tag => tag.name === itemName);

            if(tagWithSameName) {
                importedTag = tagWithSameName;
            } else if(newItemResult.message === 'tag-duplicate-slug') {
                itemSlug = this.getUniqueTaxonomySlug(itemSlug, existingTags);

                newItem = new Tag(this.appInstance, {
                    id: 0,
                    site: this.siteName,
                    name: itemName,
                    slug: itemSlug,
                    description: '',
                    additionalData: ''
                });

                newItemResult = newItem.save();
                importedTag = newItemResult.tags ? this.findTagForMapping(newItemResult.tags, itemSlug, itemName) : false;
            } else {
                importedTag = this.findTagForMapping(existingTags, itemSlug, itemName);
            }
        }

        if(!importedTag) {
            return;
        }

        this.temp.tags[originalItemSlug] = importedTag.id;
        this.temp.tagReferences[originalItemSlug] = importedTag.name || itemName;
        this.temp.mapping.tags[this.getTaxonomyTermID(tagData)] = importedTag.id;

        process.send({
            type: 'progress',
            message: {
                translation: 'core.wpImport.tagsProgressInfo',
                translationVars: {
                    progress: (index + 1),
                    total: totalNumber
                }
            }
        });

        console.log('-> Imported tag (' + (index + 1) + ' / ' + totalNumber + '): ' + itemName);
    }

    getTaxonomyName(tagData) {
        if(this.usedTaxonomy === 'tags') {
            return this.getXmlTextValue(tagData['wp:tag_name']);
        }

        return this.getXmlTextValue(tagData['wp:cat_name']);
    }

    getTaxonomySlug(tagData) {
        if(this.usedTaxonomy === 'tags') {
            return this.getXmlTextValue(tagData['wp:tag_slug']);
        }

        return this.getXmlTextValue(tagData['wp:category_nicename']);
    }

    getTaxonomyTermID(tagData) {
        return this.getXmlTextValue(tagData['wp:term_id']);
    }

    findTagForMapping(tags, itemSlug, itemName) {
        tags = this.normalizeToArray(tags);

        return tags.find(tag => tag.slug === slug(itemSlug)) ||
            tags.find(tag => tag.name === itemName) ||
            false;
    }

    getUniqueTaxonomySlug(itemSlug, tags) {
        let existingSlugs = this.normalizeToArray(tags).map(tag => tag.slug);
        let baseSlug = itemSlug;
        let suffix = 2;

        while (existingSlugs.indexOf(slug(itemSlug)) !== -1) {
            itemSlug = baseSlug + '-' + suffix;
            suffix++;
        }

        return itemSlug;
    }

    getPostTagsFromCategories(categories) {
        let postTags = [];

        categories = this.normalizeToArray(categories);

        if(!categories.length) {
            return postTags;
        }

        let taxonomyDomain = this.usedTaxonomy === 'tags' ? 'post_tag' : 'category';
        let tags = categories.filter(item => {
            return typeof item === 'object' && item['@_domain'] === taxonomyDomain;
        });

        postTags = tags.map(tag => {
            let tagSlug = this.getXmlTextValue(tag['@_nicename']);
            let tagName = this.getXmlTextValue(tag['#text']);

            if(tagSlug && this.temp.tagReferences[tagSlug]) {
                return this.temp.tagReferences[tagSlug];
            }

            return tagName;
        }).filter(Boolean);

        return [...new Set(postTags)];
    }

    /**
     * Import posts data
     */
    importPostsData() {
        let posts = this.parsedContent.rss.channel['item'];
        let newPost;

        posts = Array.isArray(posts) ? posts : [posts];
        posts = posts && posts.length ? posts.filter(item => this.postTypes.indexOf(item['wp:post_type']) !== -1 && item['wp:post_type'] !== 'page') : false;

        if(!posts) {
            return;
        }

        let untitledPostsCount = 1;

        for(let i = 0; i < posts.length; i++) {
            if (!posts[i].title) {
                console.log('(!) Empty post title detected - fallback to "Untitled #X" title');
                posts[i].title = 'Untitled #' + untitledPostsCount++;
            }

            // For each post item insert post object
            let postImages = this.getPostImages(posts[i]['content:encoded']);
            let postSlug = slug(posts[i].title);
            let postAuthor = this.temp.authors[slug(this.getXmlTextValue(posts[i]['dc:creator']))];
            let postText = this.preparePostText(posts[i]['content:encoded'], postImages);
            let postStatus = posts[i]['wp:status'] === 'draft' ? 'draft' : 'published'
            let postTags = '';
            let postTitle = (posts[i].title).toString();

            postTags = this.getPostTagsFromCategories(posts[i]['category']);

            if(!this.importAuthors) {
                postAuthor = '1';
            }

            if(!postAuthor) {
                postAuthor = '1';
            }

            newPost = new Post(this.appInstance, {
                id: 0,
                site: this.siteName,
                title: postTitle,
                slug: postSlug,
                author: postAuthor,
                status: postStatus,
                tags: postTags,
                text: postText,
                creationDate: moment(posts[i]['wp:post_date']).format('x'),
                modificationDate: moment().format('x'),
                template: '',
                additionalData: '',
                postViewSettings: ''
            }, false);

            let newPostResult = newPost.save();
            let newPostID = newPostResult.postID;

            this.temp.posts[postSlug] = newPostID;
            this.temp.mapping.posts[posts[i]['wp:post_id']] = newPostID;

            // Create queue for download images
            if(postImages.length) {
                this.temp.imagesQueue[newPostID] = postImages;
            }

            let featuredImage = this.getFeaturedPostImage(posts[i]);
            let fileName = false;

            if(featuredImage) {
                fileName = path.parse(featuredImage).base;

                if(!this.temp.imagesQueue[newPostID]) {
                    this.temp.imagesQueue[newPostID] = [];
                }

                this.temp.imagesQueue[newPostID].push(featuredImage);
            }

            if(fileName) {
                let featuredPostImageSqlQuery = newPost.db.prepare(`INSERT INTO posts_images VALUES(NULL, @newPostID, @fileName, '', '', @config)`);
                featuredPostImageSqlQuery.run({
                    newPostID: newPostID,
                    fileName: fileName,
                    config: '{"alt":"","caption":"","credits":""}'
                });

                let featuredPostID = newPost.db.prepare('SELECT last_insert_rowid() AS id').get().id;
                let featuredPostIdUpdate = newPost.db.prepare(`UPDATE posts SET featured_image_id = @featuredPostID WHERE id = @newPostID`);

                featuredPostIdUpdate.run({
                    featuredPostID,
                    newPostID
                });
            }

            process.send({
                type: 'progress',
                message: {
                    translation: 'core.wpImport.postsProgressInfo',
                    translationVars: {
                        progress: (i + 1),
                        total: posts.length
                    }
                }
            });

            console.log('-> Imported post (' + (i+1) + ' / ' + posts.length + '): ' + postTitle);
        }
    }

    /**
     * Import pages data
     */
    importPagesData() {
        if (this.postTypes.indexOf('page') === -1) {
            console.log('(!) Pages import is disabled');
            return;
        }

        let pages = this.parsedContent.rss.channel['item'];
        let newPage;
        pages = Array.isArray(pages) ? pages : [pages];
        pages = pages && pages.length ? pages.filter(item => item['wp:post_type'] === 'page') : false;

        if(!pages) {
            console.log('(!) No pages to import');
            return;
        }

        let untitledPagesCount = 1;

        console.log('(X) pages:', pages);

        for(let i = 0; i < pages.length; i++) {
            if (!pages[i].title) {
                console.log('(!) Empty page title detected - fallback to "Untitled #X" title');
                pages[i].title = 'Untitled #' + untitledPagesCount++;
            }

            // For each page item insert post object
            let pageImages = this.getPostImages(pages[i]['content:encoded']);
            let pageSlug = slug(pages[i].title);
            let pageAuthor = this.temp.authors[slug(this.getXmlTextValue(pages[i]['dc:creator']))];
            let pageText = this.preparePostText(pages[i]['content:encoded'], pageImages);
            let pageStatus = pages[i]['wp:status'] === 'draft' ? 'draft,is-page' : 'published,is-page'
            let pageTitle = (pages[i].title).toString();

            if(!this.importAuthors) {
                pageAuthor = '1';
            }

            if(!pageAuthor) {
                pageAuthor = '1';
            }

            newPage = new Page(this.appInstance, {
                id: 0,
                site: this.siteName,
                title: pageTitle,
                slug: pageSlug,
                author: pageAuthor,
                status: pageStatus,
                text: pageText,
                creationDate: moment(pages[i]['wp:post_date']).format('x'),
                modificationDate: moment().format('x'),
                template: '',
                additionalData: '',
                pageViewSettings: ''
            }, false);

            let newPageResult = newPage.save();
            let newPageID = newPageResult.pageID;

            this.temp.pages[pageSlug] = newPageID;
            this.temp.mapping.pages[pages[i]['wp:post_id']] = newPageID;

            // Create queue for download images
            if(pageImages.length) {
                this.temp.imagesQueue[newPageID] = pageImages;
            }

            let featuredImage = this.getFeaturedPostImage(pages[i]);
            let fileName = false;

            if(featuredImage) {
                fileName = path.parse(featuredImage).base;

                if(!this.temp.imagesQueue[newPageID]) {
                    this.temp.imagesQueue[newPageID] = [];
                }

                this.temp.imagesQueue[newPageID].push(featuredImage);
            }

            if(fileName) {
                let featuredPageImageSqlQuery = newPage.db.prepare(`INSERT INTO posts_images VALUES(NULL, @newPageID, @fileName, '', '', @config)`);
                featuredPageImageSqlQuery.run({
                    newPageID: newPageID,
                    fileName: fileName,
                    config: '{"alt":"","caption":"","credits":""}'
                });

                let featuredPageID = newPage.db.prepare('SELECT last_insert_rowid() AS id').get().id;
                let featuredPageIdUpdate = newPage.db.prepare(`UPDATE posts SET featured_image_id = @featuredPageID WHERE id = @newPageID`);

                featuredPageIdUpdate.run({
                    featuredPageID,
                    newPageID
                });
            }

            process.send({
                type: 'progress',
                message: {
                    translation: 'core.wpImport.pagesProgressInfo',
                    translationVars: {
                        progress: (i + 1),
                        total: pages.length
                    }
                }
            });

            console.log('-> Imported page (' + (i+1) + ' / ' + pages.length + '): ' + pageTitle);
        }
    }

    /**
     * Create array with all available images for download
     */
    getImageURLs() {
        let items = this.parsedContent.rss.channel['item'];
        items = this.normalizeToArray(items);

        if (items && items.length) {
            items = items.filter(item => item['wp:post_type'] === 'attachment');

            for (let item of items) {
                let imageURL = this.getXmlTextValue(item['wp:attachment_url']);

                if (!imageURL) {
                    imageURL = this.getXmlTextValue(item.guid);
                }

                if (imageURL) {
                    this.temp.images[item['wp:post_id']] = imageURL;
                }
            }
        }
    }

    /**
     * Retrieve images connected with a given post text
     *
     * @param postText
     */
    getPostImages(postText) {
        let postImages = [];
        let regex = /<img\b[^>]*\ssrc\s*=\s*["']([^"']+)["']/gmi;
        let regexResult = null;

        if (typeof postText !== 'string') {
            return postImages;
        }

        // Get images from the content
        do {
            regexResult = regex.exec(postText);

            if(regexResult !== null) {
                let postImage = regexResult[1];
                postImages.push(postImage);
            }
        } while(regexResult);

        return postImages;
    }

    /**
     * Retrieve featured post image
     *
     * @param postObject
     * @returns {boolean}
     */
    getFeaturedPostImage(postObject) {
        let featuredImage = false;
        let postMetaItems = this.normalizeToArray(postObject['wp:postmeta']);

        if(!postMetaItems.length) {
            return false;
        }

        // Get featured image
        for(let postMeta of postMetaItems) {
            if(this.getXmlTextValue(postMeta['wp:meta_key']) === '_thumbnail_id') {
                let featuredImageID = this.getXmlTextValue(postMeta['wp:meta_value']);

                if(this.temp.images[featuredImageID]) {
                    featuredImage = this.temp.images[featuredImageID];
                }
            }
        }

        return featuredImage;
    }

    /**
     * Import images data
     */
    importImages() {
        let postIDs = Object.keys(this.temp.imagesQueue);
        let imagesQueue = [];
        let destinationPath = path.join(
            this.appInstance.sitesDir,
            this.siteName,
            'input',
            'media',
            'posts'
        );
        this.downloadImagesProgress = 0;
        this.totalImages = this.countImages();

        for(let i = 0; i < postIDs.length; i++) {
            let imagesForPost = this.temp.imagesQueue[postIDs[i]];
            imagesForPost = [...new Set(imagesForPost)];

            for(let j = 0; j < imagesForPost.length; j++) {
                let img = imagesForPost[j];
                imagesQueue.push({
                    postID: postIDs[i],
                    imgUrl: img
                });
            }
        }

        this.downloadImages(imagesQueue, destinationPath);
    }

    /**
     * Downloads images from queue
     *
     * @param imagesQueue
     * @param destinationPath
     */
    downloadImages(imagesQueue, destinationPath) {
        if(imagesQueue.length === 0) {
            this.finishImport();
            return;
        }

        let nextImg = imagesQueue.shift();
        let dirPath = path.join(destinationPath, (nextImg.postID).toString());

        if(!Utils.dirExists(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }

        let image = nextImg.imgUrl;
        let imageFileName = url.parse(image);

        if(imageFileName && imageFileName.pathname && imageFileName.protocol) {
            imageFileName = path.basename(imageFileName.pathname);

            download.image({
                url: image.replace(imageFileName, encodeURIComponent(imageFileName)),
                dest: path.join(dirPath, imageFileName),
                headers: {
                    'User-Agent': 'Publyy'
                }
            }).then(({filename, image}) => {
                this.downloadImagesProgress++;

                process.send({
                    type: 'progress',
                    message: {
                        translation: 'core.wpImport.imagesProgressInfo',
                        translationVars: {
                            progress: this.downloadImagesProgress,
                            total: this.totalImages
                        }
                    }
                });

                console.log('-> Downloaded image: ' + filename);

                setTimeout(() => {
                    this.downloadImages(imagesQueue, destinationPath);
                }, 250);
            }).catch(err => {
                this.downloadImagesProgress++;

                process.send({
                    type: 'progress',
                    message: {
                        translation: 'core.wpImport.imageDownloadError',
                        translationVars: {
                            image: image
                        }
                    }
                });

                console.log('(!) An error occurred during downloading the image: ' + image);
                console.log(err);

                setTimeout(() => {
                    this.downloadImages(imagesQueue, destinationPath);
                }, 250);
            });
        } else {
            console.log('(!!) An error occurred during downloading the image: ' + image);

            setTimeout(() => {
                this.downloadImages(imagesQueue, destinationPath);
            }, 250);
        }
    }

    /**
     * Counts images to download
     */
    countImages() {
        let postIDs = Object.keys(this.temp.imagesQueue);
        let sum = 0;

        for(let i = 0; i < postIDs.length; i++) {
            sum += [...new Set(this.temp.imagesQueue[postIDs[i]])].length;
        }

        return sum;
    }

    /**
     * Prepares post text to import
     *
     * @param text
     */
    preparePostText(text, images) {
        // Case when content is empty
        if(typeof text !== 'string') {
            return '';
        }

        // Replace images with #DOMAIN_NAME#
        if(images.length) {
            for (let image of images) {
                let imageFileName = url.parse(image);

                if(imageFileName && imageFileName.pathname) {
                    imageFileName = path.basename(imageFileName.pathname);
                    text = text.split(image).join('#DOMAIN_NAME#' + imageFileName);
                }
            }
        }

        // Remove [caption] from content
        text = text.replace(/\[caption.*?\]/g, '');
        text = text.replace(/\[\/caption\]/g, '');

        // Replace <!-- more --> with Publii separator
        text = text.replace(/<!--more-->/g, '<hr id="read-more">');

        if(this.autop) {
            console.log('(i) Used automatic paragraphs for the post content');
            text = automaticParagraphs(text);
        }

        return text;
    }

    /**
     * Finishing import process
     */
    finishImport() {
        process.send({
            type: 'result',
            status: 'success',
            message: true
        });

        console.log('(i) Import is done');

        setTimeout(function() {
            process.exit();
        }, 1000);
    }
}

module.exports = WxrParser;
