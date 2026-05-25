const fs = require('fs-extra');
const ipcMain = require('electron').ipcMain;
const Deployment = require('../modules/deploy/deployment.js');
const childProcess = require('child_process');
const stripTags = require('striptags');

class DeployEvents {
    static sendToWebContents(sender, channel, message) {
        if (!sender || (typeof sender.isDestroyed === 'function' && sender.isDestroyed())) {
            return false;
        }

        try {
            sender.send(channel, message);
            return true;
        } catch (e) {
            console.log(e);
            return false;
        }
    }

    static sendToChildProcess(processToSend, message) {
        if (!processToSend || processToSend.killed || !processToSend.connected) {
            return false;
        }

        try {
            processToSend.send(message);
            return true;
        } catch (e) {
            if (e.code !== 'ERR_IPC_CHANNEL_CLOSED') {
                console.log(e);
            }

            return false;
        }
    }

    constructor(appInstance) {
        let self = this;
        this.app = appInstance;
        this.deploymentProcess = false;
        this.rendererProcess = false;

        ipcMain.on('app-deploy-render', function (event, siteData) {
            if(siteData.site && siteData.theme) {
                self.renderSite(siteData.site, event);
            } else {
                DeployEvents.sendToWebContents(event.sender, 'app-deploy-rendered', {
                    status: false
                });
            }
        });

        ipcMain.on('app-deploy-render-abort', function(event, siteData) {
            if(self.rendererProcess) {
                self.rendererProcess.publiiAbortRequested = true;
                DeployEvents.sendToChildProcess(self.rendererProcess, {
                    type: 'abort'
                });
                self.rendererProcess = false;
            }

            DeployEvents.sendToWebContents(event.sender, 'app-deploy-aborted', true);
        });

        ipcMain.on('app-deploy-upload', function(event, siteData) {
            if(siteData.site) {
                self.deploySite(siteData.site, siteData.password, event.sender);
            } else {
                DeployEvents.sendToWebContents(event.sender, 'app-deploy-uploaded', {
                    status: false
                });
            }
        });

        ipcMain.on('app-deploy-abort', function(event, siteData) {
            if(self.deploymentProcess) {
                self.deploymentProcess.publiiAbortRequested = true;
                DeployEvents.sendToChildProcess(self.deploymentProcess, {
                    type: 'abort'
                });
                self.deploymentProcess = false;
            }

            DeployEvents.sendToWebContents(event.sender, 'app-deploy-aborted', true);
        });

        ipcMain.on('app-deploy-continue', function(event) {
            if (self.deploymentProcess) {
                if (!DeployEvents.sendToChildProcess(self.deploymentProcess, {
                    type: 'continue-sync'
                })) {
                    self.deploymentProcess = false;
                    DeployEvents.sendToWebContents(event.sender, 'app-deploy-uploaded', {
                        status: false,
                        message: 'The deployment process is no longer running.'
                    });
                }
            }
        });

        ipcMain.on('app-deploy-test', async (event, data) => {
            try {
                await this.testConnection(data.deploymentConfig, data.siteName, data.uuid);
            } catch (err) {
                console.log('Test connection error:', err);
            }
        });
    }

    renderSite(site, event) {
        let self = this;
        let sender = event.sender;
        let renderFinished = false;
        this.rendererProcess = childProcess.fork(__dirname + '/../workers/renderer/preview', {
            stdio: [
                null,
                fs.openSync(this.app.app.getPath('logs') + "/rendering-deployment-process.log", "w"),
                fs.openSync(this.app.app.getPath('logs') + "/rendering-deployment-errors.log", "w"),
                'ipc'
            ]
        });

        let rendererProcess = this.rendererProcess;
        this.trackChildProcess(rendererProcess, 'rendererProcess');

        let sendRenderError = (desc) => {
            if (renderFinished) {
                return;
            }

            renderFinished = true;

            if (self.rendererProcess === rendererProcess) {
                self.rendererProcess = false;
            }

            let errorDesc = desc || {
                translation: 'core.rendering.renderingProcessCrashedMsg'
            };

            if (typeof errorDesc === 'string') {
                errorDesc = stripTags(errorDesc);
            }

            DeployEvents.sendToWebContents(sender, 'app-deploy-render-error', {
                message: [{
                    message: {
                        translation: 'core.rendering.renderingProcessCrashed'
                    },
                    desc: errorDesc
                }]
            });
        };

        rendererProcess.once('error', (err) => {
            sendRenderError(err && err.message ? err.message : false);
        });

        rendererProcess.once('exit', (code, signal) => {
            if (renderFinished || rendererProcess.publiiAbortRequested) {
                renderFinished = true;
                return;
            }

            let desc = {
                translation: 'core.rendering.renderingProcessCrashedMsg'
            };

            if (typeof code === 'number' && code !== 0) {
                desc = 'The rendering process exited with code ' + code + '.';
            } else if (signal) {
                desc = 'The rendering process stopped after receiving signal ' + signal + '.';
            }

            sendRenderError(desc);
        });

        rendererProcess.once('disconnect', () => {
            if (rendererProcess.publiiAbortRequested) {
                renderFinished = true;
                return;
            }

            sendRenderError({
                translation: 'core.rendering.renderingProcessCrashedMsg'
            });
        });

        if (!DeployEvents.sendToChildProcess(rendererProcess, {
            type: 'dependencies',
            appDir: this.app.appDir,
            sitesDir: this.app.sitesDir,
            siteConfig: this.app.sites[site],
            itemID: false,
            postData: false,
            previewMode: false,
            singlePageMode: false,
            homepageOnlyMode: false,
            tagOnlyMode: false,
            authorOnlyMode: false,
            previewLocation: this.app.appConfig.previewLocation
        })) {
            sendRenderError({
                translation: 'core.rendering.renderingProcessCrashedMsg'
            });
            return;
        }

        rendererProcess.on('message', function(data) {
            if(data.type === 'app-rendering-results') {
                renderFinished = true;

                if (self.rendererProcess === rendererProcess) {
                    self.rendererProcess = false;
                }

                if(data.result === true) {
                    DeployEvents.sendToWebContents(sender, 'app-deploy-rendered', {
                        status: true
                    });
                } else {
                    let errorDesc = {
                        translation: 'core.rendering.renderingProcessCrashedMsg'
                    };

                    let errorTitle = {
                        translation: 'core.rendering.renderingProcessCrashed'
                    };

                    if (data.result && data.result[0] && data.result[0].message) {
                        errorTitle = {
                            translation: 'core.rendering.renderingProcessFailed'
                        };
                        errorDesc = data.result[0].message + "\n\n" + data.result[0].desc;
                    }

                    DeployEvents.sendToWebContents(sender, 'app-deploy-render-error', {
                        message: [{
                            message: errorTitle,
                            desc: stripTags((errorDesc).toString())
                        }]
                    });
                }
            } else {
                DeployEvents.sendToWebContents(sender, data.type, {
                    progress: data.progress,
                    message: stripTags((data.message).toString())
                });
            }
        });
    }

    deploySite(site, password, sender) {
        let self = this;
        let deploymentConfig = this.app.sites[site];
        let uploadFinished = false;
        this.deploymentProcess = childProcess.fork(__dirname + '/../workers/deploy/deployment', {
            stdio: [
                null,
                fs.openSync(this.app.app.getPath('logs') + "/deployment-process.log", "w"),
                fs.openSync(this.app.app.getPath('logs') + "/deployment-errors.log", "w"),
                'ipc'
            ]
        });

        let deploymentProcess = this.deploymentProcess;
        this.trackChildProcess(deploymentProcess, 'deploymentProcess');

        let sendUploadError = (message) => {
            if (uploadFinished) {
                return;
            }

            uploadFinished = true;

            if (self.deploymentProcess === deploymentProcess) {
                self.deploymentProcess = false;
            }

            message = message || 'The deployment process stopped unexpectedly.';

            DeployEvents.sendToWebContents(sender, 'app-deploy-uploaded', {
                status: false,
                message: stripTags(message.toString())
            });
        };

        deploymentProcess.once('error', (err) => {
            sendUploadError(err && err.message ? err.message : false);
        });

        deploymentProcess.once('exit', (code, signal) => {
            if (uploadFinished || deploymentProcess.publiiAbortRequested) {
                uploadFinished = true;
                return;
            }

            let message = 'The deployment process stopped unexpectedly.';

            if (typeof code === 'number' && code !== 0) {
                message = 'The deployment process exited with code ' + code + '.';
            } else if (signal) {
                message = 'The deployment process stopped after receiving signal ' + signal + '.';
            }

            sendUploadError(message);
        });

        deploymentProcess.once('disconnect', () => {
            if (deploymentProcess.publiiAbortRequested) {
                uploadFinished = true;
                return;
            }

            sendUploadError('The deployment process disconnected unexpectedly.');
        });

        if(password !== false) {
            deploymentConfig.deployment.password = password;
        }

        if (!DeployEvents.sendToChildProcess(deploymentProcess, {
            type: 'dependencies',
            appDir: this.app.appDir,
            sitesDir: this.app.sitesDir,
            siteConfig: deploymentConfig,
            useFtpAlt: this.app.appConfig.experimentalFeatureAppFtpAlt
        })) {
            this.deploymentProcess = false;
            sendUploadError('The deployment process could not be started.');
            return;
        }

        deploymentProcess.on('message', function(data) {
            if (data.type === 'web-contents') {
                if(data.value) {
                    DeployEvents.sendToWebContents(self.app.mainWindow.webContents, data.message, data.value);
                } else {
                    DeployEvents.sendToWebContents(self.app.mainWindow.webContents, data.message);
                }
            }

            if(data.type === 'sender') {
                if (data.message === 'app-deploy-uploaded' && self.deploymentProcess === deploymentProcess) {
                    uploadFinished = true;
                    self.deploymentProcess = false;
                }

                DeployEvents.sendToWebContents(sender, data.message, data.value);
            }
        });
    }

    trackChildProcess(processToTrack, propertyName) {
        let clearProcess = () => {
            if (this[propertyName] === processToTrack) {
                this[propertyName] = false;
            }
        };

        processToTrack.once('error', (err) => {
            if (err && err.code !== 'ERR_IPC_CHANNEL_CLOSED') {
                console.log(err);
            }

            clearProcess();
        });

        processToTrack.once('exit', clearProcess);
        processToTrack.once('close', clearProcess);
        processToTrack.once('disconnect', clearProcess);
    }

    async testConnection(deploymentConfig, siteName, uuid) {
        let deployment = new Deployment(
            this.app.app.getPath('logs'), 
            this.app.sitesDir, 
            deploymentConfig, 
            this.app.appConfig.experimentalFeatureAppFtpAlt
        );
        await deployment.testConnection(this.app, deploymentConfig, siteName, uuid);
    }
}

module.exports = DeployEvents;
