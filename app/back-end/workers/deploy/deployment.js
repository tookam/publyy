const Deployment = require('./../../modules/deploy/deployment.js');
let deploymentInstance = false;
let deploymentFinished = false;

function sendToParent(message) {
    if (typeof process.send !== 'function' || process.connected === false) {
        return false;
    }

    try {
        process.send(message);
        return true;
    } catch (err) {
        if (err && err.code !== 'ERR_IPC_CHANNEL_CLOSED') {
            console.log(err);
        }

        return false;
    }
}

function sendDeployError(err) {
    if (deploymentFinished) {
        return;
    }

    deploymentFinished = true;

    let message = err && err.message ? err.message : err;
    message = (message || 'Deployment process failed').toString();

    sendToParent({
        type: 'sender',
        message: 'app-deploy-uploaded',
        value: {
            status: false,
            message
        }
    });

    setTimeout(function() {
        process.kill(process.pid, 'SIGTERM');
    }, 1000);
}

function closeActiveConnection() {
    if (!deploymentInstance || !deploymentInstance.client || !deploymentInstance.client.connection) {
        return;
    }

    let connection = deploymentInstance.client.connection;

    try {
        if (typeof connection.end === 'function') {
            connection.end();
            return;
        }

        if (typeof connection.close === 'function') {
            connection.close();
            return;
        }

        if (typeof connection.destroy === 'function') {
            connection.destroy();
        }
    } catch (err) {
        if (err && err.code !== 'ERR_IPC_CHANNEL_CLOSED') {
            console.log(err);
        }
    }
}

process.on('uncaughtException', sendDeployError);
process.on('unhandledRejection', sendDeployError);

process.on('message', function(msg){
    if(msg.type === 'dependencies') {
        let appDir = msg.appDir;
        let sitesDir = msg.sitesDir;
        let siteConfig = msg.siteConfig;
        let useFtpAlt = msg.useFtpAlt;
        deploymentInstance = new Deployment(appDir, sitesDir, siteConfig, useFtpAlt);
        deploymentInstance.initSession().catch(sendDeployError);
    }

    if (msg.type === 'continue-sync' && deploymentInstance) {
        try {
            deploymentInstance.continueSync([]);
        } catch (err) {
            sendDeployError(err);
        }
    }

    if ((msg.type === 'abort' || msg.type === 'cancel-sync') && deploymentInstance) {
        deploymentFinished = true;
        closeActiveConnection();

        setTimeout(function() {
            process.kill(process.pid, 'SIGTERM');
        }, 1000);
    }
});
