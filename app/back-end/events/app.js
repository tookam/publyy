const fs = require('fs-extra');
const path = require('path');
const FileHelper = require('../helpers/file.js');
const ipcMain = require('electron').ipcMain;
const Themes = require('../themes.js');
const Languages = require('../languages.js');
const Plugins = require('../plugins.js');
const AppFiles = require('../helpers/app-files.js');
const PathValidator = require('../helpers/path-validator.js');
const AdmZip = require("adm-zip");

const { isValidDirSegment, resolveValidPath } = PathValidator;
const MAX_ZIP_ENTRIES = 10000;
const MAX_ZIP_UNCOMPRESSED_SIZE = 250 * 1024 * 1024;

function isValidPackageDirName(name) {
    return isValidDirSegment(name) && name[0] !== '.' && name[0] !== '_';
}

function isSafeZipEntryName(entryName) {
    if (typeof entryName !== 'string' || entryName.length === 0) {
        return false;
    }

    if (path.isAbsolute(entryName) || path.win32.isAbsolute(entryName)) {
        return false;
    }

    let segments = entryName.replace(/\\/g, '/').split('/').filter(Boolean);

    if (segments.length === 0) {
        return false;
    }

    return !segments.some(segment => segment === '..');
}

function safeExtractZip(sourcePath, destinationPath) {
    let zip = new AdmZip(sourcePath);
    let entries = zip.getEntries();
    let totalUncompressedSize = 0;

    if (entries.length > MAX_ZIP_ENTRIES) {
        return false;
    }

    for (let entry of entries) {
        if (!isSafeZipEntryName(entry.entryName)) {
            return false;
        }

        totalUncompressedSize += entry.header && entry.header.size ? entry.header.size : 0;

        if (totalUncompressedSize > MAX_ZIP_UNCOMPRESSED_SIZE) {
            return false;
        }
    }

    fs.mkdirSync(destinationPath, { recursive: true });

    let extractedSize = 0;

    for (let entry of entries) {
        let entryName = entry.entryName.replace(/\\/g, '/');
        let entryPath = resolveValidPath(destinationPath, entryName);

        if (!entryPath) {
            return false;
        }

        if (entry.isDirectory) {
            fs.mkdirSync(entryPath, { recursive: true });
            continue;
        }

        let data = entry.getData();
        extractedSize += data.length;

        if (extractedSize > MAX_ZIP_UNCOMPRESSED_SIZE) {
            return false;
        }

        fs.mkdirSync(path.dirname(entryPath), { recursive: true });
        fs.writeFileSync(entryPath, data);
    }

    return true;
}

function listInstallableDirs(tempPath) {
    return fs.readdirSync(tempPath).filter(function(file) {
        if (!isValidPackageDirName(file)) {
            return false;
        }

        return fs.statSync(path.join(tempPath, file)).isDirectory();
    });
}

function copyDirectoryWithoutSymlinks(sourcePath, destinationPath) {
    fs.copySync(sourcePath, destinationPath, {
        filter: (src) => {
            try {
                return !fs.lstatSync(src).isSymbolicLink();
            } catch (e) {
                return false;
            }
        }
    });
}

function installPackageFromConfig(config, destinationRoot) {
    if (!config || typeof config.sourcePath !== 'string') {
        return 'wrong-format';
    }

    let sourcePath = config.sourcePath;
    let extension = path.parse(sourcePath).ext.toLowerCase();
    let newPackageDir = path.parse(sourcePath).name;
    let status = '';
    let sourceStats;

    try {
        sourceStats = fs.statSync(sourcePath);
    } catch (e) {
        return 'wrong-format';
    }

    if (extension !== '.zip' && extension !== '') {
        return 'wrong-format';
    }

    let sourceDir = sourcePath;
    let tempPath = false;
    let installTempPath = false;

    try {
        if (extension === '.zip') {
            tempPath = resolveValidPath(destinationRoot, '__TEMP__-' + process.pid + '-' + Date.now());

            if (!tempPath || !safeExtractZip(sourcePath, tempPath)) {
                return 'wrong-format';
            }

            let dirs = listInstallableDirs(tempPath);

            if (dirs.length !== 1) {
                return 'wrong-format';
            }

            newPackageDir = dirs[0];
            sourceDir = path.join(tempPath, newPackageDir);
        } else if (!sourceStats.isDirectory()) {
            return 'wrong-format';
        }

        if (!isValidPackageDirName(newPackageDir)) {
            return 'wrong-format';
        }

        let directoryPath = resolveValidPath(destinationRoot, newPackageDir);

        if (!directoryPath) {
            return 'wrong-format';
        }

        installTempPath = resolveValidPath(destinationRoot, '__INSTALL__-' + process.pid + '-' + Date.now());

        if (!installTempPath) {
            return 'wrong-format';
        }

        try {
            fs.statSync(directoryPath);
            status = 'updated';
        } catch (e) {
            status = 'added';
        }

        copyDirectoryWithoutSymlinks(sourceDir, installTempPath);

        if (status === 'updated') {
            fs.removeSync(directoryPath);
        }

        fs.moveSync(installTempPath, directoryPath);
    } catch (e) {
        return 'wrong-format';
    } finally {
        if (tempPath) {
            try {
                fs.removeSync(tempPath);
            } catch (e) {}
        }

        if (installTempPath) {
            try {
                fs.removeSync(installTempPath);
            } catch (e) {}
        }
    }

    return status;
}

/*
 * Events for the IPC communication regarding app
 */

class AppEvents {
    constructor(appInstance) {
        /*
         * Close app
         */
        ipcMain.on('app-close', function(event, config) {
            appInstance.app.quit();
        });
        
        /*
         * Save licence acceptance
         */
        ipcMain.on('app-license-accept', function(event, config) {
            fs.writeFileSync(appInstance.appConfigPath, JSON.stringify({licenseAccepted: true}, null, 4));
            appInstance.appConfig = config;

            event.sender.send('app-license-accepted', true);
        });

        /*
         * Save app config
         */
        ipcMain.on('app-config-save', function (event, config) {
            if (config.sitesLocation === '') {
                config.sitesLocation = appInstance.dirPaths.sites;
            }

            if (config.sitesLocation !== appInstance.appConfig.sitesLocation) {
                let result = true;

                if (appInstance.appConfig.sitesLocation) {
                    let appFilesHelper = new AppFiles(appInstance);
                    
                    if (appInstance.db) {
                        try {
                            appInstance.db.close();
                        } catch (e) {
                            console.log('[SITE LOCATION CHANGE] DB already closed');
                        }
                    }

                    setTimeout(() => {
                        if (config.changeSitesLocationWithoutCopying) {
                            fs.writeFileSync(appInstance.appConfigPath, JSON.stringify(config, null, 4));
                            appInstance.appConfig = config;
                            appInstance.sitesDir = config.sitesLocation;
                        } else {
                            result = appFilesHelper.relocateSites(
                                appInstance.appConfig.sitesLocation,
                                config.sitesLocation,
                                event
                            );

                            if (result) {
                                fs.writeFileSync(appInstance.appConfigPath, JSON.stringify(config, null, 4));
                                appInstance.appConfig = config;
                                appInstance.sitesDir = config.sitesLocation;
                            }
                        }
        
                        appInstance.loadSites();
                        
                        event.sender.send('app-config-saved', {
                            status: true,
                            message: 'success-save',
                            sites: appInstance.sites
                        });
                    }, 500);

                    return;
                }
            }

            event.sender.send('app-config-saved', {
                status: true,
                message: 'success-save'
            });

            fs.writeFileSync(appInstance.appConfigPath, JSON.stringify(config, null, 4));
            appInstance.appConfig = config;
        });

        /*
         * Save app color theme config
         */
        ipcMain.on('app-save-color-theme', function (event, theme) {
            let appConfig = FileHelper.readFileSync(appInstance.appConfigPath, 'utf8');

            try {
                appConfig = JSON.parse(appConfig);
                appConfig.appTheme = theme;
                fs.writeFileSync(appInstance.appConfigPath, JSON.stringify(appConfig, null, 4));
            } catch (e) {
                console.log('(!) App was unable to save the color theme');
            }
        });

        /*
         * Delete theme
         */
        ipcMain.on('app-theme-delete', function(event, config) {
            if (!config || !isValidDirSegment(config.directory)) {
                event.sender.send('app-theme-deleted', {
                    status: false,
                    themes: appInstance.themes
                });
                return;
            }

            let themesLoader = new Themes(appInstance);
            themesLoader.removeTheme(config.directory);

            appInstance.themes = appInstance.themes.filter(function (theme) {
                return theme.name !== config.name;
            });

            event.sender.send('app-theme-deleted', {
                status: true,
                themes: appInstance.themes
            });
        });

        /*
         * Delete language
         */
        ipcMain.on('app-language-delete', function(event, config) {
            if (!config || !isValidDirSegment(config.directory)) {
                event.sender.send('app-language-deleted', {
                    status: false,
                    languages: appInstance.languages
                });
                return;
            }

            let languagesLoader = new Languages(appInstance);
            languagesLoader.removeLanguage(config.directory);

            appInstance.languages = appInstance.languages.filter(function (language) {
                return language.name !== config.name;
            });

            event.sender.send('app-language-deleted', {
                status: true,
                languages: appInstance.languages
            });
        });

        /*
         * Delete plugin
         */
        ipcMain.on('app-plugin-delete', function(event, config) {
            if (!config || !isValidDirSegment(config.directory)) {
                event.sender.send('app-plugin-deleted', {
                    status: false,
                    plugins: appInstance.plugins
                });
                return;
            }

            let pluginsLoader = new Plugins(appInstance.appDir, appInstance.sitesDir);
            pluginsLoader.removePlugin(config.directory);

            appInstance.plugins = appInstance.plugins.filter(function (plugin) {
                return plugin.name !== config.name;
            });

            event.sender.send('app-plugin-deleted', {
                status: true,
                plugins: appInstance.plugins
            });
        });

        /*
         * Add new theme
         */
        ipcMain.on('app-theme-upload', function(event, config) {
            let themesLoader = new Themes(appInstance);
            let status = installPackageFromConfig(config, themesLoader.themesPath);

            if (status !== 'wrong-format') {
                appInstance.themes = themesLoader.loadThemes();
            }

            event.sender.send('app-theme-uploaded', {
                status: status,
                themes: appInstance.themes
            });
        });

        /*
         * Add new language
         */
        ipcMain.on('app-language-upload', function(event, config) {
            let languagesLoader = new Languages(appInstance);
            let status = installPackageFromConfig(config, languagesLoader.languagesPath);

            if (status !== 'wrong-format') {
                appInstance.languages = languagesLoader.loadLanguages();
            }

            event.sender.send('app-language-uploaded', {
                status: status,
                languages: appInstance.languages
            });
        });

        /*
         * Add new plugin
         */
        ipcMain.on('app-plugin-upload', function(event, config) {
            let pluginsLoader = new Plugins(appInstance.appDir, appInstance.sitesDir);
            let status = installPackageFromConfig(config, pluginsLoader.pluginsPath);

            if (status !== 'wrong-format') {
                appInstance.plugins = pluginsLoader.loadPlugins();
            }

            event.sender.send('app-plugin-uploaded', {
                status: status,
                plugins: appInstance.plugins
            });
        });

        /*
         * Load log files list
         */
        ipcMain.on('app-log-files-load', function(event) {
            let logPath = appInstance.app.getPath('logs');
            let files = fs.readdirSync(logPath).filter(function(file) {
                return file.substr(-4) === '.txt' || file.substr(-4) === '.log';
            });

            event.sender.send('app-log-files-loaded', {
                files: files
            });
        });

        /*
         * Load specific log file
         */
        ipcMain.on('app-log-file-load', function(event, filename) {
            let logPath = appInstance.app.getPath('logs');
            let logFiles = fs.readdirSync(logPath).filter(function(file) {
                return file.substr(-4) === '.txt' || file.substr(-4) === '.log';
            });

            if (logFiles.indexOf(filename) === -1) {
                event.sender.send('app-log-file-loaded', {
                    fileContent: 'File not found!'
                });
                return;
            }

            let filePath = path.join(logPath, filename);
            let fileContent = FileHelper.readFileSync(filePath, 'utf8');

            event.sender.send('app-log-file-loaded', {
                fileContent: fileContent
            });
        });

        /*
         * Set zoom level 
         */
        ipcMain.on('app-set-ui-zoom-level', function(event, zoomLevel) {
            zoomLevel = parseFloat(zoomLevel);

            if (!zoomLevel || zoomLevel < 0 || zoomLevel > 2.5) {
                console.log('(!) Invalid zoom level: ', parseFloat(zoomLevel));
                return;
            }

            let appConfig = FileHelper.readFileSync(appInstance.appConfigPath, 'utf8');

            try {
                appConfig = JSON.parse(appConfig);
                appConfig.uiZoomLevel = zoomLevel;
                fs.writeFileSync(appInstance.appConfigPath, JSON.stringify(appConfig, null, 4));
            } catch (e) {
                console.log('(!) App was unable to save the UI zoom level');
            }

            appInstance.mainWindow.webContents.setZoomFactor(zoomLevel);
        });

        /**
         * Set notifications center state
         */
        ipcMain.on('app-set-notifications-center-state', function(event, state) {
            let appConfig = fs.readFileSync(appInstance.appConfigPath, 'utf8');

            try {
                appConfig = JSON.parse(appConfig);
                appConfig.notificationsStatus = state;
                fs.writeFileSync(appInstance.appConfigPath, JSON.stringify(appConfig, null, 4));
            } catch (e) {
                console.log('(!) App was unable to save the notifications center state');
            }
        });
    }
}

module.exports = AppEvents;
