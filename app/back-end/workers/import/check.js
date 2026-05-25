const Import = require('./../../modules/import/import.js');

function sendCheckError(err) {
    let message = err && err.message ? err.message : 'An unknown import check error occurred.';

    try {
        process.send({
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

process.on('uncaughtException', sendCheckError);
process.on('unhandledRejection', sendCheckError);

process.on('message', function(msg){
    if(msg.type === 'dependencies') {
        let results;

        try {
            let appInstance = null;
            let siteName = msg.siteName;
            let filePath = msg.filePath;
            let importer = new Import(appInstance, siteName, filePath);
            results = importer.checkFile();

            process.send(results);
        } catch (e) {
            sendCheckError(e);
            return;
        }

        setTimeout(function () {
            process.exit(results && results.status === 'error' ? 1 : 0);
        }, 1000);
    }
});
