/*
 * Class used to upload files to the S3 bucket
 */

const fs = require('fs-extra');
const path = require('path');
const { 
    S3Client, 
    ListObjectsCommand, 
    GetObjectCommand, 
    PutObjectCommand, 
    DeleteObjectCommand 
} = require("@aws-sdk/client-s3");
const passwordSafeStorage = require('keytar');
const slug = require('./../../helpers/slug');
const mime = require('mime');
const stripTags = require('striptags');

const S3_OPERATION_TIMEOUT = 120000;

class S3 {
    constructor(deploymentInstance = false) {
        this.deployment = deploymentInstance;
        this.connection = false;
        this.econnresetCounter = 0;
        this.waitForTimeout = false;
        this.softUploadErrors = {};
        this.hardUploadErrors = [];
        this.uploadFinished = false;
    }

    async initConnection() {
        let s3Provider = this.deployment.siteConfig.deployment.s3.provider;
        let s3Endpoint = this.deployment.siteConfig.deployment.s3.endpoint;
        let s3Id = this.deployment.siteConfig.deployment.s3.id;
        let s3Key = this.deployment.siteConfig.deployment.s3.key;
        let region = this.deployment.siteConfig.deployment.s3.region;
        let customRegion = this.deployment.siteConfig.deployment.s3.customRegion;
        let account = slug(this.deployment.siteConfig.name);
        this.bucket = this.deployment.siteConfig.deployment.s3.bucket;
        this.prefix = this.deployment.siteConfig.deployment.s3.prefix;
        this.waitForTimeout = true;

        if (this.deployment.siteConfig.uuid) {
            account = this.deployment.siteConfig.uuid;
        }

        if (s3Id === 'publii-s3-id ' + account) {
            s3Id = await passwordSafeStorage.getPassword('publii-s3-id', account);
        }

        if (s3Key === 'publii-s3-key ' + account) {
            s3Key = await passwordSafeStorage.getPassword('publii-s3-key', account);
        }

        if (s3Provider !== 'aws' && typeof s3Endpoint === 'string' && s3Endpoint.indexOf('://') === -1) {
            s3Endpoint = 'https://' + s3Endpoint;
        }

        let connectionParams;

        if (s3Provider === 'aws') {
            connectionParams = {
                credentials: {
                    accessKeyId: s3Id,
                    secretAccessKey: s3Key,
                },
                region: region
            }
        } else {
            connectionParams = {
                credentials: {
                    accessKeyId: s3Id,
                    secretAccessKey: s3Key,
                },
                endpoint: s3Endpoint,
                region: customRegion
            }
        }

        this.connection = new S3Client(connectionParams);
        this.sendProgress(6, false);

        this.sendToParent({
            type: 'web-contents',
            message: 'app-connection-in-progress'
        });

        let params = {
            Bucket: this.bucket,
            Prefix: this.prefix,
            MaxKeys: 1
        };

        try {
            await this.sendCommand(new ListObjectsCommand(params), 'S3 bucket listing', 20000);
            this.waitForTimeout = false;
          
            this.sendToParent({
                type: 'web-contents',
                message: 'app-connection-success'
            });
          
            this.deployment.setInput();
            this.deployment.setOutput(true);
            this.deployment.prepareLocalFilesList();
            this.sendProgress(7, false);
          
            await this.downloadFilesList();
        } catch (err) {
            this.onError(err);
        }

        setTimeout(() => {
            if(this.waitForTimeout === true) {
                this.sendToParent({
                    type: 'web-contents',
                    message: 'app-connection-error'
                });

                setTimeout(() => {
                    process.kill(process.pid, 'SIGTERM');
                }, 1000);
            }
        }, 20000);
    }

    async downloadFilesList() {
        let fileName = 'files.publii.json';

        if (typeof this.prefix === 'string' && this.prefix !== '') {
            fileName = this.prefix + fileName;
        }

        let params = {
            Bucket: this.bucket,
            Key: fileName,
        };

        try {
            let data = await this.sendCommand(new GetObjectCommand(params), 'S3 remote file list download');
            console.log(`[${new Date().toUTCString()}] <- files.publii.json`);
            this.sendProgress(8, false);
            let remoteFile = await this.withTimeout(
                this.s3streamToString(data.Body),
                'S3 remote file list stream'
            );
            this.deployment.checkLocalListWithRemoteList(remoteFile);
          } catch (err) {
            console.log(`[${new Date().toUTCString()}] <- files.publii.json`);
        
            if (err.name !== 'NoSuchKey') {
                this.finishWithError(err);
                return;
            }
        
            this.sendProgress(8, false);
            this.deployment.compareFilesList(false);
        }
    }

    async uploadNewFileList() {    
        this.sendProgress(99);
        let fileName = 'files.publii.json';
        
        if (typeof this.prefix === 'string' && this.prefix !== '') {
            fileName = this.prefix + fileName;
        }
        
        let filePath = path.join(this.deployment.inputDir, 'files.publii.json');
    
        try {
            let fileContent = await fs.readFile(filePath);
            let fileACL = this.deployment.siteConfig.deployment.s3.acl || 'public-read';
            let params = {
                ACL: fileACL,
                Body: fileContent,
                Bucket: this.bucket,
                Key: fileName,
                ContentType: mime.getType(fileName) || 'application/json'
            };

            await this.sendCommand(new PutObjectCommand(params), 'S3 final file list upload');
            console.log(`[${new Date().toUTCString()}] -> ${fileName}`);
            this.sendProgress(100, false);
            this.uploadFinished = true;
    
            this.sendToParent({
                type: 'sender',
                message: 'app-deploy-uploaded',
                value: {
                    status: true,
                    issues: this.hardUploadErrors.length > 0
                }
            });

            setTimeout(() => {
                process.kill(process.pid, 'SIGTERM');
            }, 1000);
        } catch (uploadErr) {
            console.log(`[${new Date().toUTCString()}] -> ${fileName}`);
            this.finishWithError(uploadErr);
        }
    }

    /**
     * Uploads file
     */
    async uploadFile() {
        if (this.deployment.filesToUpload.length > 0) {
            let fileToUpload = this.deployment.filesToUpload.pop();
            fileToUpload.path = this.prepareFilePath(fileToUpload.path);

            if (fileToUpload.type === 'file') {
                await this.uploadFileObject(fileToUpload.path);
            } else {
                await this.uploadFile();
            }
        } else {
            this.sendProgress(98);
            await this.uploadNewFileList();
        }
    }

    async uploadFileObject(input) {
        let filePath = path.join(this.deployment.inputDir, input);

        let fileName = input;

        if (typeof this.prefix === 'string' && this.prefix !== '') {
            fileName = this.prefix + fileName;
        }

        let fileContent;

        try {
            fileContent = await fs.readFile(filePath);
        } catch (err) {
            await this.markUploadFailure(input, fileName, err);
            return;
        }

        let fileACL = this.deployment.siteConfig.deployment.s3.acl || 'public-read';
        let htmlCacheControl = this.deployment.siteConfig.deployment.s3.htmlCacheControl || 'no-cache, no-store';
        let otherCacheControl = this.deployment.siteConfig.deployment.s3.otherCacheControl || 'public, max-age=2592000';
        let fileExtension = path.extname(fileName).substring(1);
        let cacheControl = fileExtension === 'html' ? htmlCacheControl : otherCacheControl;
        let params = {
            ACL: fileACL,
            Body: fileContent,
            Bucket: this.bucket,
            Key: fileName,
            CacheControl: cacheControl,
            ContentType: mime.getType(fileExtension) || 'application/octet-stream'
        };

        try {
            await this.sendCommand(new PutObjectCommand(params), 'S3 file upload: ' + input);
            this.deployment.currentOperationNumber++;
            console.log(`[${ new Date().toUTCString() }] UPL ${input} -> ${fileName}`);
            this.deployment.progressOfUploading += this.deployment.progressPerFile;
            this.sendProgress(8 + Math.floor(this.deployment.progressOfUploading));
            await this.uploadFile();
        } catch (uploadErr) {
            this.onError(uploadErr, true);

            await this.delay(500);

            if (!this.softUploadErrors[input]) {
                this.softUploadErrors[input] = 1;
            } else {
                this.softUploadErrors[input]++;
            }

            if (this.softUploadErrors[input] <= 5) {
                await this.uploadFileObject(input);
            } else {
                await this.markUploadFailure(input, fileName, uploadErr);
            }
        }
    }

    async markUploadFailure(input, fileName, err) {
        this.hardUploadErrors.push(input);
        this.deployment.currentOperationNumber++;

        let errorMessage = err && err.message ? `: ${err.message}` : '';
        console.log(`[${ new Date().toUTCString() }] UPL HARD ERR ${input} -> ${fileName}${errorMessage}`);
        this.deployment.progressOfUploading += this.deployment.progressPerFile;
        this.sendProgress(8 + Math.floor(this.deployment.progressOfUploading));
        await this.uploadFile();
    }

    async markDeleteFailure(input, err) {
        this.hardUploadErrors.push(input);
        this.deployment.currentOperationNumber++;

        let errorMessage = err && err.message ? `: ${err.message}` : '';
        console.log(`[${ new Date().toUTCString() }] DEL HARD ERR ${input}${errorMessage}`);
        this.deployment.progressOfDeleting += this.deployment.progressPerFile;
        this.sendProgress(8 + Math.floor(this.deployment.progressOfDeleting));
        await this.removeFile();
    }

    async removeFile() {
        if (this.deployment.filesToRemove.length > 0) {
            let fileToRemove = this.deployment.filesToRemove.pop();
            fileToRemove.path = this.prepareFilePath(fileToRemove.path);

            if(fileToRemove.type === 'file') {
                await this.removeFileObject(fileToRemove.path);
            } else {
                await this.removeFile();
            }
        } else {
            this.sendProgress(8 + Math.floor(this.deployment.progressOfUploading));
            await this.uploadFile();
        }
    }

    async removeFileObject(input) {
        let params = {
            Bucket: this.bucket,
            Key: input
        };
    
        try {
            await this.sendCommand(new DeleteObjectCommand(params), 'S3 file delete: ' + input);
            this.deployment.currentOperationNumber++;
            console.log(`[${ new Date().toUTCString() }] DEL ${input}`);
            this.deployment.progressOfDeleting += this.deployment.progressPerFile;
            this.sendProgress(8 + Math.floor(this.deployment.progressOfDeleting));
            await this.removeFile();
        } catch (err) {
            // Handle case when specific file no longer exists in the bucket - don't block sync
            if (err.name === 'NoSuchKey') {
                this.deployment.currentOperationNumber++;
                console.log(`[${ new Date().toUTCString() }] DEL ${input} - NoSuchKey`);
                this.deployment.progressOfDeleting += this.deployment.progressPerFile;
                this.sendProgress(8 + Math.floor(this.deployment.progressOfDeleting));
                await this.removeFile();
                return;
            }

            console.error(`[${new Date().toUTCString()}] Error deleting ${input}`, err);
            this.onError(err, true);
            await this.markDeleteFailure(input, err);
        }
    }

    onError(err, silentMode = false) {
        let message = err && err.message ? err.message : err;
        console.log(`[${ new Date().toUTCString() }] S3 ERROR: ${message}`);

        if(this.waitForTimeout && !silentMode) {
            this.waitForTimeout = false;

            this.sendToParent({
                type: 'web-contents',
                message: 'app-connection-error'
            });

            setTimeout(function () {
                process.kill(process.pid, 'SIGTERM');
            }, 1000);
        }
    }

    finishWithError(err) {
        if (this.uploadFinished) {
            return;
        }

        this.uploadFinished = true;

        let message = err && err.message ? err.message : err;
        message = stripTags((message || 'S3 deployment failed').toString());
        console.log(`[${ new Date().toUTCString() }] S3 FATAL ERROR: ${message}`);

        this.sendToParent({
            type: 'sender',
            message: 'app-deploy-uploaded',
            value: {
                status: false,
                message
            }
        });

        setTimeout(() => {
            process.kill(process.pid, 'SIGTERM');
        }, 1000);
    }

    async sendCommand(command, operationName, timeoutMs = S3_OPERATION_TIMEOUT) {
        let abortController = typeof AbortController !== 'undefined' ? new AbortController() : false;
        let sendPromise = abortController ?
            this.connection.send(command, { abortSignal: abortController.signal }) :
            this.connection.send(command);

        return await this.withTimeout(sendPromise, operationName, timeoutMs, abortController);
    }

    async withTimeout(promise, operationName, timeoutMs = S3_OPERATION_TIMEOUT, abortController = false) {
        let timeout = false;
        let timeoutPromise = new Promise((resolve, reject) => {
            timeout = setTimeout(() => {
                if (abortController) {
                    abortController.abort();
                }

                reject(this.createTimeoutError(operationName, timeoutMs));
            }, timeoutMs);
        });

        try {
            return await Promise.race([promise, timeoutPromise]);
        } catch (err) {
            if (err && err.name === 'AbortError') {
                throw this.createTimeoutError(operationName, timeoutMs);
            }

            throw err;
        } finally {
            clearTimeout(timeout);
        }
    }

    createTimeoutError(operationName, timeoutMs) {
        let timeoutErr = new Error(operationName + ' timed out after ' + Math.round(timeoutMs / 1000) + ' seconds');
        timeoutErr.name = 'TimeoutError';
        return timeoutErr;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    sendToParent(message) {
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

    prepareFilePath(filePath) {
        if (filePath[0] && filePath[0] === '/') {
            filePath = filePath.substr(1);
        }

        return filePath;
    }

    async testConnection(app, deploymentConfig, siteName, uuid) {
        let s3Provider = deploymentConfig.s3.provider;
        let s3Endpoint = deploymentConfig.s3.endpoint;
        let s3Id = deploymentConfig.s3.id;
        let s3Key = deploymentConfig.s3.key;
        let bucket = deploymentConfig.s3.bucket;
        let prefix = deploymentConfig.s3.prefix;
        let region = deploymentConfig.s3.region;
        let customRegion = deploymentConfig.s3.customRegion;
        let account = slug(siteName);
        let waitForTimeout = true;

        if (uuid) {
            account = uuid;
        }

        if (s3Id === 'publii-s3-id ' + account) {
            s3Id = await passwordSafeStorage.getPassword('publii-s3-id', account);
        }

        if (s3Key === 'publii-s3-key ' + account) {
            s3Key = await passwordSafeStorage.getPassword('publii-s3-key', account);
        }

        let connectionParams;

        if (s3Provider === 'aws') {
            connectionParams = {
                credentials: {
                    accessKeyId: s3Id,
                    secretAccessKey: s3Key,
                },
                region: region
            }
        } else {
            connectionParams = {
                credentials: {
                    accessKeyId: s3Id,
                    secretAccessKey: s3Key,
                },
                endpoint: s3Endpoint,
                region: customRegion
            }
        }

        this.connection = new S3Client(connectionParams);

        let testParams = {
            Bucket: bucket,
            Prefix: prefix,
            MaxKeys: 1
        };

        try {
            await this.sendCommand(new ListObjectsCommand(testParams), 'S3 test connection', 10000);
        } catch (err) {
            waitForTimeout = false;
            app.mainWindow.webContents.send('app-deploy-test-error', {
                message: stripTags((err.message).toString())
            });

            return;
        }

        waitForTimeout = false;
        app.mainWindow.webContents.send('app-deploy-test-success');

        setTimeout(function() {
            if (waitForTimeout === true) {
                app.mainWindow.webContents.send('app-deploy-test-error', {
                    message: {
                        translation: 'core.server.requestTimeout'
                    }
                });
            }
        }, 10000);
    }

    sendProgress (progress, showOperations = true) {
        let operations = [this.deployment.currentOperationNumber, this.deployment.operationsCounter];

        if (!showOperations) {
            operations = false;
        }

        this.sendToParent({
            type: 'web-contents',
            message: 'app-uploading-progress',
            value: {
                progress,
                operations
            }
        });
    }

    async s3streamToString (stream) {
        let chunks = [];
        
        for await (let chunk of stream) {
            chunks.push(chunk);
        }

        return Buffer.concat(chunks).toString('utf-8');
    }
}

module.exports = S3;
