const Import = require('./../../modules/import/import.js');

function sendImportError(err) {
    let message = err && err.message ? err.message : 'An unknown import error occurred.';

    try {
        process.send({
            type: 'result',
            status: 'error',
            message: message
        });
    } catch (e) {
        console.log(e);
    }

    console.log(err);

    setTimeout(function () {
        process.exit(1);
    }, 100);
}

process.on('uncaughtException', sendImportError);
process.on('unhandledRejection', sendImportError);

process.on('message', function(msg){
    if(msg.type === 'dependencies') {
        try {
            let appInstance = msg.appInstance;
            let siteName = msg.siteName;
            let filePath = msg.filePath;
            let importAuthors = msg.importAuthors;
            let usedTaxonomy = msg.usedTaxonomy;
            let autop = msg.autop;
            let postTypes = msg.postTypes;

            let importer = new Import(appInstance, siteName, filePath);
            importer.importFile(importAuthors, usedTaxonomy, autop, postTypes);
        } catch (e) {
            sendImportError(e);
        }
    }
});
