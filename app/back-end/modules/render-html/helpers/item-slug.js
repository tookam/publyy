const slug = require('./../../../helpers/slug');

class ItemSlugHelper {
    static create(item, fallbackPrefix) {
        let itemID = item && item.id ? item.id : '';
        let originalSlug = item && item.slug ? String(item.slug) : '';
        let fallbackSlug = item && item.title ? slug(item.title) : '';
        let preparedSlug = slug(originalSlug) || fallbackSlug || fallbackPrefix;

        if (preparedSlug !== originalSlug) {
            preparedSlug = slug.withSuffix(preparedSlug, itemID);
        }

        return preparedSlug || slug.withSuffix(fallbackPrefix, itemID);
    }
}

module.exports = ItemSlugHelper;
