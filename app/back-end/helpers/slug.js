const transliterate = require('transliteration').transliterate;
const slug = require('slug');

const MAX_SLUG_LENGTH = 180;

/*
 * Custom mode of rfc3986 without unicode symbols
 */
slug.defaults.modes['rfc3986-non-unicode'] = {
    replacement: '-',                   // replace spaces with replacement
    symbols: false,                     // replace unicode symbols or not
    remove: /[\.]/g,                    // (optional) regex to remove characters
    lower: true,                        // result in lower case
    charmap: slug.charmap,              // replace special characters
    multicharmap: slug.multicharmap,    // replace multi-characters
    trim: true,                         // remove leading and trailing replacement chars
};

slug.defaults.modes['rfc3986-non-unicode-with-dots'] = {
    replacement: '-',                   // replace spaces with replacement
    symbols: false,                     // replace unicode symbols or not
    lower: true,                        // result in lower case
    charmap: slug.charmap,              // replace special characters
    multicharmap: slug.multicharmap,    // replace multi-characters
    trim: true,                         // remove leading and trailing replacement chars
};

slug.defaults.modes['rfc3986-non-unicode-with-dots-no-lower'] = {
    replacement: '-',                   // replace spaces with replacement
    symbols: false,                     // replace unicode symbols or not
    lower: false,                       // result in lower case
    charmap: slug.charmap,              // replace special characters
    multicharmap: slug.multicharmap,    // replace multi-characters
    trim: true,                         // remove leading and trailing replacement chars
};

slug.defaults.mode = 'rfc3986-non-unicode';

/**
 * Define custom slug charmap
 */
slug.defaults.charmap['ä'] = 'ae';
slug.defaults.charmap['Ä'] = 'AE';
slug.defaults.charmap['ö'] = 'oe';
slug.defaults.charmap['Ö'] = 'OE';
slug.defaults.charmap['ü'] = 'ue';
slug.defaults.charmap['Ü'] = 'UE';
slug.defaults.charmap['ß'] = 'ss';
slug.defaults.charmap['ẞ'] = 'SS';

function decodeHtmlEntities(text) {
    if (text === null || typeof text === 'undefined') {
        return '';
    }

    return String(text)
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'");
}

function stripHtml(text) {
    return decodeHtmlEntities(text).replace(/<[^>]*>/gmi, ' ');
}

function truncateByBytes(text, maxLength) {
    let output = '';

    for (let char of String(text)) {
        if (Buffer.byteLength(output + char, 'utf8') > maxLength) {
            break;
        }

        output += char;
    }

    return output;
}

function truncateSlug(slugText, maxLength = MAX_SLUG_LENGTH) {
    slugText = String(slugText || '');

    if (Buffer.byteLength(slugText, 'utf8') <= maxLength) {
        return slugText;
    }

    let truncated = truncateByBytes(slugText, maxLength).replace(/[-.]+$/g, '');
    let withoutPartialWord = truncated.replace(/-[^-]*$/g, '');

    if (withoutPartialWord.length >= Math.floor(maxLength / 2)) {
        truncated = withoutPartialWord;
    }

    return truncated || truncateByBytes(slugText, maxLength).replace(/[-.]+$/g, '');
}

function withSuffix(slugText, suffix, maxLength = MAX_SLUG_LENGTH) {
    suffix = String(suffix || '');

    if (suffix === '') {
        return truncateSlug(slugText, maxLength);
    }

    let suffixPart = suffix.charAt(0) === '-' ? suffix : '-' + suffix;
    let maxBaseLength = Math.max(1, maxLength - Buffer.byteLength(suffixPart, 'utf8'));
    let baseSlug = truncateSlug(slugText, maxBaseLength).replace(/[-.]+$/g, '');

    return baseSlug + suffixPart;
}

function createSlug(textToSlugify, filenameMode = false, saveLowerChars = false) {
    textToSlugify = stripHtml(textToSlugify);
    textToSlugify = transliterate(textToSlugify, { replace: [
        ['ä', 'ae'], 
        ['Ä', 'AE'], 
        ['ö', 'oe'], 
        ['Ö', 'OE'], 
        ['ü', 'ue'], 
        ['Ü', 'UE'], 
        ['ß', 'ss'], 
        ['ẞ', 'SS'],
        ['«', ''],
        ['»', ''],
        ['$', '']
    ] });

    if(!filenameMode) {
        if(saveLowerChars) {
            slug.defaults.mode = 'rfc3986-non-unicode-with-dots-no-lower';
        }

        textToSlugify = slug(textToSlugify);
        slug.defaults.mode = 'rfc3986-non-unicode';
    } else {
        slug.defaults.mode = 'rfc3986-non-unicode-with-dots';
        textToSlugify = slug(textToSlugify);
        slug.defaults.mode = 'rfc3986-non-unicode';
    }

    if (textToSlugify === '.' || textToSlugify === '..') {
        return '';
    }

    return truncateSlug(textToSlugify);
}

createSlug.MAX_LENGTH = MAX_SLUG_LENGTH;
createSlug.truncate = truncateSlug;
createSlug.withSuffix = withSuffix;

module.exports = createSlug;
