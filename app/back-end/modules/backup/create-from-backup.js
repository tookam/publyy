const fs = require('fs-extra');
const path = require('path');
const FileHelper = require('./../../helpers/file.js');
const tar = require('tar-fs');
const Utils = require('./../../helpers/utils.js');

class CreateFromBackup {
    constructor (appInstance, backupPath) {
        this.backupPath = backupPath;
        this.appInstance = appInstance;
        this.baseDir = path.join(this.appInstance.appDir, 'temp');
        this.tempDir = path.join(this.baseDir, 'backup-to-restore');
    }

    async prepareBackupToRestore () {
        if (!this.checkExtension()) {
            return {
                status: 'error',
                type: 'unsupported-format'
            };
        }

        return await this.unpackBackup();
    }

    checkExtension () {
        if (this.backupPath.substr(-4) === '.tar') {
            return true;
        }

        return false;
    }

    static isUnsafeTarEntry(resolvedEntryPath, header, extractBasePath) {
        let entryName = header && typeof header.name === 'string' ? header.name : '';

        if (!entryName) {
            return true;
        }

        if (path.isAbsolute(entryName) || path.win32.isAbsolute(entryName)) {
            return true;
        }

        if (header && (header.type === 'symlink' || header.type === 'link')) {
            return true;
        }

        if (entryName.replace(/\\/g, '/').split('/').some(s => s === '..')) {
            return true;
        }

        let resolvedBase = path.resolve(extractBasePath);
        let resolvedTarget = path.resolve(resolvedEntryPath);

        if (resolvedTarget !== resolvedBase &&
            !resolvedTarget.startsWith(resolvedBase + path.sep)) {
            return true;
        }

        return false;
    }

    async unpackBackup () {
        this.removeBackupFilesIfNecessary();
        let safeTempBase = path.resolve(this.tempDir);

        let extractOperation = new Promise((resolve, reject) => {
            let settled = false;
            let resolveError = () => {
                if (settled) {
                    return;
                }

                settled = true;
                this.removeBackupFilesIfNecessary();
                resolve({
                    status: 'error',
                    type: 'unpack-error'
                });
            };
            let extractor = tar.extract(this.tempDir, {
                ignore: (resolvedEntryPath, header) => {
                    return CreateFromBackup.isUnsafeTarEntry(resolvedEntryPath, header, safeTempBase);
                },
                finish: () => {
                    if (settled) {
                        return;
                    }

                    settled = true;
                    let backupTestResult = this.verifyBackup(this.tempDir);

                    if (!backupTestResult) {
                        this.removeBackupFilesIfNecessary();

                        resolve({
                            status: 'error',
                            type: 'invalid-backup-content'
                        });

                        return;
                    }

                    let siteNameData = this.getSiteName();

                    if (!siteNameData) {
                        this.removeBackupFilesIfNecessary();

                        resolve({
                            status: 'error',
                            type: 'invalid-site-data'
                        });

                        return;
                    }

                    resolve({
                        status: 'success',
                        type: 'unpack-success',
                        data: {
                            displayName: siteNameData.displayName,
                            catalogName: siteNameData.catalogName
                        }
                    });
                }
            });

            extractor.on('error', resolveError);
            fs.createReadStream(this.backupPath).on('error', resolveError).pipe(extractor);
        });

        let results = await extractOperation;
        return results;
    }

    verifyBackup(backupDir) {
        let foundedErrors = false;
        let configFilePath = path.join(backupDir, 'input', 'config', 'site.config.json');
        let dirsToCheck = [
            path.join(backupDir, 'input'),
            path.join(backupDir, 'input', 'config'),
            path.join(backupDir, 'input', 'media'),
            path.join(backupDir, 'input', 'themes'),
        ];
        let filesToCheck = [
            path.join(backupDir, 'input', 'db.sqlite'),
            configFilePath
        ];

        for(let i = 0; i < dirsToCheck.length; i++) {
            if (!Utils.dirExists(dirsToCheck[i])) {
                foundedErrors = true;
            }
        }

        for(let i = 0; i < filesToCheck.length; i++) {
            if (!Utils.fileExists(filesToCheck[i])) {
                foundedErrors = true;
            }
        }

        // If errors were founded
        if(foundedErrors) {
            return false;
        }

        return true;
    }

    getSiteName () {
        let configFilePath = path.join(this.tempDir, 'input', 'config', 'site.config.json');
        let configContent = FileHelper.readFileSync(configFilePath, 'utf8');
        let siteNameData = false;

        try {
            let parsedConfig = JSON.parse(configContent);
            siteNameData = {
                displayName: parsedConfig.displayName,
                catalogName: parsedConfig.name
            };
        } catch (e) {
            siteNameData = false;
        }

        return siteNameData;
    }

    removeBackupFilesIfNecessary () {
        if (fs.existsSync(this.tempDir)) {
            fs.emptyDirSync(this.tempDir);
        }
    }
}

module.exports = CreateFromBackup;
